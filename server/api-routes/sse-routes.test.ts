import { Duration, Effect, Fiber, Option, TestClock, TestContext } from "effect";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { broadcastDebounceMs, opencodeStatusTimeoutMs } from "../config.ts";
import type { SseClient } from "../sse/client.ts";

const { createApiMiddleware, createTestRequest, expectHandledResponse, listen, closeTestServer } =
  await import("../api.harness.ts");
const {
  _setRefreshOpenCodeStatus,
  _setGetSession,
  broadcastQueueEffect,
  debouncedBroadcastSessions,
  listPresence,
  queueSseClientCount,
  registerQueueSseClient,
  registerSessionListSseClient,
  resetBroadcastStateForTest,
  unregisterQueueSseClient,
  unregisterSessionListSseClient,
} = await import("../broadcast.ts");
const { dispatchSseApiRequest, startQueueSseClient } = await import("./sse-routes.ts");
const { dispatchApiRequest } = await import("./dispatch-api-request.ts");
const { dispatchEffectApiRequest } = await import("./effect-api.ts");
const { insertMessageRow, updateOpencodeDelivery } = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { cursorSessionFilePath } = await import("../cursor/delivery.ts");
const { shutdownCursorActivityHub } = await import("../cursor/activity-hub.ts");

function fakeSseClient(): SseClient {
  return {
    close() {},
    write: async () => {},
  };
}

describe("dispatchSseApiRequest", () => {
  it("matches SSE routes and excludes JSON and upload paths", async () => {
    expect(
      await dispatchSseApiRequest(new Request("http://say.local/api/sessions/events")),
    ).toBeInstanceOf(Response);
    expect(
      await dispatchSseApiRequest(new Request("http://say.local/api/notifications/events")),
    ).toBeInstanceOf(Response);
    expect(
      await dispatchSseApiRequest(
        new Request("http://say.local/api/sessions/ses_9a996d7dfb9881WALflfJllWuP/events"),
      ),
    ).toBeInstanceOf(Response);
    expect(
      await dispatchSseApiRequest(
        new Request("http://say.local/api/sessions/default/agent-events"),
      ),
    ).toBeInstanceOf(Response);
    expect(await dispatchSseApiRequest(new Request("http://say.local/api/events"))).toBeInstanceOf(
      Response,
    );
    expect(
      await dispatchSseApiRequest(new Request("http://say.local/api/messages/1/agent-events")),
    ).toBeInstanceOf(Response);

    expect(await dispatchSseApiRequest(new Request("http://say.local/api/queue"))).toBeNull();
    expect(
      await dispatchSseApiRequest(
        new Request("http://say.local/api/uploads/image", { method: "POST" }),
      ),
    ).toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_9a996d7dfb9881WALflfJllWuP/events"),
      ),
    ).toBeNull();
  });

  it("returns 400 for malformed session ids on session SSE routes", async () => {
    const response = await dispatchSseApiRequest(
      new Request("http://say.local/api/sessions/bad%20session/events"),
    );
    expect(response?.status).toBe(400);
  });

  it("registers agent listeners when opening session agent-events", async () => {
    const before = listPresence().find((item) => item.sessionId === "default")?.agentListeners ?? 0;
    const response = await dispatchSseApiRequest(
      new Request("http://say.local/api/sessions/default/agent-events"),
    );
    expect(response?.status).toBe(200);
    expect(listPresence()).toContainEqual({
      sessionId: "default",
      agentListeners: before + 1,
    });
    await response?.body?.cancel();
  });

  it("does not register per-session queue clients after disconnecting before snapshot resolves", async () => {
    let resolveSnapshot!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveSnapshot = resolve;
    });
    const sessionId = "ses_deec603c960f3viJbF3xoNKV65";
    const before = queueSseClientCount(sessionId);
    const cleanup = startQueueSseClient(fakeSseClient(), sessionId, {
      writeSnapshot: () => done,
    });

    cleanup();
    resolveSnapshot();
    await done;
    await Promise.resolve();

    expect(queueSseClientCount(sessionId)).toBe(before);
  });

  it("does not register default queue clients after disconnecting before snapshot resolves", async () => {
    let resolveSnapshot!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveSnapshot = resolve;
    });
    const before = queueSseClientCount("default");
    const cleanup = startQueueSseClient(fakeSseClient(), "default", {
      heartbeat: false,
      writeSnapshot: () => done,
    });

    cleanup();
    resolveSnapshot();
    await done;
    await Promise.resolve();

    expect(queueSseClientCount("default")).toBe(before);
  });

  it("streams external CLI activity through the existing session events route", async () => {
    const previousRoot = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    const testHome = mkdtempSync(path.join(tmpdir(), "say-session-sse-activity-home-"));
    const testCwd = mkdtempSync(path.join(tmpdir(), "say-session-sse-activity-cwd-"));
    const sessionId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";
    process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
    try {
      setSessionCwd(sessionId, testCwd);
      const transcriptPath = cursorSessionFilePath(testCwd, sessionId);
      mkdirSync(path.dirname(transcriptPath), { recursive: true });
      writeFileSync(
        transcriptPath,
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "Cursor on session stream." }] },
        }),
      );

      const response = await dispatchSseApiRequest(
        new Request(`http://say.local/api/sessions/${sessionId}/events`),
      );
      expect(response?.status).toBe(200);
      const reader = response!.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      try {
        for (let i = 0; i < 6 && !text.includes("externalCliActivity"); i += 1) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += decoder.decode(chunk.value);
        }
      } finally {
        await reader.cancel();
      }

      expect(text).toContain("event: snapshot");
      expect(text).toContain("externalCliActivity");
      expect(text).toContain("Cursor on session stream.");
    } finally {
      shutdownCursorActivityHub();
      if (previousRoot === undefined) delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
      else process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = previousRoot;
      rmSync(testHome, { recursive: true, force: true });
      rmSync(testCwd, { recursive: true, force: true });
    }
  });

  it("broadcasts to sessions whose messages reference the changed session", async () => {
    const sourceSessionId = "ses_8b484ae6bd6713jZxeeChOtsPt";
    const targetSessionId = "ses_d532d2964c6dCKyd9Y7poCGdUr";
    const chunks: string[] = [];
    const client: SseClient = {
      close() {},
      write: async (chunk) => {
        chunks.push(chunk);
      },
    };
    insertMessageRow({
      sessionId: sourceSessionId,
      text: `Check say-to-me(${targetSessionId})`,
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: JSON.stringify([{ id: targetSessionId }]),
      clientMessageId: null,
    });
    const targetMessage = insertMessageRow({
      sessionId: targetSessionId,
      text: "target update",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    registerQueueSseClient(sourceSessionId, client);
    try {
      updateOpencodeDelivery(targetMessage.id, "sent", null, null);
      // Drive the debounced fan-out on the Effect Clock: advance past the status
      // refresh timeout (Clock-bound) and the debounce window so the broadcast
      // flushes to the source session that references the changed target.
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(broadcastQueueEffect(targetSessionId));
          yield* TestClock.adjust(
            Duration.millis(opencodeStatusTimeoutMs + broadcastDebounceMs + 10),
          );
          yield* Fiber.join(fiber);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );

      expect(chunks.some((chunk) => chunk.includes(`"latestMessageText":"target update"`))).toBe(
        true,
      );
    } finally {
      unregisterQueueSseClient(sourceSessionId, client);
    }
  });
});

