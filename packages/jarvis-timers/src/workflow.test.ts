import { Cause, Clock, Duration, Effect, Exit, Layer, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  JarvisTimerClock,
  JarvisTimerMessage,
  JarvisTimerMessageError,
  JarvisTimerRepository,
  JarvisTimerRepositoryError,
  JarvisTimerWorkerIdentity,
  runDueJarvisTimersUntilIdle,
  runDueJarvisTimerOnce,
  type JarvisTimer,
  type JarvisTimerRepositoryService,
} from "./workflow.ts";

function timer(overrides: Partial<JarvisTimer> = {}): JarvisTimer {
  return {
    id: 1,
    sessionId: "ses_timerTarget",
    title: "Check build",
    message: "Review the current status.",
    status: "active",
    dueAt: 1_000,
    intervalMs: null,
    nextFireAt: 1_000,
    lastFiredAt: null,
    lastMessageId: null,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: "2026-06-19 00:00:00",
    updatedAt: "2026-06-19 00:00:00",
    ...overrides,
  };
}

function fakeTimerLayers(initialTimer: JarvisTimer, options: { failFire?: boolean } = {}) {
  const state = { timer: initialTimer };
  const calls: string[] = [];
  const repository: JarvisTimerRepositoryService = {
    create: (input) =>
      Effect.sync(() => {
        state.timer = timer({
          ...input,
          id: state.timer.id,
          status: "active",
          nextFireAt: input.dueAt,
        });
        return state.timer;
      }),
    update: (_id, input) =>
      Effect.sync(() => {
        if (state.timer.status !== "active" && state.timer.status !== "paused") return null;
        state.timer = {
          ...state.timer,
          ...input,
          nextFireAt: input.dueAt ?? state.timer.nextFireAt,
          lastError: null,
          lockedAt: null,
          lockedBy: null,
        };
        return state.timer;
      }),
    list: () => Effect.succeed([state.timer]),
    get: () => Effect.succeed(state.timer),
    delete: () => Effect.die("not used"),
    claimDue: (workerId, now) =>
      Effect.sync(() => {
        calls.push(`claim:${workerId}:${now}`);
        if (state.timer.status === "firing" && state.timer.lockedAt == null) {
          state.timer = { ...state.timer, status: "active", lockedAt: null, lockedBy: null };
        }
        if (state.timer.status !== "active" || state.timer.nextFireAt > now) return null;
        state.timer = { ...state.timer, status: "firing", lockedAt: now, lockedBy: workerId };
        return state.timer;
      }),
    complete: (claimed, messageId, firedAt) =>
      Effect.sync(() => {
        calls.push(`complete:${messageId}:${firedAt}`);
        if (claimed.lockedBy !== state.timer.lockedBy) return false;
        state.timer = {
          ...state.timer,
          status: state.timer.intervalMs ? "active" : "completed",
          nextFireAt: state.timer.intervalMs
            ? firedAt + state.timer.intervalMs
            : state.timer.nextFireAt,
          lastFiredAt: firedAt,
          lastMessageId: messageId,
          lockedAt: null,
          lockedBy: null,
        };
        return true;
      }),
    fail: (_claimed, error, now) =>
      Effect.sync(() => {
        calls.push(`fail:${error}:${now}`);
        state.timer = {
          ...state.timer,
          status: "active",
          nextFireAt: now + 5_000,
          lockedAt: null,
          lockedBy: null,
          lastError: error,
        };
        return true;
      }),
    pause: () =>
      Effect.sync(() => {
        if (state.timer.status !== "active" && state.timer.status !== "firing") return null;
        state.timer = { ...state.timer, status: "paused", lockedAt: null, lockedBy: null };
        return state.timer;
      }),
    resume: (_id, now) =>
      Effect.sync(() => {
        if (state.timer.status !== "paused") return null;
        state.timer = {
          ...state.timer,
          status: "active",
          nextFireAt: Math.max(state.timer.nextFireAt, now),
          lockedAt: null,
          lockedBy: null,
        };
        return state.timer;
      }),
    cancel: () =>
      Effect.sync(() => {
        if (
          state.timer.status !== "active" &&
          state.timer.status !== "paused" &&
          state.timer.status !== "firing"
        ) {
          return null;
        }
        state.timer = { ...state.timer, status: "cancelled", lockedAt: null, lockedBy: null };
        return state.timer;
      }),
    trigger: (_id, now) =>
      Effect.sync(() => {
        if (state.timer.status !== "active") return null;
        state.timer = { ...state.timer, nextFireAt: now, lockedAt: null, lockedBy: null };
        return state.timer;
      }),
  };
  const layer = Layer.mergeAll(
    Layer.succeed(JarvisTimerRepository, repository),
    Layer.succeed(JarvisTimerMessage, {
      fire: () =>
        options.failFire
          ? Effect.fail(new JarvisTimerMessageError({ cause: new Error("boom") }))
          : Effect.sync(() => {
              calls.push("fire");
              return 42;
            }),
    }),
    Layer.succeed(JarvisTimerClock, { now: Clock.currentTimeMillis }),
    Layer.succeed(JarvisTimerWorkerIdentity, { id: "test-worker" }),
  );
  return { calls, layer, state };
}

