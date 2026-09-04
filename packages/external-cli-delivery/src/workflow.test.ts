import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  DeliveryEffectsError,
  ExternalCliDeliveryQueueError,
  makeExternalCliDeliveryWorkflow,
  MessageStoreError,
  ProviderFailedError,
  ProviderNotStartedError,
  type DeliveryEffectsService,
  type DeliveryMessage,
  type DeliveryQueueService,
  type ExternalCliDeliveryJob,
  type MessageStoreService,
  type PromptClientService,
  type WorkerIdentityService,
} from "./workflow.ts";

const workflow = makeExternalCliDeliveryWorkflow("say-to-me/unit-external-cli", {
  failureMessage: "unit delivery failed.",
});

type InMemoryStore = {
  layer: Layer.Layer<MessageStoreService>;
  get: (id: number) => DeliveryMessage | undefined;
};

type RecordingEffects = {
  layer: Layer.Layer<DeliveryEffectsService>;
  replies: string[];
  broadcasts: string[];
};

function userMessage(
  overrides: Partial<DeliveryMessage> & { id: number; sessionId: string; text: string },
): DeliveryMessage {
  return {
    opencodeDeliveryStatus: "queued",
    forwardRole: null,
    forwardSourceSessionId: null,
    forwardSourceMessageId: null,
    completionWatchStatus: null,
    completionSourceSessionId: null,
    completionSourceMessageId: null,
    ...overrides,
  };
}

function directJob(
  messageId: number,
  sessionId: string,
  overrides: Partial<ExternalCliDeliveryJob> = {},
): ExternalCliDeliveryJob {
  return {
    id: 1,
    messageId,
    messageSessionId: sessionId,
    externalSessionId: sessionId,
    kind: "direct_user_message",
    status: "running",
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: 0,
    lockedAt: 100,
    lockedBy: "unit-worker",
    lastError: null,
    promptDispatchedAt: null,
    createdAt: "2026-06-29 00:00:00",
    updatedAt: "2026-06-29 00:00:00",
    ...overrides,
  };
}

function inMemoryStore(seed: DeliveryMessage[]): {
  layer: Layer.Layer<MessageStoreService>;
  get: (id: number) => DeliveryMessage | undefined;
  getError: (id: number) => string | null | undefined;
} {
  const rows = new Map(seed.map((row) => [row.id, row]));
  const errors = new Map<number, string | null>();
  const patch = (id: number, fields: Partial<DeliveryMessage>) => {
    const current = rows.get(id);
    if (current) rows.set(id, { ...current, ...fields });
  };
  const service: MessageStoreService = {
    getMessage: (id) => Effect.succeed(rows.get(id) ?? null),
    updateOpencodeDelivery: (id, status, error) =>
      Effect.sync(() => {
        patch(id, { opencodeDeliveryStatus: status });
        errors.set(id, error);
      }),
    markCompletionWorkSeen: () => Effect.void,
    updateForwardStatus: () => Effect.void,
    updateForwardTarget: () => Effect.void,
  };
  return {
    layer: Layer.succeed(workflow.MessageStore, service),
    get: (id) => rows.get(id),
    getError: (id) => errors.get(id),
  };
}

function recordingEffects(): RecordingEffects {
  const replies: string[] = [];
  const broadcasts: string[] = [];
  const service: DeliveryEffectsService = {
    broadcastQueue: (sessionId) =>
      Effect.sync(() => {
        broadcasts.push(sessionId ?? "default");
      }),
    insertAgentReply: (_sessionId, reply) =>
      Effect.sync(() => {
        replies.push(reply);
      }),
    startForwardCompletionNotificationWatch: () => Effect.void,
    startIdleNotificationWatch: () => Effect.void,
  };
  return { layer: Layer.succeed(workflow.DeliveryEffects, service), replies, broadcasts };
}

function unusedQueue(): DeliveryQueueService {
  return {
    claimNext: () => Effect.die("unused"),
    markDispatched: () => Effect.die("unused"),
    markCliTurnEnded: () => Effect.succeed(true),
    complete: () => Effect.die("unused"),
    retry: () => Effect.die("unused"),
    fail: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
    renew: () => Effect.die("unused"),
  };
}

