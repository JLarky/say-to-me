import { Cause, Clock, Duration, Effect, Exit, Layer, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  CompletionWatchEffects,
  type CompletionWatchEffectsService,
  CompletionWatchOpenCode,
  CompletionWatchStore,
  CompletionWatchStoreError,
  type CompletionWatchStoreService,
  DEFAULT_COMPLETION_WATCH_QUIET_MS,
  EXTERNAL_CLI_JOB_LEASE_MS,
  type WatchedMessage,
  runCompletionWatchTickEffect,
} from "./workflow.ts";

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

function inMemoryCompletionStore(seed: WatchedMessage[]): {
  layer: Layer.Layer<CompletionWatchStoreService>;
  rows: Map<number, WatchedMessage>;
} {
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
    getSessionIdleGate: () => Effect.succeed("continue"),
    completeSessionIdle: () => Effect.void,
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
        opencodeDeliveryStatus: "sent",
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
          [...store.rows.values()].filter((row) => row.text === "Session is now idle."),
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
      [...store.rows.values()].filter((row) => row.text === "Session is now idle."),
    ).toHaveLength(1);
  });

  it.each(["queued", null] as const)(
    "keeps watching instead of notifying when the target delivery is %s",
    async (deliveryStatus) => {
      const store = inMemoryCompletionStore([
        baseMessage({
          id: 12,
          sessionId: "ses_undeliveredTarget",
          text: "never reached the agent",
          opencodeDeliveryStatus: deliveryStatus,
          // Stale from an earlier attempt: on its own it must not imply completion.
          completionWatchWorkSeen: 1,
          completionSourceSessionId: "ses_undeliveredOwner",
          completionSourceMessageId: 3,
        }),
      ]);
      const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
        getStatus: () => Effect.succeed("idle" as const),
      });
      let idleGateCalls = 0;
      const effects = Layer.succeed(CompletionWatchEffects, {
        broadcastQueue: () => Effect.void,
        getSessionWorkStatus: () => Effect.succeed("idle"),
        enqueueSourceCompletionNotice: () => Effect.void,
        stopWatch: () => Effect.void,
        getActiveBaseUrl: () => Effect.succeed(undefined),
        getSessionIdleGate: () =>
          Effect.sync(() => {
            idleGateCalls += 1;
            return "continue" as const;
          }),
        completeSessionIdle: () => Effect.void,
      } satisfies CompletionWatchEffectsService);

      await Effect.runPromise(
        runCompletionWatchTickEffect(12).pipe(
          Effect.provide(fakeOpenCode),
          Effect.provide(store.layer),
          Effect.provide(effects),
          Effect.provide(TestContext.TestContext),
        ),
      );

      expect(idleGateCalls).toBe(0);
      expect(store.rows.get(12)).toMatchObject({
        completionWatchStatus: "watching",
        completionWatchNextCheckAt: 250,
      });
      expect([...store.rows.values()].filter((row) => row.text.includes("is now idle."))).toEqual(
        [],
      );
    },
  );

  it("notifies once the same target delivery reaches the agent", async () => {
    const store = inMemoryCompletionStore([
      baseMessage({
        id: 13,
        sessionId: "ses_deliveredTarget",
        text: "reached the agent",
        opencodeDeliveryStatus: "queued",
        completionWatchWorkSeen: 1,
      }),
    ]);
    const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
      getStatus: () => Effect.succeed("idle" as const),
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runCompletionWatchTickEffect(13);
        expect(store.rows.get(13)).toMatchObject({ completionWatchStatus: "watching" });

        store.rows.set(13, {
          ...store.rows.get(13)!,
          opencodeDeliveryStatus: "sent",
          completionWatchNextCheckAt: 0,
        });
        yield* runCompletionWatchTickEffect(13);
      }).pipe(
        Effect.provide(fakeOpenCode),
        Effect.provide(store.layer),
        Effect.provide(silentEffects()),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(store.rows.get(13)).toMatchObject({ completionWatchStatus: "completed" });
    expect(
      [...store.rows.values()].filter((row) => row.text === "Session is now idle."),
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
        opencodeDeliveryStatus: "sent",
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
      getSessionIdleGate: () => Effect.succeed("continue"),
      completeSessionIdle: () => Effect.void,
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
      (row) => row.sessionId === sourceSessionId && row.text.includes("is now idle"),
    );
    expect(notice).toMatchObject({ opencodeDeliveryStatus: "queued" });
    expect(enqueued).toEqual([notice!.id]);
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

  it("treats cancelled completion-watch status as terminal and does not notify", async () => {
    const store = inMemoryCompletionStore([
      baseMessage({
        id: 40,
        sessionId: "ses_cancelledWatch",
        text: "already cancelled",
        completionWatchStatus: "cancelled",
        completionWatchWorkSeen: 1,
      }),
    ]);
    const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
      getStatus: () => Effect.die("should not status after cancel"),
    });
    let stopped = false;
    const effects = Layer.succeed(CompletionWatchEffects, {
      broadcastQueue: () => Effect.void,
      getSessionWorkStatus: () => Effect.succeed("idle"),
      enqueueSourceCompletionNotice: () => Effect.void,
      stopWatch: () =>
        Effect.sync(() => {
          stopped = true;
        }),
      getActiveBaseUrl: () => Effect.succeed(undefined),
      getSessionIdleGate: () => Effect.succeed("continue"),
      completeSessionIdle: () => Effect.void,
    } satisfies CompletionWatchEffectsService);

    await Effect.runPromise(
      runCompletionWatchTickEffect(40).pipe(
        Effect.provide(fakeOpenCode),
        Effect.provide(store.layer),
        Effect.provide(effects),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(stopped).toBe(true);
    expect(
      [...store.rows.values()].filter((row) => row.text === "Session is now idle."),
    ).toHaveLength(0);
  });

  it("stops before notify when watch becomes cancelled mid-tick", async () => {
    const store = inMemoryCompletionStore([
      baseMessage({
        id: 41,
        sessionId: "ses_midTickCancel",
        text: "cancel mid tick",
        opencodeDeliveryStatus: "sent",
        completionWatchStatus: "watching",
        completionWatchWorkSeen: 1,
        completionSourceMessageId: 7,
        completionSourceSessionId: "ses_midTickOwner",
      }),
    ]);
    const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
      getStatus: () => Effect.succeed("idle" as const),
    });
    const effects = Layer.succeed(CompletionWatchEffects, {
      broadcastQueue: () => Effect.void,
      getSessionWorkStatus: () => Effect.succeed("idle"),
      enqueueSourceCompletionNotice: () => Effect.void,
      stopWatch: () => Effect.void,
      getActiveBaseUrl: () => Effect.succeed(undefined),
      getSessionIdleGate: () =>
        Effect.sync(() => {
          store.rows.set(41, {
            ...store.rows.get(41)!,
            completionWatchStatus: "cancelled",
          });
          return "continue" as const;
        }),
      completeSessionIdle: () => Effect.void,
    } satisfies CompletionWatchEffectsService);

    await Effect.runPromise(
      runCompletionWatchTickEffect(41).pipe(
        Effect.provide(fakeOpenCode),
        Effect.provide(store.layer),
        Effect.provide(effects),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(store.rows.get(41)?.completionWatchStatus).toBe("cancelled");
    expect(
      [...store.rows.values()].filter((row) => row.text === "Session is now idle."),
    ).toHaveLength(0);
  });

  it("does not emit a source idle notice during a 5x job-lease turn with no mid-turn output", async () => {
    const turnMs = 5 * EXTERNAL_CLI_JOB_LEASE_MS;
    const quietMs = DEFAULT_COMPLETION_WATCH_QUIET_MS;
    const sourceSessionId = "ses_longTurnOwner";
    const targetSessionId = "cur_longTurnTarget";
    const store = inMemoryCompletionStore([
      baseMessage({
        id: 50,
        sessionId: targetSessionId,
        text: "please investigate",
        author: "user",
        opencodeDeliveryStatus: "sent",
        completionWatchStatus: "watching",
        completionSourceSessionId: sourceSessionId,
        completionSourceMessageId: 49,
        forwardSourceMessageId: 49,
        forwardTargetSessionId: targetSessionId,
        forwardTargetMessageId: 50,
      }),
      baseMessage({
        id: 49,
        sessionId: sourceSessionId,
        text: "original forward",
        completionWatchStatus: null,
      }),
    ]);
    const fakeOpenCode = Layer.succeed(CompletionWatchOpenCode, {
      getStatus: () =>
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => (now < turnMs ? ("pending" as const) : ("idle" as const))),
        ),
    });
    const effects = Layer.succeed(CompletionWatchEffects, {
      broadcastQueue: () => Effect.void,
      getSessionWorkStatus: () => Effect.succeed("idle"),
      enqueueSourceCompletionNotice: (input) =>
        Effect.sync(() => {
          const row = store.rows.get(input.messageId);
          if (row) store.rows.set(input.messageId, { ...row, opencodeDeliveryStatus: "sent" });
        }),
      stopWatch: () => Effect.void,
      getActiveBaseUrl: () => Effect.succeed(undefined),
      getSessionIdleGate: () => Effect.succeed("continue"),
      completeSessionIdle: () => Effect.void,
    } satisfies CompletionWatchEffectsService);

    function sourceNotices() {
      return [...store.rows.values()].filter(
        (row) => row.sessionId === sourceSessionId && row.text.includes("is now idle."),
      );
    }

    const tickAt = (ms: number) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(ms);
        yield* runCompletionWatchTickEffect(50, { quietWindowMs: quietMs });
      });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* tickAt(0);
        expect(store.rows.get(50)).toMatchObject({
          completionWatchStatus: "watching",
          completionWatchWorkSeen: 1,
        });
        expect(sourceNotices()).toHaveLength(0);

        yield* tickAt(EXTERNAL_CLI_JOB_LEASE_MS);
        expect(sourceNotices()).toHaveLength(0);
        expect(store.rows.get(50)?.completionWatchStatus).toBe("watching");

        yield* tickAt(2 * EXTERNAL_CLI_JOB_LEASE_MS);
        yield* tickAt(3 * EXTERNAL_CLI_JOB_LEASE_MS);
        yield* tickAt(4 * EXTERNAL_CLI_JOB_LEASE_MS);
        expect(sourceNotices()).toHaveLength(0);
        expect(store.rows.get(50)?.completionWatchStatus).toBe("watching");

        // Do not tick at turnMs-1: that would schedule nextCheckAt just after
        // turnMs and skip the idle observation that starts the quiet window.
        yield* tickAt(turnMs);
        expect(sourceNotices()).toHaveLength(0);
        expect(store.rows.get(50)?.completionWatchStatus).toBe("debouncing");

        yield* tickAt(turnMs + quietMs - 1);
        expect(sourceNotices()).toHaveLength(0);

        yield* tickAt(turnMs + quietMs);
      }).pipe(
        Effect.provide(fakeOpenCode),
        Effect.provide(store.layer),
        Effect.provide(effects),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(store.rows.get(50)).toMatchObject({ completionWatchStatus: "completed" });
    expect(sourceNotices()).toHaveLength(1);
  });
});