describe("dispatchApiRequest", () => {
  it("handles Effect and SSE routes and falls through unmatched API paths", async () => {
    const queueRequest = createTestRequest("/api/queue");
    const queue = expectHandledResponse(await dispatchApiRequest(queueRequest), queueRequest);
    expect(queue.status).toBe(200);
    expect(await queue.json()).toHaveProperty("messages");

    const sseRequest = createTestRequest("/api/events");
    const sse = expectHandledResponse(await dispatchApiRequest(sseRequest), sseRequest);
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    await sse.body?.cancel();

    const missing = await dispatchApiRequest(createTestRequest("/api/definitely-missing"));
    expect(missing).toBeNull();
  });

  it("registers agent listeners through the mounted Express adapter", async () => {
    const before = listPresence().find((item) => item.sessionId === "default")?.agentListeners ?? 0;
    const { server, origin } = await listen(createApiMiddleware());
    try {
      const listener = await fetch(`${origin}/api/sessions/default/agent-events`);
      expect(listener.status).toBe(200);
      expect(listener.headers.get("content-type")).toContain("text/event-stream");
      expect(listPresence()).toContainEqual({
        sessionId: "default",
        agentListeners: before + 1,
      });
      await listener.body?.cancel();
    } finally {
      await closeTestServer(server);
    }
  });
});

