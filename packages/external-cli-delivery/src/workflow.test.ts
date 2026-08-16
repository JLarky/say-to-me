import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  DeliveryEffectsError,
  ExternalCliDeliveryQueueError,
  makeExternalCliDeliveryWorkflow,
  MessageStoreError,
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

function directJob(messageId: number, sessionId: string): ExternalCliDeliveryJob {
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
    createdAt: "2026-06-29 00:00:00",
    updatedAt: "2026-06-29 00:00:00",
  };
}

function inMemoryStore(seed: DeliveryMessage[]): InMemoryStore {
  const rows = new Map(seed.map((row) => [row.id, row]));
  const patch = (id: number, fields: Partial<DeliveryMessage>) => {
    const current = rows.get(id);
    if (current) rows.set(id, { ...current, ...fields });
  };
  const service: MessageStoreService = {
    getMessage: (id) => Effect.succeed(rows.get(id) ?? null),
    updateOpencodeDelivery: (id, status, error) =>
      Effect.sync(() => {
        patch(id, { opencodeDeliveryStatus: status });
        void error;
      }),
    markCompletionWorkSeen: () => Effect.void,
    updateForwardStatus: () => Effect.void,
    updateForwardTarget: () => Effect.void,
  };
  return { layer: Layer.succeed(workflow.MessageStore, service), get: (id) => rows.get(id) };
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

describe("external-cli delivery workflow (in-memory, no DB)", () => {
  it("marks a delivered message sent, inserts reply, and broadcasts", async () => {
    const sessionId = "cc_unitDirect";
    const job = directJob(42, sessionId);
    const store = inMemoryStore([userMessage({ id: 42, sessionId, text: "please echo" })]);
    const fx = recordingEffects();
    let completed = false;

    const queue = Layer.succeed(workflow.DeliveryQueue, {
      claimNext: () => Effect.succeed(job),
      complete: () =>
        Effect.sync(() => {
          completed = true;
          return true;
        }),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      renew: () => Effect.die("unused"),
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
    expect(completed).toBe(true);
    expect(store.get(42)?.opencodeDeliveryStatus).toBe("sent");
    expect(fx.replies).toEqual(["echo: please echo"]);
    expect(fx.broadcasts).toContain(sessionId);
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
      claimNext: () => Effect.succeed(job),
      complete: () => Effect.die("unused"),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      renew: () => Effect.die("unused"),
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
      claimNext: () =>
        Effect.try({
          try: () => {
            throw boom;
          },
          catch: (cause) => new ExternalCliDeliveryQueueError({ cause }),
        }),
      complete: () => Effect.die("unused"),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      renew: () => Effect.die("unused"),
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

  it("renews a lease and rejects stale completions without a database", async () => {
    let lockedAt = 100;
    const job = directJob(9, "cc_lease");
    const queue = Layer.succeed(workflow.DeliveryQueue, {
      claimNext: () => Effect.die("unused"),
      complete: (candidate) =>
        Effect.succeed(candidate.lockedAt === lockedAt && candidate.lockedBy === "renew-worker"),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      renew: (candidate) =>
        Effect.sync(() => {
          if (candidate.lockedBy !== "renew-worker") return null;
          lockedAt = 200;
          return { ...candidate, lockedAt };
        }),
    } satisfies DeliveryQueueService);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const q = yield* workflow.DeliveryQueue;
        const claimed = { ...job, lockedBy: "renew-worker", lockedAt: 100 };
        const renewed = yield* q.renew(claimed);
        expect(renewed).not.toBeNull();
        if (!renewed) throw new Error("Expected renewed job.");
        return {
          oldComplete: yield* q.complete(claimed, "sent"),
          newComplete: yield* q.complete(renewed, "sent"),
        };
      }).pipe(Effect.provide(queue)),
    );

    expect(result).toEqual({ oldComplete: false, newComplete: true });
  });
});
