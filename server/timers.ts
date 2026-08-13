import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { Clock, Effect, Fiber, Layer } from "effect";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_TIMER_WORKER_POLL_MS,
  JarvisTimerClock,
  JarvisTimerMessage,
  JarvisTimerMessageError,
  JarvisTimerRepository,
  JarvisTimerRepositoryError,
  JarvisTimerWorkerIdentity,
  jarvisTimerWorkerLoop,
  runDueJarvisTimersUntilIdle,
  type JarvisTimer,
} from "@say-to-me/jarvis-timers/workflow";
import { broadcastQueue } from "./broadcast.ts";
import { drizzleDb } from "./db/index.ts";
import { jarvisTimers } from "./db/drizzle-schema.ts";
import { DbJarvisTimer, validateDb, type DbJarvisTimer as DbJarvisTimerRow } from "./db/schemas.ts";
import { getMessageByClientId, insertMessageRow } from "./messages.ts";
import { enqueueDelivery } from "./session-services/session-router.ts";
import { ensureSession } from "./sessions.ts";

export {
  DEFAULT_TIMER_WORKER_POLL_MS,
  MAX_TIMER_DRAIN_PER_WAKE,
  JarvisTimerClock,
  JarvisTimerMessage,
  JarvisTimerMessageError,
  JarvisTimerRepository,
  JarvisTimerRepositoryError,
  JarvisTimerWorkerIdentity,
  jarvisTimerWorkerLoop,
  runDueJarvisTimerOnce,
  runDueJarvisTimersUntilIdle,
  type CreateJarvisTimerInput,
  type JarvisTimer,
  type JarvisTimerClockService,
  type JarvisTimerEnv,
  type JarvisTimerMessageService,
  type JarvisTimerRepositoryService,
  type JarvisTimerWorkerIdentityService,
  type RepositoryUpdateJarvisTimerInput,
  type UpdateJarvisTimerInput,
} from "@say-to-me/jarvis-timers/workflow";

export type TimerStatus = JarvisTimer["status"];

const TIMER_WORKER_POLL_MS = Number(
  process.env.SAY_TO_ME_TIMER_WORKER_POLL_MS || DEFAULT_TIMER_WORKER_POLL_MS,
);
const TIMER_LEASE_MS = 30_000;
const TIMER_RETRY_MS = 5_000;

const timerSelectColumns = {
  id: jarvisTimers.id,
  sessionId: jarvisTimers.sessionId,
  title: jarvisTimers.title,
  message: jarvisTimers.message,
  status: jarvisTimers.status,
  dueAt: jarvisTimers.dueAt,
  intervalMs: jarvisTimers.intervalMs,
  nextFireAt: jarvisTimers.nextFireAt,
  lastFiredAt: jarvisTimers.lastFiredAt,
  lastMessageId: jarvisTimers.lastMessageId,
  lockedAt: jarvisTimers.lockedAt,
  lockedBy: jarvisTimers.lockedBy,
  lastError: jarvisTimers.lastError,
  createdAt: jarvisTimers.createdAt,
  updatedAt: jarvisTimers.updatedAt,
};

function nowSql() {
  return sql`CURRENT_TIMESTAMP`;
}

function validateTimer(row: unknown, context: string): DbJarvisTimerRow {
  return validateDb(DbJarvisTimer, row, context);
}

function loadTimer(id: number): DbJarvisTimerRow | null {
  const row = drizzleDb
    .select(timerSelectColumns)
    .from(jarvisTimers)
    .where(eq(jarvisTimers.id, id))
    .limit(1)
    .get();
  return row ? validateTimer(row, "jarvisTimer") : null;
}

function leasedTimerWhere(timer: DbJarvisTimerRow) {
  if (timer.lockedAt == null || timer.lockedBy == null) return sql`1 = 0`;
  return and(
    eq(jarvisTimers.id, timer.id),
    eq(jarvisTimers.status, "firing"),
    eq(jarvisTimers.lockedAt, timer.lockedAt),
    eq(jarvisTimers.lockedBy, timer.lockedBy),
  );
}

function editableTimerStatus(status: TimerStatus): boolean {
  return status === "active" || status === "paused" || status === "cancelled";
}

function timerNoticeText(timer: DbJarvisTimerRow): string {
  return `<say-to-me-system>Timer fired: ${timer.title}\n\n${timer.message}</say-to-me-system>`;
}

function tryTimerRepository<A>(try_: () => A): Effect.Effect<A, JarvisTimerRepositoryError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new JarvisTimerRepositoryError({ cause }),
  });
}

function tryTimerMessage<A>(try_: () => A): Effect.Effect<A, JarvisTimerMessageError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new JarvisTimerMessageError({ cause }),
  });
}