describe("broadcast debounce timers", () => {
  it("fires the session-list broadcast on the Effect Clock (TestClock-controlled)", async () => {
    const writes: string[] = [];
    const client: SseClient = {
      close() {},
      write: async (chunk) => {
        writes.push(chunk);
      },
    };
    registerSessionListSseClient(client, {
      includeCachedStatus: false,
      includeJarvisOverviewDetails: false,
    });
    try {
      const stillSuspendedBeforeWindow = await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(debouncedBroadcastSessions());
          // The debounce delay is virtual now: the fiber stays suspended until
          // the Clock advances past the window. (poll is None while suspended.)
          yield* TestClock.adjust(Duration.millis(broadcastDebounceMs - 1));
          const midPoll = yield* fiber.poll;
          // Advancing past the window wakes the fiber and flushes the snapshot.
          yield* TestClock.adjust(Duration.millis(1));
          yield* Fiber.join(fiber);
          return Option.isNone(midPoll);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
      expect(stillSuspendedBeforeWindow).toBe(true);
      // The flush wrote a session-list snapshot to the registered client.
      expect(writes.length).toBeGreaterThanOrEqual(1);
    } finally {
      unregisterSessionListSseClient(client);
    }
  });

  it("defers session-list snapshot until after OpenCode status refresh (ordering guarantee)", async () => {
    const writes: string[] = [];
    let refreshStarted = false;
    _setRefreshOpenCodeStatus((_s) => {
      refreshStarted = true;
      return Effect.sleep(Duration.days(365));
    });
    const client: SseClient = {
      close() {},
      write: async (chunk) => {
        writes.push(chunk);
      },
    };
    const sourceSessionId = "ses_refreshOrderSource";
    const targetSessionId = "ses_refreshOrderTarget";
    insertMessageRow({
      sessionId: sourceSessionId,
      text: `Check say-to-me(${targetSessionId})`,
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: JSON.stringify([{ id: targetSessionId }]),
      clientMessageId: null,
    });
    const targetMessage = insertMessageRow({
      sessionId: targetSessionId,
      text: "ordering test",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(targetMessage.id, "sent", null, null);
    resetBroadcastStateForTest();
    registerSessionListSseClient(client, {
      includeCachedStatus: true,
      includeJarvisOverviewDetails: false,
    });
    const writesBeforeBroadcast = writes.length;
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(broadcastQueueEffect(targetSessionId));
          // Stay well inside the timeout window so scheduler jitter cannot make
          // the timeout race the assertion below.
          yield* TestClock.adjust(
            Duration.millis(Math.max(1, Math.floor(opencodeStatusTimeoutMs / 2))),
          );
          expect(refreshStarted).toBe(true);
          expect(writes.length).toBe(writesBeforeBroadcast);
          yield* TestClock.adjust(
            Duration.millis(opencodeStatusTimeoutMs + broadcastDebounceMs * 2 + 10),
          );
          yield* Fiber.join(fiber);
          expect(writes.length).toBeGreaterThanOrEqual(1);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    } finally {
      _setRefreshOpenCodeStatus(undefined);
      unregisterSessionListSseClient(client);
    }
  });

  it("emits session-list snapshot even when OpenCode status refresh fails", async () => {
    const writes: string[] = [];
    let refreshStarted = false;
    _setRefreshOpenCodeStatus((_s) => {
      refreshStarted = true;
      return Effect.sleep(Duration.millis(1)).pipe(
        Effect.zipRight(Effect.fail("simulated refresh failure")),
      );
    });
    const client: SseClient = {
      close() {},
      write: async (chunk) => {
        writes.push(chunk);
      },
    };
    const sourceSessionId = "ses_refreshFailSource";
    const targetSessionId = "ses_refreshFailTarget";
    insertMessageRow({
      sessionId: sourceSessionId,
      text: `Check say-to-me(${targetSessionId})`,
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: JSON.stringify([{ id: targetSessionId }]),
      clientMessageId: null,
    });
    const targetMessage = insertMessageRow({
      sessionId: targetSessionId,
      text: "failure test",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(targetMessage.id, "sent", null, null);
    registerSessionListSseClient(client, {
      includeCachedStatus: true,
      includeJarvisOverviewDetails: false,
    });
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(broadcastQueueEffect(targetSessionId));
          yield* TestClock.adjust(
            Duration.millis(opencodeStatusTimeoutMs + broadcastDebounceMs * 2 + 10),
          );
          yield* Fiber.join(fiber);
          expect(refreshStarted).toBe(true);
          expect(writes.length).toBeGreaterThanOrEqual(1);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    } finally {
      _setRefreshOpenCodeStatus(undefined);
      unregisterSessionListSseClient(client);
    }
  });

  it("survives a throwing session lookup (getSession throws, broadcast completes)", async () => {
    const writes: string[] = [];
    _setRefreshOpenCodeStatus((_s) => Effect.sleep(Duration.days(365)));
    const client: SseClient = {
      close() {},
      write: async (chunk) => {
        writes.push(chunk);
      },
    };
    const sourceSessionId = "ses_throwLookupSource";
    const targetSessionId = "ses_throwLookupTarget";
    insertMessageRow({
      sessionId: sourceSessionId,
      text: `Check say-to-me(${targetSessionId})`,
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: JSON.stringify([{ id: targetSessionId }]),
      clientMessageId: null,
    });
    const targetMessage = insertMessageRow({
      sessionId: targetSessionId,
      text: "throwing lookup test",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(targetMessage.id, "sent", null, null);
    registerSessionListSseClient(client, {
      includeCachedStatus: true,
      includeJarvisOverviewDetails: false,
    });
    _setGetSession((id) => {
      if (id === targetSessionId) throw new Error("simulated lookup throw");
      return null;
    });
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(broadcastQueueEffect(sourceSessionId));
          yield* TestClock.adjust(
            Duration.millis(opencodeStatusTimeoutMs + broadcastDebounceMs * 2 + 10),
          );
          yield* Fiber.join(fiber);
          expect(writes.length).toBeGreaterThanOrEqual(1);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    } finally {
      _setRefreshOpenCodeStatus(undefined);
      _setGetSession(undefined);
      unregisterSessionListSseClient(client);
    }
  });
});