function fakeTimerListLayers(initialTimers: JarvisTimer[]) {
  const state = { timers: initialTimers };
  const calls: string[] = [];
  const repository: JarvisTimerRepositoryService = {
    create: () => Effect.die("not used"),
    update: () => Effect.die("not used"),
    list: () => Effect.succeed(state.timers),
    get: () => Effect.die("not used"),
    delete: () => Effect.die("not used"),
    claimDue: (workerId, now) =>
      Effect.sync(() => {
        const index = state.timers.findIndex(
          (item) => item.status === "active" && item.nextFireAt <= now,
        );
        if (index < 0) return null;
        const claimed = {
          ...state.timers[index]!,
          status: "firing" as const,
          lockedAt: now,
          lockedBy: workerId,
        };
        state.timers[index] = claimed;
        return claimed;
      }),
    complete: (claimed, messageId, firedAt) =>
      Effect.sync(() => {
        calls.push(`complete:${claimed.id}`);
        const index = state.timers.findIndex((item) => item.id === claimed.id);
        if (index < 0) return false;
        state.timers[index] = {
          ...state.timers[index]!,
          status: "completed",
          lastFiredAt: firedAt,
          lastMessageId: messageId,
          lockedAt: null,
          lockedBy: null,
        };
        return true;
      }),
    fail: () => Effect.die("not used"),
    pause: () => Effect.die("not used"),
    resume: () => Effect.die("not used"),
    cancel: () => Effect.die("not used"),
    trigger: () => Effect.die("not used"),
  };
  const layer = Layer.mergeAll(
    Layer.succeed(JarvisTimerRepository, repository),
    Layer.succeed(JarvisTimerMessage, {
      fire: (claimed) =>
        Effect.sync(() => {
          calls.push(`fire:${claimed.id}`);
          return claimed.id + 100;
        }),
    }),
    Layer.succeed(JarvisTimerClock, { now: Clock.currentTimeMillis }),
    Layer.succeed(JarvisTimerWorkerIdentity, { id: "test-worker" }),
  );
  return { calls, layer, state };
}

