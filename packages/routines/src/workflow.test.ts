import { Cause, Clock, Duration, Effect, Exit, Layer, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  RoutineClock,
  RoutineMessage,
  RoutineMessageError,
  RoutineRepository,
  RoutineRepositoryError,
  RoutineWorkerIdentity,
  runDueRoutinesUntilIdle,
  runDueRoutineOnce,
  type Routine,
  type RoutineRepositoryService,
} from "./workflow.ts";

function routine(overrides: Partial<Routine> = {}): Routine {
  const defaultTrigger = {
    kind: "schedule" as const,
    dueAt: 1_000,
    intervalMs: null,
    nextFireAt: 1_000,
  };
  const defaultAction = {
    kind: "deliver_prompt" as const,
    title: "Check build",
    message: "Review the current status.",
  };
  return {
    id: 1,
    ownerSessionId: "ses_timerTarget",
    title: "Check build",
    status: "active",
    lastFiredAt: null,
    lastMessageId: null,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: "2026-06-19 00:00:00",
    updatedAt: "2026-06-19 00:00:00",
    ...overrides,
    trigger: { ...defaultTrigger, ...overrides.trigger },
    action: { ...defaultAction, ...overrides.action },
  };
}

function fakeRoutineLayers(initialRoutine: Routine, options: { failFire?: boolean } = {}) {
  const state = { routine: initialRoutine };
  const calls: string[] = [];
  const repository: RoutineRepositoryService = {
    create: (input) =>
      Effect.sync(() => {
        state.routine = routine({
          ownerSessionId: input.ownerSessionId,
          title: input.title ?? input.action.title,
          trigger: {
            kind: "schedule",
            dueAt: input.trigger.dueAt,
            intervalMs: input.trigger.intervalMs,
            nextFireAt: input.trigger.dueAt,
          },
          action: input.action,
          id: state.routine.id,
          status: "active",
        });
        return state.routine;
      }),
    update: (_id, input) =>
      Effect.sync(() => {
        if (state.routine.status !== "active" && state.routine.status !== "paused") return null;
        state.routine = {
          ...state.routine,
          ...(input.ownerSessionId !== undefined ? { ownerSessionId: input.ownerSessionId } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          trigger: {
            ...state.routine.trigger,
            ...(input.trigger?.dueAt !== undefined ? { dueAt: input.trigger.dueAt } : {}),
            ...(input.trigger?.intervalMs !== undefined
              ? { intervalMs: input.trigger.intervalMs }
              : {}),
            nextFireAt: input.trigger?.dueAt ?? state.routine.trigger.nextFireAt,
          },
          action: input.action
            ? {
                ...state.routine.action,
                ...input.action,
                kind: "deliver_prompt",
              }
            : state.routine.action,
          lastError: null,
          lockedAt: null,
          lockedBy: null,
        };
        return state.routine;
      }),
    list: () => Effect.succeed([state.routine]),
    get: () => Effect.succeed(state.routine),
    delete: () => Effect.die("not used"),
    claimDue: (workerId, now) =>
      Effect.sync(() => {
        calls.push(`claim:${workerId}:${now}`);
        if (state.routine.status === "firing" && state.routine.lockedAt == null) {
          state.routine = { ...state.routine, status: "active", lockedAt: null, lockedBy: null };
        }
        if (state.routine.status !== "active" || state.routine.trigger.nextFireAt > now) {
          return null;
        }
        state.routine = {
          ...state.routine,
          status: "firing",
          lockedAt: now,
          lockedBy: workerId,
        };
        return state.routine;
      }),
    complete: (claimed, messageId, firedAt) =>
      Effect.sync(() => {
        calls.push(`complete:${messageId}:${firedAt}`);
        if (claimed.lockedBy !== state.routine.lockedBy) return false;
        state.routine = {
          ...state.routine,
          status: state.routine.trigger.intervalMs ? "active" : "fired",
          trigger: {
            ...state.routine.trigger,
            nextFireAt: state.routine.trigger.intervalMs
              ? firedAt + state.routine.trigger.intervalMs
              : state.routine.trigger.nextFireAt,
          },
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
        state.routine = {
          ...state.routine,
          status: "active",
          trigger: { ...state.routine.trigger, nextFireAt: now + 5_000 },
          lockedAt: null,
          lockedBy: null,
          lastError: error,
        };
        return true;
      }),
    pause: () =>
      Effect.sync(() => {
        if (state.routine.status !== "active" && state.routine.status !== "firing") return null;
        state.routine = { ...state.routine, status: "paused", lockedAt: null, lockedBy: null };
        return state.routine;
      }),
    resume: (_id, now) =>
      Effect.sync(() => {
        if (state.routine.status !== "paused") return null;
        state.routine = {
          ...state.routine,
          status: "active",
          trigger: {
            ...state.routine.trigger,
            nextFireAt: Math.max(state.routine.trigger.nextFireAt, now),
          },
          lockedAt: null,
          lockedBy: null,
        };
        return state.routine;
      }),
    cancel: () =>
      Effect.sync(() => {
        if (
          state.routine.status !== "active" &&
          state.routine.status !== "paused" &&
          state.routine.status !== "firing"
        ) {
          return null;
        }
        state.routine = { ...state.routine, status: "cancelled", lockedAt: null, lockedBy: null };
        return state.routine;
      }),
    trigger: (_id, now) =>
      Effect.sync(() => {
        if (state.routine.status !== "active") return null;
        state.routine = {
          ...state.routine,
          trigger: { ...state.routine.trigger, nextFireAt: now },
          lockedAt: null,
          lockedBy: null,
        };
        return state.routine;
      }),
  };
  const layer = Layer.mergeAll(
    Layer.succeed(RoutineRepository, repository),
    Layer.succeed(RoutineMessage, {
      fire: () =>
        options.failFire
          ? Effect.fail(new RoutineMessageError({ cause: new Error("boom") }))
          : Effect.sync(() => {
              calls.push("fire");
              return 42;
            }),
    }),
    Layer.succeed(RoutineClock, { now: Clock.currentTimeMillis }),
    Layer.succeed(RoutineWorkerIdentity, { id: "test-worker" }),
  );
  return { calls, layer, state };
}

function fakeRoutineListLayers(initialRoutines: Routine[]) {
  const state = { routines: initialRoutines };
  const calls: string[] = [];
  const repository: RoutineRepositoryService = {
    create: () => Effect.die("not used"),
    update: () => Effect.die("not used"),
    list: () => Effect.succeed(state.routines),
    get: () => Effect.die("not used"),
    delete: () => Effect.die("not used"),
    claimDue: (workerId, now) =>
      Effect.sync(() => {
        const index = state.routines.findIndex(
          (item) => item.status === "active" && item.trigger.nextFireAt <= now,
        );
        if (index < 0) return null;
        const claimed = {
          ...state.routines[index]!,
          status: "firing" as const,
          lockedAt: now,
          lockedBy: workerId,
        };
        state.routines[index] = claimed;
        return claimed;
      }),
    complete: (claimed, messageId, firedAt) =>
      Effect.sync(() => {
        calls.push(`complete:${claimed.id}`);
        const index = state.routines.findIndex((item) => item.id === claimed.id);
        if (index < 0) return false;
        state.routines[index] = {
          ...state.routines[index]!,
          status: "fired",
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
    Layer.succeed(RoutineRepository, repository),
    Layer.succeed(RoutineMessage, {
      fire: (claimed) =>
        Effect.sync(() => {
          calls.push(`fire:${claimed.id}`);
          return claimed.id + 100;
        }),
    }),
    Layer.succeed(RoutineClock, { now: Clock.currentTimeMillis }),
    Layer.succeed(RoutineWorkerIdentity, { id: "test-worker" }),
  );
  return { calls, layer, state };
}

describe("Routines Effect workflow", () => {
  it("does not claim a routine before TestClock reaches the due time", async () => {
    const fake = fakeRoutineLayers(
      routine({ trigger: { kind: "schedule", dueAt: 1_000, intervalMs: null, nextFireAt: 1_000 } }),
    );

    const fired = await Effect.runPromise(
      Effect.gen(function* () {
        const before = yield* runDueRoutineOnce().pipe(Effect.provide(fake.layer));
        yield* TestClock.adjust(Duration.millis(1_000));
        const after = yield* runDueRoutineOnce().pipe(Effect.provide(fake.layer));
        return { after, before };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(fired).toEqual({ before: false, after: true });
    expect(fake.state.routine.status).toBe("fired");
    expect(fake.state.routine.lastMessageId).toBe(42);
  });

  it("reschedules repeated routines after a successful fire", async () => {
    const fake = fakeRoutineLayers(
      routine({
        trigger: { kind: "schedule", dueAt: 0, intervalMs: 60_000, nextFireAt: 0 },
      }),
    );

    await Effect.runPromise(
      runDueRoutineOnce().pipe(Effect.provide(fake.layer), Effect.provide(TestContext.TestContext)),
    );

    expect(fake.state.routine.status).toBe("active");
    expect(fake.state.routine.trigger.nextFireAt).toBe(60_000);
    expect(fake.calls).toContain("fire");
  });

  it("returns a failed fire to active state with an error and retry time", async () => {
    const fake = fakeRoutineLayers(
      routine({ trigger: { kind: "schedule", dueAt: 0, intervalMs: null, nextFireAt: 0 } }),
      { failFire: true },
    );

    const exit = await Effect.runPromiseExit(
      runDueRoutineOnce().pipe(Effect.provide(fake.layer), Effect.provide(TestContext.TestContext)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);
    expect(fake.state.routine.status).toBe("active");
    expect(fake.state.routine.lastError).toContain("boom");
    expect(fake.state.routine.trigger.nextFireAt).toBe(5_000);
    expect(fake.state.routine.lockedAt).toBeNull();
    expect(fake.state.routine.lockedBy).toBeNull();
  });

  it("drains every due routine before going idle", async () => {
    const fake = fakeRoutineListLayers([
      routine({ id: 1, trigger: { kind: "schedule", dueAt: 0, intervalMs: null, nextFireAt: 0 } }),
      routine({ id: 2, trigger: { kind: "schedule", dueAt: 0, intervalMs: null, nextFireAt: 0 } }),
      routine({
        id: 3,
        trigger: { kind: "schedule", dueAt: 1_000, intervalMs: null, nextFireAt: 1_000 },
      }),
    ]);

    const firedCount = await Effect.runPromise(
      runDueRoutinesUntilIdle().pipe(
        Effect.provide(fake.layer),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(firedCount).toBe(2);
    expect(fake.calls).toEqual(["fire:1", "complete:1", "fire:2", "complete:2"]);
    expect(fake.state.routines.map((item) => item.status)).toEqual(["fired", "fired", "active"]);
  });

  it("reclaims a firing routine that lost its lock during restart", async () => {
    const fake = fakeRoutineLayers(
      routine({
        status: "firing",
        lockedAt: null,
        lockedBy: null,
        trigger: { kind: "schedule", dueAt: 0, intervalMs: null, nextFireAt: 0 },
      }),
    );

    const claimed = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* RoutineRepository;
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

  it("does not edit a firing routine into an unrecoverable unlocked firing state", async () => {
    const fake = fakeRoutineLayers(
      routine({
        status: "firing",
        lockedAt: 10,
        lockedBy: "worker-a",
        title: "Firing routine",
        action: {
          kind: "deliver_prompt",
          title: "Firing routine",
          message: "Review the current status.",
        },
      }),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* RoutineRepository;
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
      title: "Firing routine",
    });
  });

  it("rejects invalid lifecycle transitions at the repository boundary", async () => {
    const fake = fakeRoutineLayers(routine({ status: "fired", lastFiredAt: 1_000 }));

    const invalid = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* RoutineRepository;
        return {
          cancelFired: yield* repository.cancel(1),
          pauseFired: yield* repository.pause(1),
          resumeFired: yield* repository.resume(1, 2_000),
          triggerFired: yield* repository.trigger(1, 2_000),
          updateFired: yield* repository.update(1, { title: "Nope" }),
        };
      }).pipe(Effect.provide(fake.layer)),
    );

    expect(invalid).toEqual({
      cancelFired: null,
      pauseFired: null,
      resumeFired: null,
      triggerFired: null,
      updateFired: null,
    });
  });

  it("handles a typed repository failure instead of dying the worker", async () => {
    const boom = new Error("sqlite exploded");
    const repository = Layer.succeed(RoutineRepository, {
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
          catch: (cause) => new RoutineRepositoryError({ cause }),
        }),
      complete: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      pause: () => Effect.die("unused"),
      resume: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      trigger: () => Effect.die("unused"),
    } satisfies RoutineRepositoryService);
    const layer = Layer.mergeAll(
      repository,
      Layer.succeed(RoutineMessage, {
        fire: () => Effect.die("should not fire"),
      }),
      Layer.succeed(RoutineClock, { now: Clock.currentTimeMillis }),
      Layer.succeed(RoutineWorkerIdentity, { id: "test-worker" }),
    );

    const exit = await Effect.runPromiseExit(
      runDueRoutineOnce().pipe(Effect.provide(layer), Effect.provide(TestContext.TestContext)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(false);
    }
  });
});
