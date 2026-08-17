import { Cause, Duration, Effect, Exit, Layer, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  CompletionWatchEffects,
  type CompletionWatchEffectsService,
  CompletionWatchOpenCode,
  CompletionWatchStore,
  CompletionWatchStoreError,
  type CompletionWatchStoreService,
  type WatchedMessage,
  runCompletionWatchTickEffect,
} from "./workflow.ts";

type InMemoryCompletionStore = {
  layer: Layer.Layer<CompletionWatchStoreService>;
  rows: Map<number, WatchedMessage>;
};

function baseMessage(
  overrides: Partial<WatchedMessage> & Pick<WatchedMessage, "id" | "sessionId">,
): WatchedMessage {
  return {
    text: "watch me",
    extraMarkdown: null,
    status: "received",
    author: "user",
    opencodeDeliveryStatus: null,
    opencodeDeliveryError: null,
    opencodeMessageId: null,
    clientMessageId: null,
    links: null,
    sessionRefs: null,
    forwardRole: null,
    forwardSourceSessionId: null,
    forwardSourceMessageId: null,
    forwardTargetSessionId: null,
    forwardTargetMessageId: null,
    forwardStatus: null,
    completionWatchStatus: "watching",
    completionWatchWorkSeen: 0,
    completionWatchNextCheckAt: 0,
    completionSourceSessionId: null,
    completionSourceMessageId: null,
    completionTargetNotificationMessageId: null,
    completionSourceNotificationMessageId: null,
    ...overrides,
  };
}

function inMemoryCompletionStore(seed: WatchedMessage[]): InMemoryCompletionStore {
  const rows = new Map<number, WatchedMessage>(seed.map((row) => [row.id, { ...row }]));
  let seq = Math.max(0, ...seed.map((row) => row.id)) + 1;
  const patch = (id: number, fields: Partial<WatchedMessage>) => {
    const current = rows.get(id);
    if (current) rows.set(id, { ...current, ...fields });
  };
  const service: CompletionWatchStoreService = {
    getMessage: (id) => Effect.succeed(rows.get(id) ?? null),
    insertMessageRow: (input) =>
      Effect.sync(() => {
        const row = baseMessage({
          id: seq++,
          sessionId: input.sessionId,
          text: input.text,
          extraMarkdown: input.extraMarkdown ?? null,
          author: input.author,
          status: input.status,
          links: input.links ?? null,
          sessionRefs: input.sessionRefs ?? null,
          clientMessageId: input.clientMessageId ?? null,
          completionWatchStatus: null,
        });
        rows.set(row.id, row);
        return row;
      }),
    insertForwardMessageRow: (input) =>
      Effect.sync(() => {
        const row = baseMessage({
          id: seq++,
          sessionId: input.sessionId,
          text: input.text,
          author: input.author,
          status: input.status,
          sessionRefs: input.sessionRefs ?? null,
          clientMessageId: input.clientMessageId ?? null,
          forwardRole: input.forwardRole ?? null,
          forwardSourceSessionId: input.forwardSourceSessionId ?? null,
          forwardSourceMessageId: input.forwardSourceMessageId ?? null,
          forwardTargetSessionId: input.forwardTargetSessionId ?? null,
          forwardTargetMessageId: input.forwardTargetMessageId ?? null,
          forwardStatus: input.forwardStatus ?? null,
          completionWatchStatus: null,
        });
        rows.set(row.id, row);
        return row;
      }),
    listQueuedSourceCompletionNotifications: (sourceSessionId, targetSessionId) =>
      Effect.succeed(
        [...rows.values()].filter(
          (row) =>
            row.sessionId === sourceSessionId &&
            row.forwardTargetSessionId === targetSessionId &&
            row.opencodeDeliveryStatus === "queued",
        ),
      ),
    updateMessageText: (id, text) =>
      Effect.sync(() => {
        patch(id, { text });
      }),
    updateOpencodeDelivery: (id, status, error, opencodeMessageId) =>
      Effect.sync(() => {
        patch(id, {
          opencodeDeliveryStatus: status,
          opencodeDeliveryError: error,
          opencodeMessageId,
        });
      }),
    setCompletionTargetNotification: (id, notificationId) =>
      Effect.sync(() => {
        patch(id, { completionTargetNotificationMessageId: notificationId });
      }),
    setCompletionSourceNotification: (id, notificationId) =>
      Effect.sync(() => {
        patch(id, { completionSourceNotificationMessageId: notificationId });
      }),
    setCompletionWatchNextCheckAt: (id, nextCheckAt) =>
      Effect.sync(() => {
        patch(id, { completionWatchNextCheckAt: nextCheckAt });
      }),
    setCompletionWatchStatus: (id, status, nextCheckAt) =>
      Effect.sync(() => {
        patch(id, {
          completionWatchStatus: status,
          completionWatchNextCheckAt: nextCheckAt ?? 0,
        });
      }),
    markCompletionWorkSeen: (id) =>
      Effect.sync(() => {
        patch(id, { completionWatchWorkSeen: 1 });
      }),
  };
  return { layer: Layer.succeed(CompletionWatchStore, service), rows };
}

function silentEffects(): Layer.Layer<CompletionWatchEffectsService> {
  const service: CompletionWatchEffectsService = {
    broadcastQueue: () => Effect.void,
    getSessionWorkStatus: () => Effect.succeed("idle"),
    enqueueSourceCompletionNotice: () => Effect.void,
    stopWatch: () => Effect.void,
    getActiveBaseUrl: () => Effect.succeed(undefined),
  };
  return Layer.succeed(CompletionWatchEffects, service);
}