describe("Jarvis timers Effect workflow", () => {
  it("does not claim a timer before TestClock reaches the due time", async () => {
    const fake = fakeTimerLayers(timer({ nextFireAt: 1_000 }));

    const fired = await Effect.runPromise(
      Effect.gen(function* () {
        const before = yield* runDueJarvisTimerOnce().pipe(Effect.provide(fake.layer));
        yield* TestClock.adjust(Duration.millis(1_000));
        const after = yield* runDueJarvisTimerOnce().pipe(Effect.provide(fake.layer));
        return { after, before };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(fired).toEqual({ before: false, after: true });
    expect(fake.state.timer.status).toBe("completed");
    expect(fake.state.timer.lastMessageId).toBe(42);
  });

  it("reschedules repeated timers after a successful fire", async () => {
    const fake = fakeTimerLayers(timer({ intervalMs: 60_000, nextFireAt: 0 }));

    await Effect.runPromise(
      runDueJarvisTimerOnce().pipe(
        Effect.provide(fake.layer),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(fake.state.timer.status).toBe("active");
    expect(fake.state.timer.nextFireAt).toBe(60_000);
    expect(fake.calls).toContain("fire");
  });

  it("returns a failed fire to active state with an error and retry time", async () => {
    const fake = fakeTimerLayers(timer({ nextFireAt: 0 }), { failFire: true });

    const exit = await Effect.runPromiseExit(
      runDueJarvisTimerOnce().pipe(
        Effect.provide(fake.layer),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);
    expect(fake.state.timer.status).toBe("active");
    expect(fake.state.timer.lastError).toContain("boom");
    expect(fake.state.timer.nextFireAt).toBe(5_000);
    expect(fake.state.timer.lockedAt).toBeNull();
    expect(fake.state.timer.lockedBy).toBeNull();
  });

  it("drains every due timer before going idle", async () => {
    const fake = fakeTimerListLayers([
      timer({ id: 1, nextFireAt: 0 }),
      timer({ id: 2, nextFireAt: 0 }),
      timer({ id: 3, nextFireAt: 1_000 }),
    ]);

    const firedCount = await Effect.runPromise(
      runDueJarvisTimersUntilIdle().pipe(
        Effect.provide(fake.layer),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(firedCount).toBe(2);
    expect(fake.calls).toEqual(["fire:1", "complete:1", "fire:2", "complete:2"]);
    expect(fake.state.timers.map((item) => item.status)).toEqual([
      "completed",
      "completed",
      "active",
    ]);
  });

  it("reclaims a firing timer that lost its lock during restart", async () => {
    const fake = fakeTimerLayers(
      timer({ status: "firing", lockedAt: null, lockedBy: null, nextFireAt: 0 }),
    );

    const claimed = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* JarvisTimerRepository;
        return yield* repository.claimDue("restart-worker", 1_000);
      }).pipe(Effect.provide(fake.layer)),
    );

    expect(claimed).toMatchObject({
      id: 1,
      status: "firing",
      lockedAt: 1_000,
      lockedBy: "restart-worker",
    });
  });

  it("does not edit a firing timer into an unrecoverable unlocked firing state", async () => {
    const fake = fakeTimerLayers(
      timer({ status: "firing", lockedAt: 10, lockedBy: "worker-a", title: "Firing timer" }),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* JarvisTimerRepository;
        const updated = yield* repository.update(1, { title: "Edited while firing" });
        const current = yield* repository.get(1);
        return { current, updated };
      }).pipe(Effect.provide(fake.layer)),
    );

    expect(result.updated).toBeNull();
    expect(result.current).toMatchObject({
      status: "firing",
      lockedAt: 10,
      lockedBy: "worker-a",
      title: "Firing timer",
    });
  });

  it("rejects invalid lifecycle transitions at the repository boundary", async () => {
    const fake = fakeTimerLayers(timer({ status: "completed", lastFiredAt: 1_000 }));

    const invalid = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* JarvisTimerRepository;
        return {
          cancelCompleted: yield* repository.cancel(1),
          pauseCompleted: yield* repository.pause(1),
          resumeCompleted: yield* repository.resume(1, 2_000),
          triggerCompleted: yield* repository.trigger(1, 2_000),
          updateCompleted: yield* repository.update(1, { title: "Nope" }),
        };
      }).pipe(Effect.provide(fake.layer)),
    );

    expect(invalid).toEqual({
      cancelCompleted: null,
      pauseCompleted: null,
      resumeCompleted: null,
      triggerCompleted: null,
      updateCompleted: null,
    });
  });

  it("handles a typed repository failure instead of dying the worker", async () => {
    const boom = new Error("sqlite exploded");
    const repository = Layer.succeed(JarvisTimerRepository, {
      create: () => Effect.die("unused"),
      update: () => Effect.die("unused"),
      list: () => Effect.die("unused"),
      get: () => Effect.die("unused"),
      delete: () => Effect.die("unused"),
      claimDue: () =>
        Effect.try({
          try: () => {
            throw boom;
          },
          catch: (cause) => new JarvisTimerRepositoryError({ cause }),
        }),
      complete: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      pause: () => Effect.die("unused"),
      resume: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      trigger: () => Effect.die("unused"),
    } satisfies JarvisTimerRepositoryService);
    const layer = Layer.mergeAll(
      repository,
      Layer.succeed(JarvisTimerMessage, {
        fire: () => Effect.die("should not fire"),
      }),
      Layer.succeed(JarvisTimerClock, { now: Clock.currentTimeMillis }),
      Layer.succeed(JarvisTimerWorkerIdentity, { id: "test-worker" }),
    );

    const exit = await Effect.runPromiseExit(
      runDueJarvisTimerOnce().pipe(Effect.provide(layer), Effect.provide(TestContext.TestContext)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(false);
    }
  });
});