export const JarvisTimerRepositoryLive = Layer.succeed(JarvisTimerRepository, {
  create: (input) =>
    tryTimerRepository(() => {
      ensureSession(input.sessionId);
      return validateTimer(
        drizzleDb
          .insert(jarvisTimers)
          .values({
            sessionId: input.sessionId,
            title: input.title,
            message: input.message,
            dueAt: input.dueAt,
            intervalMs: input.intervalMs,
            nextFireAt: input.dueAt,
          })
          .returning(timerSelectColumns)
          .get(),
        "createJarvisTimer",
      );
    }),
  list: (sessionId) =>
    tryTimerRepository(() => {
      const rows = sessionId
        ? drizzleDb
            .select(timerSelectColumns)
            .from(jarvisTimers)
            .where(eq(jarvisTimers.sessionId, sessionId))
            .orderBy(asc(jarvisTimers.nextFireAt), asc(jarvisTimers.id))
            .all()
        : drizzleDb
            .select(timerSelectColumns)
            .from(jarvisTimers)
            .orderBy(asc(jarvisTimers.nextFireAt), asc(jarvisTimers.id))
            .all();
      return rows.map((row) => validateTimer(row, "listJarvisTimers"));
    }),
  update: (id, input) =>
    tryTimerRepository(() => {
      const current = loadTimer(id);
      if (!current || !editableTimerStatus(current.status)) return null;
      if (input.sessionId) ensureSession(input.sessionId);
      drizzleDb
        .update(jarvisTimers)
        .set({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.message ? { message: input.message } : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt, nextFireAt: input.dueAt } : {}),
          ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
          ...(input.reactivateCancelled ? { status: "active" as const } : {}),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: nowSql(),
        })
        .where(eq(jarvisTimers.id, id))
        .run();
      return loadTimer(id);
    }),
  get: (id) => tryTimerRepository(() => loadTimer(id)),
  delete: (id) =>
    tryTimerRepository(
      () => drizzleDb.delete(jarvisTimers).where(eq(jarvisTimers.id, id)).run().changes > 0,
    ),
  claimDue: (workerId, now) =>
    tryTimerRepository(() => {
      const staleBefore = now - TIMER_LEASE_MS;
      drizzleDb
        .update(jarvisTimers)
        .set({ status: "active", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(and(eq(jarvisTimers.status, "firing"), lte(jarvisTimers.lockedAt, staleBefore)))
        .run();
      drizzleDb
        .update(jarvisTimers)
        .set({ status: "active", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(and(eq(jarvisTimers.status, "firing"), sql`${jarvisTimers.lockedAt} IS NULL`))
        .run();

      const candidate = drizzleDb.transaction((tx) => {
        const row = tx
          .select(timerSelectColumns)
          .from(jarvisTimers)
          .where(and(eq(jarvisTimers.status, "active"), lte(jarvisTimers.nextFireAt, now)))
          .orderBy(asc(jarvisTimers.nextFireAt), asc(jarvisTimers.id))
          .limit(1)
          .get();
        if (!row) return null;
        const timer = validateTimer(row, "claimJarvisTimer");
        const claimed = tx
          .update(jarvisTimers)
          .set({
            status: "firing",
            lockedAt: now,
            lockedBy: workerId,
            lastError: null,
            updatedAt: nowSql(),
          })
          .where(and(eq(jarvisTimers.id, timer.id), eq(jarvisTimers.status, "active")))
          .run();
        if (claimed.changes === 0) return null;
        return loadTimer(timer.id);
      });
      return candidate;
    }),
  complete: (timer, messageId, firedAt) =>
    tryTimerRepository(() => {
      const nextFireAt = timer.intervalMs ? firedAt + timer.intervalMs : timer.nextFireAt;
      const result = drizzleDb
        .update(jarvisTimers)
        .set({
          status: timer.intervalMs ? "active" : "completed",
          nextFireAt,
          lastFiredAt: firedAt,
          lastMessageId: messageId,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: nowSql(),
        })
        .where(leasedTimerWhere(timer))
        .run();
      return result.changes > 0;
    }),
  fail: (timer, error, now) =>
    tryTimerRepository(() => {
      const result = drizzleDb
        .update(jarvisTimers)
        .set({
          status: "active",
          nextFireAt: now + TIMER_RETRY_MS,
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          updatedAt: nowSql(),
        })
        .where(leasedTimerWhere(timer))
        .run();
      return result.changes > 0;
    }),
  pause: (id) =>
    tryTimerRepository(() => {
      const result = drizzleDb
        .update(jarvisTimers)
        .set({ status: "paused", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(and(eq(jarvisTimers.id, id), inArray(jarvisTimers.status, ["active", "firing"])))
        .run();
      if (result.changes === 0) return null;
      return loadTimer(id);
    }),
  resume: (id, now) =>
    tryTimerRepository(() => {
      const timer = loadTimer(id);
      if (!timer || timer.status !== "paused") return null;
      const result = drizzleDb
        .update(jarvisTimers)
        .set({
          status: "active",
          nextFireAt: Math.max(timer.nextFireAt, now),
          lockedAt: null,
          lockedBy: null,
          updatedAt: nowSql(),
        })
        .where(eq(jarvisTimers.id, id))
        .run();
      if (result.changes === 0) return null;
      return loadTimer(id);
    }),
  cancel: (id) =>
    tryTimerRepository(() => {
      const result = drizzleDb
        .update(jarvisTimers)
        .set({ status: "cancelled", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(
          and(
            eq(jarvisTimers.id, id),
            inArray(jarvisTimers.status, ["active", "paused", "firing"]),
          ),
        )
        .run();
      if (result.changes === 0) return null;
      return loadTimer(id);
    }),
  trigger: (id, now) =>
    tryTimerRepository(() => {
      const timer = loadTimer(id);
      if (!timer || timer.status !== "active") return null;
      const result = drizzleDb
        .update(jarvisTimers)
        .set({
          status: "active",
          nextFireAt: now,
          lockedAt: null,
          lockedBy: null,
          updatedAt: nowSql(),
        })
        .where(and(eq(jarvisTimers.id, id), eq(jarvisTimers.status, "active")))
        .run();
      if (result.changes === 0) return null;
      return loadTimer(id);
    }),
});

export const JarvisTimerMessageLive = Layer.succeed(JarvisTimerMessage, {
  fire: (timer) =>
    Effect.gen(function* () {
      const clientMessageId = `jarvis-timer-${timer.id}-${timer.nextFireAt}`;
      const message = yield* tryTimerMessage(
        () =>
          getMessageByClientId(timer.sessionId, "user", clientMessageId) ??
          insertMessageRow({
            sessionId: timer.sessionId,
            text: timerNoticeText(timer),
            extraMarkdown: null,
            author: "user",
            status: "received",
            links: null,
            sessionRefs: null,
            clientMessageId,
          }),
      );

      yield* enqueueDelivery(timer.sessionId, {
        messageId: message.id,
        messageSessionId: timer.sessionId,
        kind: "direct_user_message",
      }).pipe(
        Effect.mapError(
          (cause) =>
            new JarvisTimerMessageError({
              cause: new Error(cause.message),
            }),
        ),
      );

      yield* tryTimerMessage(() => broadcastQueue(timer.sessionId));
      return message.id;
    }),
});

export const JarvisTimerClockLive = Layer.succeed(JarvisTimerClock, {
  now: Clock.currentTimeMillis,
});

export const JarvisTimerWorkerIdentityLive = Layer.succeed(JarvisTimerWorkerIdentity, {
  id: `jarvis-timer-${process.pid}-${randomUUID()}`,
});

export const JarvisTimerLive = Layer.mergeAll(
  JarvisTimerRepositoryLive,
  JarvisTimerMessageLive,
  JarvisTimerClockLive,
  JarvisTimerWorkerIdentityLive,
);

let timerWorker: ReturnType<typeof Effect.runFork> | null = null;
const timerKickFibers = new Set<ReturnType<typeof Effect.runFork>>();

export function startJarvisTimerWorker(): void {
  if (timerWorker) return;
  timerWorker = Effect.runFork(
    jarvisTimerWorkerLoop(TIMER_WORKER_POLL_MS).pipe(Effect.provide(JarvisTimerLive)),
  );
}

export function kickJarvisTimerWorker(): void {
  let fiber: ReturnType<typeof Effect.runFork> | null = null;
  fiber = Effect.runFork(
    runDueJarvisTimersUntilIdle()
      .pipe(Effect.ensuring(Effect.sync(() => fiber && timerKickFibers.delete(fiber))))
      .pipe(Effect.provide(JarvisTimerLive)),
  );
  timerKickFibers.add(fiber);
}

export async function stopJarvisTimerWorker(): Promise<void> {
  const fiber = timerWorker;
  timerWorker = null;
  const kickFibers = [...timerKickFibers];
  timerKickFibers.clear();
  const fibers = fiber ? [fiber, ...kickFibers] : kickFibers;
  if (!fibers.length) return;
  await Effect.runPromise(Effect.all(fibers.map((item) => Fiber.interrupt(item))));
}

export function serializeJarvisTimer(timer: DbJarvisTimerRow) {
  return timer;
}
