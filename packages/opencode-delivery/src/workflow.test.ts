import { describe, expect, it } from "vite-plus/test";
import { Cause, Effect, Exit, Layer } from "effect";
import {
  DeliveryEffects,
  type DeliveryEffectsService,
  type DeliveryJob,
  type DeliveryMessage,
  MessageStore,
  MessageStoreError,
  type MessageStoreService,
  OpenCodeDeliveryQueue,
  OpenCodeDeliveryQueueError,
  type OpenCodeDeliveryQueueService,
  OpenCodeDeliveryStatus,
  OpenCodePromptClient,
  runOpenCodeDeliveryOnce,
  WorkerIdentity,
} from "./workflow.ts";

function inMemoryMessageStore(seed: DeliveryMessage[]): {
  layer: Layer.Layer<MessageStoreService>;
  get: (id: number) => DeliveryMessage | undefined;
} {
  const rows = new Map<number, DeliveryMessage>(seed.map((m) => [m.id, m]));
  const patch = (id: number, fields: Partial<DeliveryMessage>) => {
    const current = rows.get(id);
    if (current) rows.set(id, { ...current, ...fields });
  };
  const service: MessageStoreService = {
    getMessage: (id) => Effect.succeed(rows.get(id) ?? null),
    updateOpencodeDelivery: (id, status, error, opencodeMessageId) =>
      Effect.sync(() => {
        patch(id, {
          opencodeDeliveryStatus: status,
          opencodeDeliveryError: error,
          opencodeMessageId,
        });
      }),
    markCompletionWorkSeen: (id) =>
      Effect.sync(() => {
        patch(id, { completionWatchWorkSeen: 1 });
      }),
    updateForwardStatus: (id, status) =>
      Effect.sync(() => {
        patch(id, { forwardStatus: status });
      }),
    updateForwardTarget: () => Effect.void,
  };
  return { layer: Layer.succeed(MessageStore, service), get: (id) => rows.get(id) };
}

function recordingEffects(): {
  layer: Layer.Layer<DeliveryEffectsService>;
  broadcasts: string[];
  idleWatches: number[];
} {
  const broadcasts: string[] = [];
  const idleWatches: number[] = [];
  const service: DeliveryEffectsService = {
    broadcastQueue: (sessionId) =>
      Effect.sync(() => {
        broadcasts.push(sessionId ?? "default");
      }),
    startCompletionWatch: () => Effect.void,
    startForwardCompletionNotificationWatch: () => Effect.void,
    startIdleNotificationWatch: (input) =>
      Effect.sync(() => {
        idleWatches.push(input.triggerMessageId);
      }),
  };
  return { layer: Layer.succeed(DeliveryEffects, service), broadcasts, idleWatches };
}

function userMessage(
  overrides: Partial<DeliveryMessage> & { id: number; sessionId: string },
): DeliveryMessage {
  return {
    opencodeDeliveryStatus: "queued",
    opencodeDeliveryError: null,
    opencodeMessageId: null,
    forwardRole: null,
    forwardSourceSessionId: null,
    forwardSourceMessageId: null,
    forwardStatus: null,
    completionWatchStatus: null,
    completionWatchWorkSeen: 0,
    completionSourceSessionId: null,
    completionSourceMessageId: null,
    ...overrides,
  };
}

function directJob(messageId: number, sessionId: string): DeliveryJob {
  return {
    id: 1,
    messageId,
    messageSessionId: sessionId,
    opencodeSessionId: sessionId,
    kind: "direct_user_message",
    status: "running",
    useCli: 0,
    force: 0,
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: 0,
    lockedAt: 100,
    lockedBy: "unit-worker",
    lastError: null,
    opencodeMessageId: null,
    promptDispatchedAt: null,
    cliTurnEndedAt: null,
    createdAt: "2026-06-29 00:00:00",
    updatedAt: "2026-06-29 00:00:00",
  };
}

function unusedEffects(): Layer.Layer<DeliveryEffectsService> {
  return Layer.succeed(DeliveryEffects, {
    broadcastQueue: () => Effect.void,
    startCompletionWatch: () => Effect.void,
    startForwardCompletionNotificationWatch: () => Effect.void,
    startIdleNotificationWatch: () => Effect.void,
  });
}