describe("completion-watch workflow (in-memory, no DB)", () => {
  it("uses the persisted next-check time as the source of truth", async () => {
    const sessionId = "ses_persistedWatchTarget";
    const store = inMemoryCompletionStore([
      baseMessage({
        id: 10,
        sessionId,
        text: "persist watch delay",
        completionWatchNextCheckAt: 1_000,
      }),
    ]);
    const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
      getStatus: () => Effect.succeed("idle" as const),
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runCompletionWatchTickEffect(10);
        expect(store.rows.get(10)).toMatchObject({ completionWatchStatus: "watching" });
        expect(
          [...store.rows.values()].filter((row) => row.text.startsWith("<say-to-me-system>")),
        ).toHaveLength(0);

        store.rows.set(10, { ...store.rows.get(10)!, completionWatchWorkSeen: 1 });

        yield* TestClock.adjust(Duration.millis(1_000));
        yield* runCompletionWatchTickEffect(10);
      }).pipe(
        Effect.provide(fakeOpenCode),
        Effect.provide(store.layer),
        Effect.provide(silentEffects()),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(store.rows.get(10)).toMatchObject({
      completionWatchNextCheckAt: 0,
      completionWatchStatus: "completed",
    });
    expect(
      [...store.rows.values()].filter((row) => row.text.startsWith("<say-to-me-system>")),
    ).toHaveLength(1);
  });

  it("schedules the next check from the delayed status decision time", async () => {
    const store = inMemoryCompletionStore([
      baseMessage({ id: 11, sessionId: "ses_delayedDecision", text: "wait for status" }),
    ]);
    const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
      getStatus: () => TestClock.adjust(Duration.millis(1_000)).pipe(Effect.as("pending" as const)),
    });

    await Effect.runPromise(
      runCompletionWatchTickEffect(11).pipe(
        Effect.provide(fakeOpenCode),
        Effect.provide(store.layer),
        Effect.provide(silentEffects()),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(store.rows.get(11)).toMatchObject({
      completionWatchNextCheckAt: 1_250,
      completionWatchStatus: "watching",
      completionWatchWorkSeen: 1,
    });
  });

  it("queues a source completion notice while the source session is busy", async () => {
    const sourceSessionId = "ses_sourceBusy";
    const targetSessionId = "ses_targetIdle";
    const store = inMemoryCompletionStore([
      baseMessage({
        id: 20,
        sessionId: targetSessionId,
        text: "please continue",
        completionWatchWorkSeen: 1,
        completionSourceSessionId: sourceSessionId,
        completionSourceMessageId: 99,
        forwardSourceMessageId: 99,
        forwardTargetSessionId: targetSessionId,
        forwardTargetMessageId: 20,
      }),
      baseMessage({
        id: 99,
        sessionId: sourceSessionId,
        text: "original forward",
        completionWatchStatus: null,
      }),
    ]);
    const enqueued: number[] = [];
    const effects = Layer.succeed(CompletionWatchEffects, {
      broadcastQueue: () => Effect.void,
      getSessionWorkStatus: () => Effect.succeed("pending"),
      enqueueSourceCompletionNotice: (input) =>
        Effect.sync(() => {
          enqueued.push(input.messageId);
        }),
      stopWatch: () => Effect.void,
      getActiveBaseUrl: () => Effect.succeed(undefined),
    } satisfies CompletionWatchEffectsService);
    const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
      getStatus: () => Effect.succeed("idle" as const),
    });

    await Effect.runPromise(
      runCompletionWatchTickEffect(20).pipe(
        Effect.provide(fakeOpenCode),
        Effect.provide(store.layer),
        Effect.provide(effects),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(store.rows.get(20)).toMatchObject({ completionWatchStatus: "completed" });
    const notice = [...store.rows.values()].find(
      (row) => row.sessionId === sourceSessionId && row.text.includes("is idle now after"),
    );
    expect(notice).toMatchObject({ opencodeDeliveryStatus: "queued" });
    expect(enqueued).toEqual([]);
  });

  it("handles a typed store failure instead of dying the tick", async () => {
    const boom = new Error("sqlite exploded");
    const store = Layer.succeed(CompletionWatchStore, {
      getMessage: () =>
        Effect.try({
          try: () => {
            throw boom;
          },
          catch: (cause) => new CompletionWatchStoreError({ cause }),
        }),
      insertMessageRow: () => Effect.die("unused"),
      insertForwardMessageRow: () => Effect.die("unused"),
      listQueuedSourceCompletionNotifications: () => Effect.die("unused"),
      updateMessageText: () => Effect.die("unused"),
      updateOpencodeDelivery: () => Effect.die("unused"),
      setCompletionTargetNotification: () => Effect.die("unused"),
      setCompletionSourceNotification: () => Effect.die("unused"),
      setCompletionWatchNextCheckAt: () => Effect.die("unused"),
      setCompletionWatchStatus: () => Effect.die("unused"),
      markCompletionWorkSeen: () => Effect.die("unused"),
    } satisfies CompletionWatchStoreService);
    const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
      getStatus: () => Effect.die("should not status"),
    });

    const exit = await Effect.runPromiseExit(
      runCompletionWatchTickEffect(55).pipe(
        Effect.provide(fakeOpenCode),
        Effect.provide(store),
        Effect.provide(silentEffects()),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
  });
});
