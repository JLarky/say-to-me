import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { Clock, Effect, Fiber, Layer } from "effect";
import { type as arktype } from "arktype";
import { randomUUID } from "node:crypto";
import { parseJson } from "@say-to-me/runtime-validation";
import {
  DEFAULT_ROUTINE_WORKER_POLL_MS,
  RoutineClock,
  RoutineMessage,
  RoutineMessageError,
  RoutineRepository,
  RoutineRepositoryError,
  RoutineWorkerIdentity,
  routineWorkerLoop,
  runDueRoutinesUntilIdle,
  type DeliverPromptAction,
  type Routine,
  type RoutineStatus,
  type ScheduleTrigger,
} from "@say-to-me/routines/workflow";
import { broadcastQueue } from "./broadcast.ts";
import { drizzleDb } from "./db/index.ts";
import { routines } from "./db/drizzle-schema.ts";
import { DbRoutine, validateDb, type DbRoutine as DbRoutineRow } from "./db/schemas.ts";
import { getMessageByClientId, insertMessageRow } from "./messages.ts";
import { enqueueDelivery } from "./session-services/session-router.ts";
import { ensureSession } from "./sessions.ts";

export {
  DEFAULT_ROUTINE_WORKER_POLL_MS,
  MAX_ROUTINE_DRAIN_PER_WAKE,
  RoutineClock,
  RoutineMessage,
  RoutineMessageError,
  RoutineRepository,
  RoutineRepositoryError,
  RoutineWorkerIdentity,
  routineWorkerLoop,
  runDueRoutineOnce,
  runDueRoutinesUntilIdle,
  type CreateRoutineInput,
  type Routine,
  type RoutineClockService,
  type RoutineEnv,
  type RoutineMessageService,
  type RoutineRepositoryService,
  type RoutineWorkerIdentityService,
  type RepositoryUpdateRoutineInput,
  type UpdateRoutineInput,
} from "@say-to-me/routines/workflow";

export type { RoutineStatus };

const ROUTINE_WORKER_POLL_MS = Number(
  process.env.SAY_TO_ME_TIMER_WORKER_POLL_MS || DEFAULT_ROUTINE_WORKER_POLL_MS,
);
const ROUTINE_LEASE_MS = 30_000;
const ROUTINE_RETRY_MS = 5_000;

const routineSelectColumns = {
  id: routines.id,
  ownerSessionId: routines.ownerSessionId,
  status: routines.status,
  title: routines.title,
  triggerKind: routines.triggerKind,
  trigger: routines.trigger,
  action: routines.action,
  nextFireAt: routines.nextFireAt,
  lastFiredAt: routines.lastFiredAt,
  lastMessageId: routines.lastMessageId,
  lockedAt: routines.lockedAt,
  lockedBy: routines.lockedBy,
  lastError: routines.lastError,
  createdAt: routines.createdAt,
  updatedAt: routines.updatedAt,
};

function nowSql() {
  return sql`CURRENT_TIMESTAMP`;
}

function validateRoutineRow(row: unknown, context: string): DbRoutineRow {
  return validateDb(DbRoutine, row, context);
}

const ScheduleTriggerJson = arktype({
  kind: "'schedule'",
  dueAt: "number",
  intervalMs: "number | null",
  nextFireAt: "number",
});

const DeliverPromptActionJson = arktype({
  kind: "'deliver_prompt'",
  title: "string",
  message: "string",
});

function parseScheduleTrigger(raw: string, context: string): ScheduleTrigger {
  try {
    return parseJson(ScheduleTriggerJson, raw);
  } catch (cause) {
    throw new Error(`${context}: expected schedule trigger`, { cause });
  }
}

function parseDeliverPromptAction(raw: string, context: string): DeliverPromptAction {
  try {
    return parseJson(DeliverPromptActionJson, raw);
  } catch (cause) {
    throw new Error(`${context}: expected deliver_prompt action`, { cause });
  }
}