describe("external-cli delivery workflow (in-memory, no DB)", () => {
  it("marks a delivered message sent, inserts reply, and broadcasts", async () => {
    const sessionId = "cc_unitDirect";
    const job = directJob(42, sessionId);
    const store = inMemoryStore([userMessage({ id: 42, sessionId, text: "please echo" })]);
    const fx = recordingEffects();
    let completed = false;
    let dispatched = false;

    const queue = Layer.succeed(workflow.DeliveryQueue, {
      ...unusedQueue(),
      claimNext: () => Effect.succeed(job),
      markDispatched: () =>
        Effect.sync(() => {
          dispatched = true;
          return true;
        }),
      complete: () =>
        Effect.sync(() => {
          completed = true;
          return true;
        }),
    } satisfies DeliveryQueueService);
    const prompt = Layer.succeed(workflow.PromptClient, {
      sendPrompt: (_job, message) => Effect.succeed(`echo: ${message.text}`),
    } satisfies PromptClientService);
    const worker = Layer.succeed(workflow.WorkerIdentity, {
      id: "unit-worker",
    } satisfies WorkerIdentityService);

    const handled = await Effect.runPromise(
      workflow
        .runDeliveryOnce(sessionId)
        .pipe(Effect.provide(Layer.mergeAll(queue, prompt, worker, store.layer, fx.layer))),
    );

    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(completed).toBe(true);
    expect(store.get(42)?.opencodeDeliveryStatus).toBe("sent");
    expect(fx.replies).toEqual(["echo: please echo"]);
    expect(fx.broadcasts).toContain(sessionId);
  });

  it("does not re-prompt after a post-dispatch provider failure", async () => {
    const sessionId = "cc_postDispatch";
    const job = directJob(42, sessionId);
    const store = inMemoryStore([userMessage({ id: 42, sessionId, text: "prompt once" })]);
    const fx = recordingEffects();
    let promptCount = 0;
    let failed = false;
    let retried = false;

    const queue = Layer.succeed(workflow.DeliveryQueue, {
      ...unusedQueue(),
      claimNext: () => Effect.succeed(job),
      markDispatched: () => Effect.succeed(true),
      fail: () =>
        Effect.sync(() => {
          failed = true;
          return true;
        }),
      retry: () =>
        Effect.sync(() => {
          retried = true;
          return true;
        }),
    } satisfies DeliveryQueueService);
    const prompt = Layer.succeed(workflow.PromptClient, {
      sendPrompt: () => {
        promptCount += 1;
        return Effect.fail(new ProviderFailedError({ message: "exited with code 1" }));
      },
    } satisfies PromptClientService);
    const worker = Layer.succeed(workflow.WorkerIdentity, { id: "unit-worker" });

    await Effect.runPromise(
      workflow
        .runDeliveryOnce(sessionId)
        .pipe(Effect.provide(Layer.mergeAll(queue, prompt, worker, store.layer, fx.layer))),
    );

    expect(promptCount).toBe(1);
    expect(failed).toBe(true);
    expect(retried).toBe(false);
    // Collapsed into `failed` so the user gets one actionable state; the
    // uncertainty lives in the explanation, not in a separate status.
    expect(store.get(42)?.opencodeDeliveryStatus).toBe("failed");
    expect(store.getError(42)).toBe("exited with code 1");
  });

  it("retries a spawn failure even though the job is already marked dispatched", async () => {
    const sessionId = "cc_spawnFail";
    const job = directJob(42, sessionId);
    const store = inMemoryStore([userMessage({ id: 42, sessionId, text: "spawn boom" })]);
    const fx = recordingEffects();
    let retried = false;
    let failed = false;

    const queue = Layer.succeed(workflow.DeliveryQueue, {
      ...unusedQueue(),
      claimNext: () => Effect.succeed(job),
      markDispatched: () => Effect.succeed(true),
      retry: () =>
        Effect.sync(() => {
          retried = true;
          return true;
        }),
      fail: () =>
        Effect.sync(() => {
          failed = true;
          return true;
        }),
    } satisfies DeliveryQueueService);
    const prompt = Layer.succeed(workflow.PromptClient, {
      sendPrompt: () => Effect.fail(new ProviderNotStartedError({ message: "spawn ENOENT" })),
    } satisfies PromptClientService);
    const worker = Layer.succeed(workflow.WorkerIdentity, { id: "unit-worker" });

    await Effect.runPromise(
      workflow
        .runDeliveryOnce(sessionId)
        .pipe(Effect.provide(Layer.mergeAll(queue, prompt, worker, store.layer, fx.layer))),
    );

    expect(retried).toBe(true);
    expect(failed).toBe(false);
    expect(store.get(42)?.opencodeDeliveryStatus).toBe("queued");
  });

  it("records nothing when markDispatched reports the lease is lost", async () => {
    const sessionId = "cc_leaseLost";
    const job = directJob(42, sessionId);
    const store = inMemoryStore([userMessage({ id: 42, sessionId, text: "do not send" })]);
    const fx = recordingEffects();
    let prompted = false;
    let failed = false;
    let retried = false;
    let completed = false;

    const queue = Layer.succeed(workflow.DeliveryQueue, {
      ...unusedQueue(),
      claimNext: () => Effect.succeed(job),
      markDispatched: () => Effect.succeed(false),
      complete: () =>
        Effect.sync(() => {
          completed = true;
          return true;
        }),
      retry: () =>
        Effect.sync(() => {
          retried = true;
          return true;
        }),
      fail: () =>
        Effect.sync(() => {
          failed = true;
          return true;
        }),
    } satisfies DeliveryQueueService);
    const prompt = Layer.succeed(workflow.PromptClient, {
      sendPrompt: () => {
        prompted = true;
        return Effect.succeed("should not run");
      },
    } satisfies PromptClientService);
    const worker = Layer.succeed(workflow.WorkerIdentity, { id: "unit-worker" });

    const handled = await Effect.runPromise(
      workflow
        .runDeliveryOnce(sessionId)
        .pipe(Effect.provide(Layer.mergeAll(queue, prompt, worker, store.layer, fx.layer))),
    );

    expect(handled).toBe(true);
    expect(prompted).toBe(false);
    expect(failed).toBe(false);
    expect(retried).toBe(false);
    expect(completed).toBe(false);
    expect(store.get(42)?.opencodeDeliveryStatus).toBe("pending");
  });

  it("handles a typed store failure instead of dying the worker", async () => {
    const job = directJob(7, "cc_storeBoom");
    const boom = new Error("sqlite store exploded");
    const store = Layer.succeed(workflow.MessageStore, {
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
    const queue = Layer.succeed(workflow.DeliveryQueue, {
      ...unusedQueue(),
      claimNext: () => Effect.succeed(job),
    } satisfies DeliveryQueueService);
    const prompt = Layer.succeed(workflow.PromptClient, {
      sendPrompt: () => Effect.die("should not send"),
    });
    const worker = Layer.succeed(workflow.WorkerIdentity, { id: "unit-worker" });
    const fx = Layer.succeed(workflow.DeliveryEffects, {
      broadcastQueue: () => Effect.void,
      insertAgentReply: () => Effect.die("unused"),
      startForwardCompletionNotificationWatch: () => Effect.void,
      startIdleNotificationWatch: () => Effect.void,
    } satisfies DeliveryEffectsService);

    const exit = await Effect.runPromiseExit(
      workflow
        .runDeliveryOnce()
        .pipe(Effect.provide(Layer.mergeAll(queue, prompt, worker, store, fx))),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
  });

  it("handles a typed queue failure instead of dying the worker", async () => {
    const boom = new Error("sqlite queue exploded");
    const queue = Layer.succeed(workflow.DeliveryQueue, {
      ...unusedQueue(),
      claimNext: () =>
        Effect.try({
          try: () => {
            throw boom;
          },
          catch: (cause) => new ExternalCliDeliveryQueueError({ cause }),
        }),
    } satisfies DeliveryQueueService);
    const store = inMemoryStore([]);
    const prompt = Layer.succeed(workflow.PromptClient, {
      sendPrompt: () => Effect.die("should not send"),
    });
    const worker = Layer.succeed(workflow.WorkerIdentity, { id: "unit-worker" });
    const fx = Layer.succeed(workflow.DeliveryEffects, {
      broadcastQueue: () => Effect.fail(new DeliveryEffectsError({ cause: "unused" })),
      insertAgentReply: () => Effect.void,
      startForwardCompletionNotificationWatch: () => Effect.void,
      startIdleNotificationWatch: () => Effect.void,
    });

    const exit = await Effect.runPromiseExit(
      workflow
        .runDeliveryOnce()
        .pipe(Effect.provide(Layer.mergeAll(queue, prompt, worker, store.layer, fx))),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
  });

  it("gates transitions on the lease holder, not on the renewed lease timestamp", async () => {
    let lockedAt = 100;
    const job = directJob(9, "cc_lease");
    const heldByRenewWorker = (candidate: ExternalCliDeliveryJob) =>
      candidate.lockedBy === "renew-worker" && candidate.attemptCount === job.attemptCount;
    const queue = Layer.succeed(workflow.DeliveryQueue, {
      ...unusedQueue(),
      markDispatched: (candidate) => Effect.succeed(heldByRenewWorker(candidate)),
      complete: (candidate) => Effect.succeed(heldByRenewWorker(candidate)),
      renew: (candidate) =>
        Effect.sync(() => {
          if (!heldByRenewWorker(candidate)) return null;
          lockedAt += 100;
          return { ...candidate, lockedAt };
        }),
    } satisfies DeliveryQueueService);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const q = yield* workflow.DeliveryQueue;
        const claimed = { ...job, lockedBy: "renew-worker", lockedAt };
        const renewed = yield* q.renew(claimed);
        expect(renewed).not.toBeNull();
        if (!renewed) throw new Error("Expected renewed job.");
        return {
          completeWithPreRenewalLease: yield* q.complete(claimed, "sent"),
          completeWithRenewedLease: yield* q.complete(renewed, "sent"),
          completeFromAnotherHolder: yield* q.complete({ ...claimed, lockedBy: "other" }, "sent"),
        };
      }).pipe(Effect.provide(queue)),
    );

    expect(result).toEqual({
      completeWithPreRenewalLease: true,
      completeWithRenewedLease: true,
      completeFromAnotherHolder: false,
    });
  });
});