describe("runOpenCodeDeliveryOnce (package, in-memory)", () => {
  it("marks a delivered message sent and broadcasts, with zero database access", async () => {
    const sessionId = "ses_unitDirect";
    const job = directJob(42, sessionId);
    const store = inMemoryMessageStore([userMessage({ id: 42, sessionId })]);
    const fx = recordingEffects();
    let completedWith: string | null = null;

    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(job),
      complete: (_job, outcome) =>
        Effect.sync(() => {
          completedWith = outcome;
          return true;
        }),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      returnToPending: () => Effect.die("unused"),
    });
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () => Effect.succeed("sent" as const),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("idle"),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "unit-worker" });

    const handled = await Effect.runPromise(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(Layer.mergeAll(queue, prompt, status, worker, store.layer, fx.layer)),
      ),
    );

    expect(handled).toBe(true);
    expect(completedWith).toBe("sent");
    expect(store.get(42)?.opencodeDeliveryStatus).toBe("sent");
    expect(fx.broadcasts).toContain(sessionId);
    expect(fx.idleWatches).toContain(42);
  });

  it("returns a busy non-forced job to pending without sending", async () => {
    const sessionId = "ses_unitBusy";
    const job = directJob(7, sessionId);
    const store = inMemoryMessageStore([userMessage({ id: 7, sessionId })]);
    const fx = recordingEffects();
    let returned = false;

    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(job),
      complete: () => Effect.die("unused"),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      returnToPending: () =>
        Effect.sync(() => {
          returned = true;
          return true;
        }),
    });
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () => Effect.die("should not send"),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("pending"),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "unit-worker" });

    const handled = await Effect.runPromise(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(Layer.mergeAll(queue, prompt, status, worker, store.layer, fx.layer)),
      ),
    );

    expect(handled).toBe(true);
    expect(returned).toBe(true);
    expect(store.get(7)?.opencodeDeliveryStatus).toBe("queued");
    expect(fx.broadcasts).toEqual([]);
  });

  it("marks the prompt before sending and the turn after it settles", async () => {
    const sessionId = "ses_markers";
    const job = directJob(9, sessionId);
    const store = inMemoryMessageStore([userMessage({ id: 9, sessionId })]);
    const markers: string[] = [];
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(job),
      complete: () => Effect.succeed(true),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      returnToPending: () => Effect.die("unused"),
      markDispatched: () =>
        Effect.sync(() => {
          markers.push("dispatched");
          return true;
        }),
      markCliTurnEnded: () =>
        Effect.sync(() => {
          markers.push("ended");
          return true;
        }),
    } satisfies OpenCodeDeliveryQueueService);
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () =>
        Effect.sync(() => {
          markers.push("prompt");
          return "sent" as const;
        }),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("idle"),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "unit-worker" });

    await Effect.runPromise(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(Layer.mergeAll(queue, prompt, status, worker, store.layer, unusedEffects())),
      ),
    );

    expect(markers).toEqual(["dispatched", "prompt", "ended"]);
  });

  it("does not re-prompt after a dispatched prompt fails and is automatically retried", async () => {
    const sessionId = "ses_failedRetry";
    const firstJob = directJob(10, sessionId);
    const retriedJob = { ...firstJob, promptDispatchedAt: 123, lastError: "send failed" };
    const store = inMemoryMessageStore([userMessage({ id: 10, sessionId })]);
    let claims = 0;
    let prompts = 0;
    let retries = 0;
    let failures = 0;
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(claims++ === 0 ? firstJob : retriedJob),
      complete: () => Effect.die("unused"),
      retry: () =>
        Effect.sync(() => {
          retries++;
          return true;
        }),
      fail: () =>
        Effect.sync(() => {
          failures++;
          return true;
        }),
      cancel: () => Effect.die("unused"),
      returnToPending: () => Effect.die("unused"),
      markDispatched: () => Effect.succeed(true),
      markCliTurnEnded: () => Effect.succeed(true),
    } satisfies OpenCodeDeliveryQueueService);
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () =>
        Effect.sync(() => {
          prompts++;
          return "failed" as const;
        }),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("idle"),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "unit-worker" });
    const layer = Layer.mergeAll(queue, prompt, status, worker, store.layer, unusedEffects());

    await Effect.runPromise(runOpenCodeDeliveryOnce().pipe(Effect.provide(layer)));
    await Effect.runPromise(runOpenCodeDeliveryOnce().pipe(Effect.provide(layer)));

    expect(prompts).toBe(1);
    expect(retries).toBe(1);
    expect(failures).toBe(1);
  });

  it("keeps a dispatched in-flight prompt pending instead of failing the message", async () => {
    const sessionId = "ses_inFlightPending";
    const job = { ...directJob(11, sessionId), promptDispatchedAt: 123 };
    const store = inMemoryMessageStore([
      userMessage({ id: 11, sessionId, opencodeDeliveryStatus: "pending" }),
    ]);
    let prompts = 0;
    let completions: string[] = [];
    let failures = 0;
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(job),
      complete: (_job, outcome) =>
        Effect.sync(() => {
          completions.push(outcome);
          return true;
        }),
      retry: () => Effect.die("unused"),
      fail: () =>
        Effect.sync(() => {
          failures++;
          return true;
        }),
      cancel: () => Effect.die("unused"),
      returnToPending: () => Effect.die("unused"),
      markDispatched: () => Effect.die("unused"),
      markCliTurnEnded: () => Effect.die("unused"),
    } satisfies OpenCodeDeliveryQueueService);
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () =>
        Effect.sync(() => {
          prompts++;
          return "failed" as const;
        }),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("pending"),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "unit-worker" });

    await Effect.runPromise(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(Layer.mergeAll(queue, prompt, status, worker, store.layer, unusedEffects())),
      ),
    );

    expect(prompts).toBe(0);
    expect(failures).toBe(0);
    expect(completions).toEqual(["pending"]);
    expect(store.get(11)?.opencodeDeliveryStatus).toBe("pending");
  });

  it("handles a typed store failure instead of dying the worker", async () => {
    const job = directJob(99, "ses_storeBoom");
    const boom = new Error("sqlite exploded");
    const store = Layer.succeed(MessageStore, {
      getMessage: () =>
        Effect.try({
          try: () => {
            throw boom;
          },
          catch: (cause) => new MessageStoreError({ cause }),
        }),
      updateOpencodeDelivery: () => Effect.die("unused"),
      markCompletionWorkSeen: () => Effect.die("unused"),
      updateForwardStatus: () => Effect.die("unused"),
      updateForwardTarget: () => Effect.die("unused"),
    } satisfies MessageStoreService);
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(job),
      complete: () => Effect.die("unused"),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      returnToPending: () => Effect.die("unused"),
    });
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () => Effect.die("should not send"),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.die("should not status"),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "unit-worker" });

    const exit = await Effect.runPromiseExit(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(Layer.mergeAll(queue, prompt, status, worker, store, unusedEffects())),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);
    // CatchAll only covers typed E failures; a Cause.Die would leave Failure.
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
  });

  it("handles a typed queue failure instead of dying the worker", async () => {
    const boom = new Error("sqlite queue exploded");
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () =>
        Effect.try({
          try: () => {
            throw boom;
          },
          catch: (cause) => new OpenCodeDeliveryQueueError({ cause }),
        }),
      complete: () => Effect.die("unused"),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      returnToPending: () => Effect.die("unused"),
    } satisfies OpenCodeDeliveryQueueService);
    const store = inMemoryMessageStore([]);
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () => Effect.die("should not send"),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.die("should not status"),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "unit-worker" });

    const exit = await Effect.runPromiseExit(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(Layer.mergeAll(queue, prompt, status, worker, store.layer, unusedEffects())),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
  });

  it("handles a typed returnToPending queue failure instead of dying", async () => {
    const sessionId = "ses_returnBoom";
    const job = directJob(12, sessionId);
    const boom = new Error("sqlite returnToPending exploded");
    const store = inMemoryMessageStore([userMessage({ id: 12, sessionId })]);
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(job),
      complete: () => Effect.die("unused"),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      returnToPending: () =>
        Effect.try({
          try: () => {
            throw boom;
          },
          catch: (cause) => new OpenCodeDeliveryQueueError({ cause }),
        }),
    } satisfies OpenCodeDeliveryQueueService);
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () => Effect.die("should not send"),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("pending"),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "unit-worker" });

    const exit = await Effect.runPromiseExit(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(Layer.mergeAll(queue, prompt, status, worker, store.layer, unusedEffects())),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
  });
});