function toRoutine(row: DbRoutineRow, context: string): Routine {
  if (row.triggerKind !== "schedule") {
    throw new Error(`${context}: Phase 1 only supports schedule routines`);
  }
  return {
    id: row.id,
    ownerSessionId: row.ownerSessionId,
    status: row.status,
    title: row.title,
    trigger: parseScheduleTrigger(row.trigger, context),
    action: parseDeliverPromptAction(row.action, context),
    lastFiredAt: row.lastFiredAt,
    lastMessageId: row.lastMessageId,
    lockedAt: row.lockedAt,
    lockedBy: row.lockedBy,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function loadRoutine(id: number): Routine | null {
  const row = drizzleDb
    .select(routineSelectColumns)
    .from(routines)
    .where(eq(routines.id, id))
    .limit(1)
    .get();
  return row ? toRoutine(validateRoutineRow(row, "routine"), "routine") : null;
}

function leasedRoutineWhere(routine: Routine) {
  if (routine.lockedAt == null || routine.lockedBy == null) return sql`1 = 0`;
  return and(
    eq(routines.id, routine.id),
    eq(routines.status, "firing"),
    eq(routines.lockedAt, routine.lockedAt),
    eq(routines.lockedBy, routine.lockedBy),
  );
}

function editableRoutineStatus(status: RoutineStatus): boolean {
  return status === "active" || status === "paused" || status === "cancelled";
}

function scheduleTriggerJson(trigger: ScheduleTrigger): string {
  return JSON.stringify(trigger);
}

function deliverPromptActionJson(action: DeliverPromptAction): string {
  return JSON.stringify(action);
}

function routineNoticeText(routine: Routine): string {
  return `<say-to-me-system>Timer fired: ${routine.action.title}\n\n${routine.action.message}</say-to-me-system>`;
}

function tryRoutineRepository<A>(try_: () => A): Effect.Effect<A, RoutineRepositoryError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new RoutineRepositoryError({ cause }),
  });
}

function tryRoutineMessage<A>(try_: () => A): Effect.Effect<A, RoutineMessageError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new RoutineMessageError({ cause }),
  });
}

