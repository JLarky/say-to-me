import { and, asc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
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
  isScheduleRoutine,
  isSessionIdleRoutine,
  routineWorkerLoop,
  runDueRoutinesUntilIdle,
  type CreateRoutineInput,
  type CreateSessionIdleRoutineInput,
  type DeliverPromptAction,
  type NotifyOwnerAction,
  type Routine,
  type RoutineStatus,
  type ScheduleTrigger,
  type SessionIdleTrigger,
  type WatcherCompletedEvent,
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
  isScheduleRoutine,
  isSessionIdleRoutine,
  routineWorkerLoop,
  runDueRoutineOnce,
  runDueRoutinesUntilIdle,
  type CreateRoutineInput,
  type CreateSessionIdleRoutineInput,
  type Routine,
  type RoutineClockService,
  type RoutineEnv,
  type RoutineMessageService,
  type RoutineRepositoryService,
  type RoutineWorkerIdentityService,
  type RepositoryUpdateRoutineInput,
  type UpdateRoutineInput,
  type WatcherCompletedEvent,
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

const SessionIdleTriggerJson = arktype({
  kind: "'session_idle'",
  targetSessionId: "string",
  sourceMessageId: "number | null",
  afterWorkSeen: "true",
});

const DeliverPromptActionJson = arktype({
  kind: "'deliver_prompt'",
  title: "string",
  message: "string",
});

const NotifyOwnerActionJson = arktype({
  kind: "'notify_owner'",
  "result?": {
    kind: "'watcher_completed'",
    routineId: "number",
    sourceMessageId: "number | null",
    targetSessionId: "string",
    targetMessageId: "number | null",
    reason: "'idle' | 'failed'",
  },
});

function parseScheduleTrigger(raw: string, context: string): ScheduleTrigger {
  try {
    return parseJson(ScheduleTriggerJson, raw);
  } catch (cause) {
    throw new Error(`${context}: expected schedule trigger`, { cause });
  }
}

function parseSessionIdleTrigger(raw: string, context: string): SessionIdleTrigger {
  try {
    return parseJson(SessionIdleTriggerJson, raw);
  } catch (cause) {
    throw new Error(`${context}: expected session_idle trigger`, { cause });
  }
}

function parseDeliverPromptAction(raw: string, context: string): DeliverPromptAction {
  try {
    return parseJson(DeliverPromptActionJson, raw);
  } catch (cause) {
    throw new Error(`${context}: expected deliver_prompt action`, { cause });
  }
}

function parseNotifyOwnerAction(raw: string, context: string): NotifyOwnerAction {
  try {
    return parseJson(NotifyOwnerActionJson, raw);
  } catch (cause) {
    throw new Error(`${context}: expected notify_owner action`, { cause });
  }
}

function toRoutine(row: DbRoutineRow, context: string): Routine {
  if (row.triggerKind === "schedule") {
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
  if (row.triggerKind === "session_idle") {
    return {
      id: row.id,
      ownerSessionId: row.ownerSessionId,
      status: row.status,
      title: row.title,
      trigger: parseSessionIdleTrigger(row.trigger, context),
      action: parseNotifyOwnerAction(row.action, context),
      lastFiredAt: row.lastFiredAt,
      lastMessageId: row.lastMessageId,
      lockedAt: row.lockedAt,
      lockedBy: row.lockedBy,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  throw new Error(`${context}: unsupported trigger_kind ${row.triggerKind}`);
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

function sessionIdleTriggerJson(trigger: SessionIdleTrigger): string {
  return JSON.stringify(trigger);
}

function deliverPromptActionJson(action: DeliverPromptAction): string {
  return JSON.stringify(action);
}

function notifyOwnerActionJson(action: NotifyOwnerAction): string {
  return JSON.stringify(action);
}

function routineNoticeText(routine: { action: DeliverPromptAction }): string {
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

function sessionIdleListWhere(sessionId: string) {
  return or(
    eq(routines.ownerSessionId, sessionId),
    and(
      eq(routines.triggerKind, "session_idle"),
      sql`json_extract(${routines.trigger}, '$.targetSessionId') = ${sessionId}`,
    ),
  );
}

const ACTIVE_SESSION_IDLE_STATUSES = ["active", "paused", "firing"] as const;

/** One live idle route per owner→target pair; used to no-op duplicate creates. */
export function findActiveSessionIdleRoutineByOwnerAndTarget(
  ownerSessionId: string,
  targetSessionId: string,
): Routine | null {
  const row = drizzleDb
    .select(routineSelectColumns)
    .from(routines)
    .where(
      and(
        eq(routines.ownerSessionId, ownerSessionId),
        eq(routines.triggerKind, "session_idle"),
        inArray(routines.status, [...ACTIVE_SESSION_IDLE_STATUSES]),
        sql`json_extract(${routines.trigger}, '$.targetSessionId') = ${targetSessionId}`,
      ),
    )
    .orderBy(asc(routines.id))
    .limit(1)
    .get();
  return row
    ? toRoutine(
        validateRoutineRow(row, "findActiveSessionIdleByOwnerAndTarget"),
        "findActiveSessionIdleByOwnerAndTarget",
      )
    : null;
}

export function createSessionIdleRoutine(input: CreateSessionIdleRoutineInput): Routine {
  ensureSession(input.ownerSessionId);
  ensureSession(input.trigger.targetSessionId);
  const existing = findActiveSessionIdleRoutineByOwnerAndTarget(
    input.ownerSessionId,
    input.trigger.targetSessionId,
  );
  if (existing) return existing;
  const trigger: SessionIdleTrigger = {
    kind: "session_idle",
    targetSessionId: input.trigger.targetSessionId,
    sourceMessageId: input.trigger.sourceMessageId,
    afterWorkSeen: true,
  };
  const title =
    input.title ??
    (input.trigger.sourceMessageId != null
      ? `Wait for ${input.trigger.targetSessionId}`
      : `Wait for ${input.trigger.targetSessionId}`);
  return toRoutine(
    validateRoutineRow(
      drizzleDb
        .insert(routines)
        .values({
          ownerSessionId: input.ownerSessionId,
          title,
          triggerKind: "session_idle",
          trigger: sessionIdleTriggerJson(trigger),
          action: notifyOwnerActionJson({ kind: "notify_owner" }),
          nextFireAt: null,
        })
        .returning(routineSelectColumns)
        .get(),
      "createSessionIdleRoutine",
    ),
    "createSessionIdleRoutine",
  );
}

export function findActiveSessionIdleRoutineBySourceMessageId(
  sourceMessageId: number,
): Routine | null {
  const row = drizzleDb
    .select(routineSelectColumns)
    .from(routines)
    .where(
      and(
        eq(routines.triggerKind, "session_idle"),
        inArray(routines.status, [...ACTIVE_SESSION_IDLE_STATUSES]),
        sql`json_extract(${routines.trigger}, '$.sourceMessageId') = ${sourceMessageId}`,
      ),
    )
    .orderBy(asc(routines.id))
    .limit(1)
    .get();
  return row
    ? toRoutine(
        validateRoutineRow(row, "findActiveSessionIdleRoutine"),
        "findActiveSessionIdleRoutine",
      )
    : null;
}

export function findSessionIdleRoutineBySourceMessageId(sourceMessageId: number): Routine | null {
  const row = drizzleDb
    .select(routineSelectColumns)
    .from(routines)
    .where(
      and(
        eq(routines.triggerKind, "session_idle"),
        sql`json_extract(${routines.trigger}, '$.sourceMessageId') = ${sourceMessageId}`,
      ),
    )
    .orderBy(asc(routines.id))
    .limit(1)
    .get();
  return row
    ? toRoutine(validateRoutineRow(row, "findSessionIdleRoutine"), "findSessionIdleRoutine")
    : null;
}

export function listRoutineEventsByLastMessageIds(
  messageIds: number[],
): Map<number, WatcherCompletedEvent> {
  const events = new Map<number, WatcherCompletedEvent>();
  if (messageIds.length === 0) return events;
  const rows = drizzleDb
    .select(routineSelectColumns)
    .from(routines)
    .where(
      and(eq(routines.triggerKind, "session_idle"), inArray(routines.lastMessageId, messageIds)),
    )
    .all();
  for (const row of rows) {
    const routine = toRoutine(validateRoutineRow(row, "listRoutineEvents"), "listRoutineEvents");
    if (routine.lastMessageId != null && isSessionIdleRoutine(routine) && routine.action.result) {
      events.set(routine.lastMessageId, routine.action.result);
    }
  }
  return events;
}

export function completeSessionIdleRoutine(input: {
  routineId: number;
  messageId: number;
  targetSessionId: string;
  targetMessageId: number | null;
  sourceMessageId: number | null;
  reason: "idle" | "failed";
  firedAt?: number;
}): Routine | null {
  const current = loadRoutine(input.routineId);
  if (!current || !isSessionIdleRoutine(current)) return null;
  if (current.status === "fired" || current.status === "failed" || current.status === "cancelled") {
    return current;
  }
  const result: WatcherCompletedEvent = {
    kind: "watcher_completed",
    routineId: current.id,
    sourceMessageId: input.sourceMessageId ?? current.trigger.sourceMessageId,
    targetSessionId: input.targetSessionId,
    targetMessageId: input.targetMessageId,
    reason: input.reason,
  };
  const firedAt = input.firedAt ?? Date.now();
  const status = input.reason === "failed" ? "failed" : "fired";
  drizzleDb
    .update(routines)
    .set({
      status,
      action: notifyOwnerActionJson({ kind: "notify_owner", result }),
      lastFiredAt: firedAt,
      lastMessageId: input.messageId,
      lockedAt: null,
      lockedBy: null,
      lastError: input.reason === "failed" ? "Target delivery failed before work." : null,
      updatedAt: nowSql(),
    })
    .where(
      and(eq(routines.id, current.id), inArray(routines.status, ["active", "paused", "firing"])),
    )
    .run();
  return loadRoutine(current.id);
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
      const rows = sessionId
        ? drizzleDb
            .select(routineSelectColumns)
            .from(routines)
            .where(sessionIdleListWhere(sessionId))
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
      if (!isScheduleRoutine(current)) return null;
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
      if (!isScheduleRoutine(routine)) return false;
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
      if (!isScheduleRoutine(routine)) {
        const result = drizzleDb
          .update(routines)
          .set({
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            lastError: error,
            updatedAt: nowSql(),
          })
          .where(eq(routines.id, routine.id))
          .run();
        return result.changes > 0;
      }
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
      const current = loadRoutine(id);
      if (!current || !isScheduleRoutine(current)) return null;
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
      if (!routine || !isScheduleRoutine(routine) || routine.status !== "paused") return null;
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
      if (!routine || !isScheduleRoutine(routine) || routine.status !== "active") return null;
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
      if (!isScheduleRoutine(routine)) {
        return yield* Effect.fail(
          new RoutineMessageError({
            cause: new Error("Only schedule routines can be fired by the worker."),
          }),
        );
      }
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
