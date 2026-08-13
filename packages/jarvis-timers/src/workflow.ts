import { Context, Data, Effect, Schedule } from "effect";

export const DEFAULT_TIMER_WORKER_POLL_MS = 1_000;
export const MAX_TIMER_DRAIN_PER_WAKE = 100;

export type JarvisTimer = {
  id: number;
  sessionId: string;
  title: string;
  message: string;
  status: "active" | "paused" | "firing" | "completed" | "cancelled";
  dueAt: number;
  intervalMs: number | null;
  nextFireAt: number;
  lastFiredAt: number | null;
  lastMessageId: number | null;
  lockedAt: number | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateJarvisTimerInput = {
  sessionId: string;
  title: string;
  message: string;
  dueAt: number;
  intervalMs: number | null;
};

export type UpdateJarvisTimerInput = Partial<CreateJarvisTimerInput>;

export type RepositoryUpdateJarvisTimerInput = UpdateJarvisTimerInput & {
  reactivateCancelled?: boolean;
};

export class JarvisTimerRepositoryError extends Data.TaggedError("JarvisTimerRepositoryError")<{
  readonly cause: unknown;
}> {}

export class JarvisTimerMessageError extends Data.TaggedError("JarvisTimerMessageError")<{
  readonly cause: unknown;
}> {}

export type JarvisTimerRepositoryService = {
  create: (input: CreateJarvisTimerInput) => Effect.Effect<JarvisTimer, JarvisTimerRepositoryError>;
  update: (
    id: number,
    input: RepositoryUpdateJarvisTimerInput,
  ) => Effect.Effect<JarvisTimer | null, JarvisTimerRepositoryError>;
  list: (sessionId?: string) => Effect.Effect<JarvisTimer[], JarvisTimerRepositoryError>;
  get: (id: number) => Effect.Effect<JarvisTimer | null, JarvisTimerRepositoryError>;
  delete: (id: number) => Effect.Effect<boolean, JarvisTimerRepositoryError>;
  claimDue: (
    workerId: string,
    now: number,
  ) => Effect.Effect<JarvisTimer | null, JarvisTimerRepositoryError>;
  complete: (
    timer: JarvisTimer,
    messageId: number,
    firedAt: number,
  ) => Effect.Effect<boolean, JarvisTimerRepositoryError>;
  fail: (
    timer: JarvisTimer,
    error: string,
    now: number,
  ) => Effect.Effect<boolean, JarvisTimerRepositoryError>;
  pause: (id: number) => Effect.Effect<JarvisTimer | null, JarvisTimerRepositoryError>;
  resume: (
    id: number,
    now: number,
  ) => Effect.Effect<JarvisTimer | null, JarvisTimerRepositoryError>;
  cancel: (id: number) => Effect.Effect<JarvisTimer | null, JarvisTimerRepositoryError>;
  trigger: (
    id: number,
    now: number,
  ) => Effect.Effect<JarvisTimer | null, JarvisTimerRepositoryError>;
};

export type JarvisTimerMessageService = {
  fire: (timer: JarvisTimer) => Effect.Effect<number, JarvisTimerMessageError>;
};

export type JarvisTimerClockService = {
  now: Effect.Effect<number>;
};

export type JarvisTimerWorkerIdentityService = {
  id: string;
};

export type JarvisTimerEnv =
  | JarvisTimerRepositoryService
  | JarvisTimerMessageService
  | JarvisTimerClockService
  | JarvisTimerWorkerIdentityService;

export const JarvisTimerRepository = Context.GenericTag<JarvisTimerRepositoryService>(
  "say-to-me/JarvisTimerRepository",
);
export const JarvisTimerMessage = Context.GenericTag<JarvisTimerMessageService>(
  "say-to-me/JarvisTimerMessage",
);
export const JarvisTimerClock = Context.GenericTag<JarvisTimerClockService>(
  "say-to-me/JarvisTimerClock",
);
export const JarvisTimerWorkerIdentity = Context.GenericTag<JarvisTimerWorkerIdentityService>(
  "say-to-me/JarvisTimerWorkerIdentity",
);

function messageErrorText(error: JarvisTimerMessageError): string {
  return error.cause instanceof Error ? error.cause.message : String(error.cause);
}

export function runDueJarvisTimerOnce(): Effect.Effect<boolean, never, JarvisTimerEnv> {
  return Effect.gen(function* () {
    const repository = yield* JarvisTimerRepository;
    const messages = yield* JarvisTimerMessage;
    const clock = yield* JarvisTimerClock;
    const worker = yield* JarvisTimerWorkerIdentity;
    const now = yield* clock.now;
    const timer = yield* repository.claimDue(worker.id, now);
    if (!timer) return false;

    const messageResult = yield* Effect.either(messages.fire(timer));
    if (messageResult._tag === "Left") {
      const retryAt = yield* clock.now;
      yield* repository.fail(timer, messageErrorText(messageResult.left), retryAt);
      return true;
    }
    const firedAt = yield* clock.now;
    yield* repository.complete(timer, messageResult.right, firedAt);
    return true;
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));
}

export function runDueJarvisTimersUntilIdle(): Effect.Effect<number, never, JarvisTimerEnv> {
  return Effect.gen(function* () {
    let firedCount = 0;
    for (;;) {
      const fired = yield* runDueJarvisTimerOnce();
      if (!fired) return firedCount;
      firedCount += 1;
      if (firedCount >= MAX_TIMER_DRAIN_PER_WAKE) return firedCount;
    }
  });
}

export function jarvisTimerWorkerLoop(
  pollMs = DEFAULT_TIMER_WORKER_POLL_MS,
): Effect.Effect<void, never, JarvisTimerEnv> {
  return runDueJarvisTimersUntilIdle().pipe(
    Effect.zipRight(Effect.void),
    Effect.repeat(Schedule.spaced(`${pollMs} millis`)),
  );
}
