import { Context, Data, Effect, Schedule } from "effect";

export const DEFAULT_ROUTINE_WORKER_POLL_MS = 1_000;
export const MAX_ROUTINE_DRAIN_PER_WAKE = 100;

export type RoutineStatus = "active" | "paused" | "firing" | "fired" | "cancelled" | "failed";

export type ScheduleTrigger = {
  kind: "schedule";
  dueAt: number;
  intervalMs: number | null;
  nextFireAt: number;
};

export type SessionIdleTrigger = {
  kind: "session_idle";
  targetSessionId: string;
  sourceMessageId: number | null;
  afterWorkSeen: true;
};

export type RoutineTrigger = ScheduleTrigger | SessionIdleTrigger;

export type DeliverPromptAction = {
  kind: "deliver_prompt";
  title: string;
  message: string;
};

export type WatcherCompletedEvent = {
  kind: "watcher_completed";
  routineId: number;
  sourceMessageId: number | null;
  targetSessionId: string;
  targetMessageId: number | null;
  reason: "idle" | "failed";
};

export type NotifyOwnerAction = {
  kind: "notify_owner";
  /** Filled when the idle/failed watch completes. */
  result?: WatcherCompletedEvent;
};

export type RoutineAction = DeliverPromptAction | NotifyOwnerAction;

export type Routine = {
  id: number;
  ownerSessionId: string;
  status: RoutineStatus;
  title: string | null;
  trigger: RoutineTrigger;
  action: RoutineAction;
  lastFiredAt: number | null;
  lastMessageId: number | null;
  lockedAt: number | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleRoutine = Routine & {
  trigger: ScheduleTrigger;
  action: DeliverPromptAction;
};

export type SessionIdleRoutine = Routine & {
  trigger: SessionIdleTrigger;
  action: NotifyOwnerAction;
};

export function isScheduleRoutine(routine: Routine): routine is ScheduleRoutine {
  return routine.trigger.kind === "schedule" && routine.action.kind === "deliver_prompt";
}

export function isSessionIdleRoutine(routine: Routine): routine is SessionIdleRoutine {
  return routine.trigger.kind === "session_idle" && routine.action.kind === "notify_owner";
}

/** Public create body for schedule routines (Phase 1). Session-idle is relay-created in Phase 2. */
export type CreateRoutineInput = {
  ownerSessionId: string;
  title?: string | null;
  trigger: {
    kind: "schedule";
    dueAt: number;
    intervalMs: number | null;
  };
  action: DeliverPromptAction;
};

export type CreateSessionIdleRoutineInput = {
  ownerSessionId: string;
  title?: string | null;
  trigger: {
    kind: "session_idle";
    targetSessionId: string;
    sourceMessageId: number | null;
    afterWorkSeen: true;
  };
  action: { kind: "notify_owner" };
};

export type UpdateRoutineInput = {
  ownerSessionId?: string;
  title?: string | null;
  trigger?: {
    kind: "schedule";
    dueAt?: number;
    intervalMs?: number | null;
  };
  action?: {
    kind: "deliver_prompt";
    title?: string;
    message?: string;
  };
};

export type RepositoryUpdateRoutineInput = UpdateRoutineInput & {
  reactivateCancelled?: boolean;
};

export class RoutineRepositoryError extends Data.TaggedError("RoutineRepositoryError")<{
  readonly cause: unknown;
}> {}

export class RoutineMessageError extends Data.TaggedError("RoutineMessageError")<{
  readonly cause: unknown;
}> {}

export type RoutineRepositoryService = {
  create: (input: CreateRoutineInput) => Effect.Effect<Routine, RoutineRepositoryError>;
  update: (
    id: number,
    input: RepositoryUpdateRoutineInput,
  ) => Effect.Effect<Routine | null, RoutineRepositoryError>;
  list: (sessionId?: string) => Effect.Effect<Routine[], RoutineRepositoryError>;
  get: (id: number) => Effect.Effect<Routine | null, RoutineRepositoryError>;
  delete: (id: number) => Effect.Effect<boolean, RoutineRepositoryError>;
  claimDue: (
    workerId: string,
    now: number,
  ) => Effect.Effect<Routine | null, RoutineRepositoryError>;
  complete: (
    routine: Routine,
    messageId: number,
    firedAt: number,
  ) => Effect.Effect<boolean, RoutineRepositoryError>;
  fail: (
    routine: Routine,
    error: string,
    now: number,
  ) => Effect.Effect<boolean, RoutineRepositoryError>;
  pause: (id: number) => Effect.Effect<Routine | null, RoutineRepositoryError>;
  resume: (id: number, now: number) => Effect.Effect<Routine | null, RoutineRepositoryError>;
  cancel: (id: number) => Effect.Effect<Routine | null, RoutineRepositoryError>;
  trigger: (id: number, now: number) => Effect.Effect<Routine | null, RoutineRepositoryError>;
};

export type RoutineMessageService = {
  fire: (routine: Routine) => Effect.Effect<number, RoutineMessageError>;
};

export type RoutineClockService = {
  now: Effect.Effect<number>;
};

export type RoutineWorkerIdentityService = {
  id: string;
};

export type RoutineEnv =
  | RoutineRepositoryService
  | RoutineMessageService
  | RoutineClockService
  | RoutineWorkerIdentityService;

export const RoutineRepository = Context.GenericTag<RoutineRepositoryService>(
  "say-to-me/RoutineRepository",
);
export const RoutineMessage = Context.GenericTag<RoutineMessageService>("say-to-me/RoutineMessage");
export const RoutineClock = Context.GenericTag<RoutineClockService>("say-to-me/RoutineClock");
export const RoutineWorkerIdentity = Context.GenericTag<RoutineWorkerIdentityService>(
  "say-to-me/RoutineWorkerIdentity",
);

function messageErrorText(error: RoutineMessageError): string {
  return error.cause instanceof Error ? error.cause.message : String(error.cause);
}

export function runDueRoutineOnce(): Effect.Effect<boolean, never, RoutineEnv> {
  return Effect.gen(function* () {
    const repository = yield* RoutineRepository;
    const messages = yield* RoutineMessage;
    const clock = yield* RoutineClock;
    const worker = yield* RoutineWorkerIdentity;
    const now = yield* clock.now;
    const routine = yield* repository.claimDue(worker.id, now);
    if (!routine) return false;
    if (!isScheduleRoutine(routine)) {
      yield* repository.fail(routine, "Non-schedule routine claimed by schedule worker.", now);
      return true;
    }

    const messageResult = yield* Effect.either(messages.fire(routine));
    if (messageResult._tag === "Left") {
      const retryAt = yield* clock.now;
      yield* repository.fail(routine, messageErrorText(messageResult.left), retryAt);
      return true;
    }
    const firedAt = yield* clock.now;
    yield* repository.complete(routine, messageResult.right, firedAt);
    return true;
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));
}

export function runDueRoutinesUntilIdle(): Effect.Effect<number, never, RoutineEnv> {
  return Effect.gen(function* () {
    let firedCount = 0;
    for (;;) {
      const fired = yield* runDueRoutineOnce();
      if (!fired) return firedCount;
      firedCount += 1;
      if (firedCount >= MAX_ROUTINE_DRAIN_PER_WAKE) return firedCount;
    }
  });
}

export function routineWorkerLoop(
  pollMs = DEFAULT_ROUTINE_WORKER_POLL_MS,
): Effect.Effect<void, never, RoutineEnv> {
  return runDueRoutinesUntilIdle().pipe(
    Effect.zipRight(Effect.void),
    Effect.repeat(Schedule.spaced(`${pollMs} millis`)),
  );
}