export const RoutineRepositoryLive = Layer.succeed(RoutineRepository, {
  create: (input) =>
    tryRoutineRepository(() => {
      ensureSession(input.ownerSessionId);
      const trigger: ScheduleTrigger = {
        kind: "schedule",
        dueAt: input.trigger.dueAt,
        intervalMs: input.trigger.intervalMs,
        nextFireAt: input.trigger.dueAt,
      };
      const title = input.title ?? input.action.title;
      return toRoutine(
        validateRoutineRow(
          drizzleDb
            .insert(routines)
            .values({
              ownerSessionId: input.ownerSessionId,
              title,
              triggerKind: "schedule",
              trigger: scheduleTriggerJson(trigger),
              action: deliverPromptActionJson(input.action),
              nextFireAt: trigger.nextFireAt,
            })
            .returning(routineSelectColumns)
            .get(),
          "createRoutine",
        ),
        "createRoutine",
      );
    }),
  list: (sessionId) =>
    tryRoutineRepository(() => {
      // Phase 1: schedule routines are visible only on ownerSessionId.
      // Phase 2 will also match session_idle targetSessionId.
      const rows = sessionId
        ? drizzleDb
            .select(routineSelectColumns)
            .from(routines)
            .where(eq(routines.ownerSessionId, sessionId))
            .orderBy(asc(routines.nextFireAt), asc(routines.id))
            .all()
        : drizzleDb
            .select(routineSelectColumns)
            .from(routines)
            .orderBy(asc(routines.nextFireAt), asc(routines.id))
            .all();
      return rows.map((row) => toRoutine(validateRoutineRow(row, "listRoutines"), "listRoutines"));
    }),
  update: (id, input) =>
    tryRoutineRepository(() => {
      const current = loadRoutine(id);
      if (!current || !editableRoutineStatus(current.status)) return null;
      if (input.ownerSessionId) ensureSession(input.ownerSessionId);

      const nextTrigger: ScheduleTrigger = {
        kind: "schedule",
        dueAt: input.trigger?.dueAt ?? current.trigger.dueAt,
        intervalMs:
          input.trigger?.intervalMs !== undefined
            ? input.trigger.intervalMs
            : current.trigger.intervalMs,
        nextFireAt:
          input.trigger?.dueAt !== undefined ? input.trigger.dueAt : current.trigger.nextFireAt,
      };
      const nextAction: DeliverPromptAction = {
        kind: "deliver_prompt",
        title: input.action?.title ?? current.action.title,
        message: input.action?.message ?? current.action.message,
      };
      const nextTitle =
        input.title !== undefined ? input.title : (input.action?.title ?? current.title);

      drizzleDb
        .update(routines)
        .set({
          ...(input.ownerSessionId ? { ownerSessionId: input.ownerSessionId } : {}),
          title: nextTitle,
          trigger: scheduleTriggerJson(nextTrigger),
          action: deliverPromptActionJson(nextAction),
          nextFireAt: nextTrigger.nextFireAt,
          ...(input.reactivateCancelled ? { status: "active" as const } : {}),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: nowSql(),
        })
        .where(eq(routines.id, id))
        .run();
      return loadRoutine(id);
    }),
  get: (id) => tryRoutineRepository(() => loadRoutine(id)),
  delete: (id) =>
    tryRoutineRepository(
      () => drizzleDb.delete(routines).where(eq(routines.id, id)).run().changes > 0,
    ),
  claimDue: (workerId, now) =>
    tryRoutineRepository(() => {
      const staleBefore = now - ROUTINE_LEASE_MS;
      drizzleDb
        .update(routines)
        .set({ status: "active", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(and(eq(routines.status, "firing"), lte(routines.lockedAt, staleBefore)))
        .run();
      drizzleDb
        .update(routines)
        .set({ status: "active", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(and(eq(routines.status, "firing"), sql`${routines.lockedAt} IS NULL`))
        .run();

      return drizzleDb.transaction((tx) => {
        const row = tx
          .select(routineSelectColumns)
          .from(routines)
          .where(
            and(
              eq(routines.status, "active"),
              eq(routines.triggerKind, "schedule"),
              isNotNull(routines.nextFireAt),
              lte(routines.nextFireAt, now),
            ),
          )
          .orderBy(asc(routines.nextFireAt), asc(routines.id))
          .limit(1)
          .get();
        if (!row) return null;
        const routine = toRoutine(validateRoutineRow(row, "claimRoutine"), "claimRoutine");
        const claimed = tx
          .update(routines)
          .set({
            status: "firing",
            lockedAt: now,
            lockedBy: workerId,
            lastError: null,
            updatedAt: nowSql(),
          })
          .where(and(eq(routines.id, routine.id), eq(routines.status, "active")))
          .run();
        if (claimed.changes === 0) return null;
        return loadRoutine(routine.id);
      });
    }),
  complete: (routine, messageId, firedAt) =>
    tryRoutineRepository(() => {
      const intervalMs = routine.trigger.intervalMs;
      const nextFireAt = intervalMs ? firedAt + intervalMs : routine.trigger.nextFireAt;
      const nextTrigger: ScheduleTrigger = {
        ...routine.trigger,
        nextFireAt,
      };
      const result = drizzleDb
        .update(routines)
        .set({
          status: intervalMs ? "active" : "fired",
          trigger: scheduleTriggerJson(nextTrigger),
          nextFireAt,
          lastFiredAt: firedAt,
          lastMessageId: messageId,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: nowSql(),
        })
        .where(leasedRoutineWhere(routine))
        .run();
      return result.changes > 0;
    }),
  fail: (routine, error, now) =>
    tryRoutineRepository(() => {
      const nextFireAt = now + ROUTINE_RETRY_MS;
      const nextTrigger: ScheduleTrigger = {
        ...routine.trigger,
        nextFireAt,
      };
      const result = drizzleDb
        .update(routines)
        .set({
          status: "active",
          trigger: scheduleTriggerJson(nextTrigger),
          nextFireAt,
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          updatedAt: nowSql(),
        })
        .where(leasedRoutineWhere(routine))
        .run();
      return result.changes > 0;
    }),
  pause: (id) =>
    tryRoutineRepository(() => {
      const result = drizzleDb
        .update(routines)
        .set({ status: "paused", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(and(eq(routines.id, id), inArray(routines.status, ["active", "firing"])))
        .run();
      if (result.changes === 0) return null;
      return loadRoutine(id);
    }),
  resume: (id, now) =>
    tryRoutineRepository(() => {
      const routine = loadRoutine(id);
      if (!routine || routine.status !== "paused") return null;
      const nextFireAt = Math.max(routine.trigger.nextFireAt, now);
      const nextTrigger: ScheduleTrigger = { ...routine.trigger, nextFireAt };
      const result = drizzleDb
        .update(routines)
        .set({
          status: "active",
          trigger: scheduleTriggerJson(nextTrigger),
          nextFireAt,
          lockedAt: null,
          lockedBy: null,
          updatedAt: nowSql(),
        })
        .where(eq(routines.id, id))
        .run();
      if (result.changes === 0) return null;
      return loadRoutine(id);
    }),
  cancel: (id) =>
    tryRoutineRepository(() => {
      const result = drizzleDb
        .update(routines)
        .set({ status: "cancelled", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(and(eq(routines.id, id), inArray(routines.status, ["active", "paused", "firing"])))
        .run();
      if (result.changes === 0) return null;
      return loadRoutine(id);
    }),
  trigger: (id, now) =>
    tryRoutineRepository(() => {
      const routine = loadRoutine(id);
      if (!routine || routine.status !== "active") return null;
      const nextTrigger: ScheduleTrigger = { ...routine.trigger, nextFireAt: now };
      const result = drizzleDb
        .update(routines)
        .set({
          status: "active",
          trigger: scheduleTriggerJson(nextTrigger),
          nextFireAt: now,
          lockedAt: null,
          lockedBy: null,
          updatedAt: nowSql(),
        })
        .where(and(eq(routines.id, id), eq(routines.status, "active")))
        .run();
      if (result.changes === 0) return null;
      return loadRoutine(id);
    }),
});

export const RoutineMessageLive = Layer.succeed(RoutineMessage, {
  fire: (routine) =>
    Effect.gen(function* () {
      const clientMessageId = `routine-${routine.id}-${routine.trigger.nextFireAt}`;
      const message = yield* tryRoutineMessage(
        () =>
          getMessageByClientId(routine.ownerSessionId, "user", clientMessageId) ??
          insertMessageRow({
            sessionId: routine.ownerSessionId,
            text: routineNoticeText(routine),
            extraMarkdown: null,
            author: "user",
            status: "received",
            links: null,
            sessionRefs: null,
            clientMessageId,
          }),
      );

      yield* enqueueDelivery(routine.ownerSessionId, {
        messageId: message.id,
        messageSessionId: routine.ownerSessionId,
        kind: "direct_user_message",
      }).pipe(
        Effect.mapError(
          (cause) =>
            new RoutineMessageError({
              cause: new Error(cause.message),
            }),
        ),
      );

      yield* tryRoutineMessage(() => broadcastQueue(routine.ownerSessionId));
      return message.id;
    }),
});

export const RoutineClockLive = Layer.succeed(RoutineClock, {
  now: Clock.currentTimeMillis,
});

export const RoutineWorkerIdentityLive = Layer.succeed(RoutineWorkerIdentity, {
  id: `routine-${process.pid}-${randomUUID()}`,
});

export const RoutineLive = Layer.mergeAll(
  RoutineRepositoryLive,
  RoutineMessageLive,
  RoutineClockLive,
  RoutineWorkerIdentityLive,
);

let routineWorker: ReturnType<typeof Effect.runFork> | null = null;
const routineKickFibers = new Set<ReturnType<typeof Effect.runFork>>();

export function startRoutineWorker(): void {
  if (routineWorker) return;
  routineWorker = Effect.runFork(
    routineWorkerLoop(ROUTINE_WORKER_POLL_MS).pipe(Effect.provide(RoutineLive)),
  );
}

export function kickRoutineWorker(): void {
  let fiber: ReturnType<typeof Effect.runFork> | null = null;
  fiber = Effect.runFork(
    runDueRoutinesUntilIdle()
      .pipe(Effect.ensuring(Effect.sync(() => fiber && routineKickFibers.delete(fiber))))
      .pipe(Effect.provide(RoutineLive)),
  );
  routineKickFibers.add(fiber);
}

export async function stopRoutineWorker(): Promise<void> {
  const fiber = routineWorker;
  routineWorker = null;
  const kickFibers = [...routineKickFibers];
  routineKickFibers.clear();
  const fibers = fiber ? [fiber, ...kickFibers] : kickFibers;
  if (!fibers.length) return;
  await Effect.runPromise(Effect.all(fibers.map((item) => Fiber.interrupt(item))));
}

export function serializeRoutine(routine: Routine) {
  return routine;
}
