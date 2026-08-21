import { afterEach, describe, expect, it } from "vite-plus/test";
import { Duration, Effect, Fiber, TestClock, TestContext } from "effect";
import {} from "./api.harness.ts";
import { dispatchEffectApiRequest } from "./api-routes/effect-api.ts";
import { getJarvisStatusEffect } from "./api-routes/jarvis-status.ts";
import { insertMessageRow } from "./messages.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";
import { ensureSession } from "./sessions.ts";
import { JarvisStatusOpenCode, waitForIdleStatusEffect } from "./jarvis-status.ts";
import { fakeServiceLayer } from "./effect-test-helpers.ts";
import type { OpenCodeStatus, WaitingStatePayload } from "../src/types.ts";

function jarvisStatusRequest(sessionId: string, query = "") {
  return Effect.promise(() =>
    dispatchEffectApiRequest(
      new Request(`http://say.test/api/sessions/${sessionId}/jarvis-status${query}`),
    ).then((response) => response ?? new Response(null, { status: 404 })),
  );
}

function jarvisMessageRequest(sessionId: string, messageId: number) {
  return Effect.promise(() =>
    dispatchEffectApiRequest(
      new Request(`http://say.test/api/sessions/${sessionId}/messages/${messageId}`),
    ).then((response) => response ?? new Response(null, { status: 404 })),
  );
}

function jarvisStatusByMessageRequest(messageId: number | string, query = "") {
  return Effect.promise(() =>
    dispatchEffectApiRequest(
      new Request(`http://say.test/api/messages/${messageId}/jarvis-status${query}`),
    ).then((response) => response ?? new Response(null, { status: 404 })),
  );
}

async function responseJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function jarvisStatusProgram(sessionId: string, query: URLSearchParams = new URLSearchParams()) {
  return getJarvisStatusEffect({
    rawSessionId: sessionId,
    rawSince: query.get("since") ?? undefined,
    rawExtended: query.get("extended") ?? undefined,
    rawLimit: query.get("limit") ?? undefined,
    rawWait: query.get("wait") ?? undefined,
  });
}

function fakeJarvisStatusOpenCode({
  statuses,
  waitingStates,
  onStatusCall,
}: {
  statuses: Array<OpenCodeStatus | null>;
  waitingStates?: WaitingStatePayload[];
  onStatusCall?: (call: number) => void;
}) {
  let waitingCalls = 0;
  const fake = fakeServiceLayer(JarvisStatusOpenCode, (calls) => ({
    getStatus: () =>
      Effect.sync(() => {
        calls.push("status");
        onStatusCall?.(calls.length);
        return statuses[Math.min(calls.length - 1, statuses.length - 1)] ?? null;
      }),
    getActivityPreview: (_sessionId, limit) =>
      Effect.succeed({
        status: "ok",
        recentItems: Array.from({ length: Math.min(limit, 2) }, (_, index) => ({
          kind: "assistant",
          snippet: `activity ${index + 1}`,
          timestamp: index + 1,
          partial: false,
        })),
      }),
    getWaitingState: () =>
      Effect.sync(() => {
        waitingCalls += 1;
        const fallback: WaitingStatePayload = {
          state: "can_continue",
          reason: "Fake Jarvis status service is idle.",
          source: "heuristic",
        };
        if (!waitingStates || waitingStates.length === 0) return fallback;
        return waitingStates[Math.min(waitingCalls - 1, waitingStates.length - 1)] ?? fallback;
      }),
  }));
  return {
    getStatusCalls: () => fake.calls.filter((call) => call === "status").length,
    getWaitingStateCalls: () => waitingCalls,
    layer: fake.layer,
  };
}

function insertAgentMessage(
  sessionId: string,
  text: string,
  options: {
    extraMarkdown?: string | null;
    links?: string[] | null;
    sessionRefs?: Array<{ id: string; alias?: string }> | null;
  } = {},
) {
  ensureSession(sessionId);
  return insertMessageRow({
    sessionId,
    text,
    extraMarkdown: options.extraMarkdown ?? null,
    author: "agent",
    status: "received",
    links: options.links ? JSON.stringify(options.links) : null,
    sessionRefs: options.sessionRefs ? JSON.stringify(options.sessionRefs) : null,
    clientMessageId: null,
  });
}

describe("say API: Jarvis status", () => {
  afterEach(() => {
    opencodeStatusCache.clear();
  });

  it("returns a trimmed transcript status by default", async () => {
    const sessionId = "ses_3cddac39171dE8Qc6Ejq00Rgip";
    const longExtraMarkdown = `details ${"x".repeat(245)}`;
    insertAgentMessage(sessionId, "I checked the app.", {
      extraMarkdown: longExtraMarkdown,
      links: ["https://example.test/pr/1"],
      sessionRefs: [{ id: "ses_d85b53588b1cXL1ywV77FOo4oJ", alias: "Helper" }],
    });
    insertAgentMessage(sessionId, "<say-to-me-system>Morgan is idle now</say-to-me-system>");

    const response = await Effect.runPromise(jarvisStatusRequest(sessionId));
    expect(await response.clone().text()).toContain('\n  "messages": [');
    const payload = await responseJson<{
      messages: Array<{ id: number } & Record<string, unknown>>;
      nextPullCursor: string | null;
      otherMessages: number[];
      opencodeActivity: { recentItems?: unknown[] };
      params: { limit: number };
      sessionId: string;
      opencodeState: string;
    }>(response);

    expect(response.status).toBe(200);
    expect(payload.messages).toHaveLength(1);
    expect(payload.params.limit).toBe(3);
    expect(payload).not.toHaveProperty("otherMessages");
    expect(payload.nextPullCursor).toBe(
      `?extended=0&limit=3&wait=1000&since=${payload.messages[0].id}`,
    );
    expect(payload).not.toHaveProperty("omitted");
    expect(payload.messages[0]).toMatchObject({
      author: "agent",
      text: "I checked the app.",
      links: ["https://example.test/pr/1"],
      sessions: [
        {
          id: "ses_d85b53588b1cXL1ywV77FOo4oJ",
        },
      ],
    });
    expect(
      Object.keys((payload.messages[0].sessions as Array<Record<string, unknown>>)[0]),
    ).toEqual(["id"]);
    expect(payload.messages[0].createdAt).toEqual(expect.any(String));
    expect(String(payload.messages[0].extraMarkdownPreview)).toContain("details");
    expect(String(payload.messages[0].extraMarkdownPreview).length).toBeLessThanOrEqual(240);
    expect(payload.messages[0]).not.toHaveProperty("extraMarkdown");
    expect(payload.messages[0]).not.toHaveProperty("attachments");
    expect(payload.messages[0]).not.toHaveProperty("forwardRole");
    expect(payload.opencodeActivity).not.toHaveProperty("latestOutputSnippet");
    expect(payload.opencodeActivity.recentItems?.length ?? 0).toBeLessThanOrEqual(2);
    if (payload.opencodeActivity.recentItems?.[0]) {
      expect(
        Object.keys(payload.opencodeActivity.recentItems[0] as Record<string, unknown>),
      ).toEqual(["kind", "snippet", "timestamp", "partial"]);
    }
    expect(payload).toMatchObject({ sessionId, opencodeState: expect.any(String) });
  });

  it("filters messages after since", async () => {
    const sessionId = "ses_2bc814e65129edcYTLP4o8p762";
    const first = insertAgentMessage(sessionId, "first message");
    const second = insertAgentMessage(sessionId, "second message");
    const third = insertAgentMessage(sessionId, "third message");
    const fourth = insertAgentMessage(sessionId, "fourth message");

    const response = await Effect.runPromise(
      jarvisStatusRequest(sessionId, `?since=${first.id}&limit=1&wait=2000`),
    );
    const payload = await responseJson<{
      nextPullCursor: string | null;
      otherMessages: number[];
      params: { since: number | null; limit: number };
      messages: Array<{ id: number }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(payload.params.since).toBe(first.id);
    expect(payload.params.limit).toBe(1);
    expect(payload.messages.map((message) => message.id)).toEqual([fourth.id]);
    expect(payload.otherMessages).toEqual([second.id, third.id]);
    expect(payload.nextPullCursor).toBe(`?extended=0&limit=1&wait=2000&since=${fourth.id}`);
    expect(third.id).toBeGreaterThan(second.id);
    expect(fourth.id).toBeGreaterThan(third.id);
  });

  it("returns full detail in extended mode and full-message evidence by id", async () => {
    const sessionId = "ses_1b11b54854f0Y9FEhyHhwxMgwR";
    const extraMarkdown = "full debug table\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const created = insertAgentMessage(sessionId, "extended message", { extraMarkdown });

    const responses = await Effect.runPromise(
      Effect.all(
        {
          status: jarvisStatusRequest(sessionId, "?extended"),
          evidence: jarvisMessageRequest(sessionId, created.id),
        },
        { concurrency: "unbounded" },
      ),
    );
    const payload = await responseJson<{
      messages: Array<{ id: number } & Record<string, unknown>>;
      opencodeActivity: { recentItems?: unknown[] };
    }>(responses.status);
    const evidence = await responseJson<{ message: Record<string, unknown> }>(responses.evidence);

    expect(responses.status.status).toBe(200);
    expect(responses.evidence.status).toBe(200);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toMatchObject({
      id: created.id,
      extraMarkdown,
      opencodeDeliveryStatus: null,
      attachments: [],
    });
    expect(payload.opencodeActivity.recentItems?.length ?? 0).toBeLessThanOrEqual(5);
    expect(evidence.message).toMatchObject({ id: created.id, extraMarkdown });
  });

  it("returns Jarvis status anchored by message id and includes the anchor message", async () => {
    const sessionId = "ses_30641aa86ae9GD4kBqQZeseBZX";
    insertAgentMessage(sessionId, "before anchor");
    const anchor = insertAgentMessage(sessionId, "anchor message");
    const newer = insertAgentMessage(sessionId, "newer message");

    const anchoredResponse = await Effect.runPromise(
      jarvisStatusByMessageRequest(anchor.id, "?limit=1&wait=1000"),
    );
    const anchored = await responseJson<{
      messages: Array<{ id: number; text: string }>;
      nextPullCursor: string;
      params: { anchorMessageId: number; since: number | null };
      sessionId: string;
    }>(anchoredResponse);

    expect(anchoredResponse.status).toBe(200);
    expect(anchored.sessionId).toBe(sessionId);
    expect(anchored.messages.map((message) => message.id)).toEqual([anchor.id]);
    expect(anchored.messages[0].text).toBe("anchor message");
    expect(anchored.params).toMatchObject({ anchorMessageId: anchor.id, since: null });
    expect(anchored.nextPullCursor).toBe(`?extended=0&limit=1&wait=1000&since=${anchor.id}`);

    const nextResponse = await Effect.runPromise(
      jarvisStatusByMessageRequest(anchor.id, `?limit=1&since=${anchor.id}&wait=1000`),
    );
    const next = await responseJson<{
      messages: Array<{ id: number; text: string }>;
      params: { anchorMessageId?: number; since: number | null };
    }>(nextResponse);
    expect(next.messages.map((message) => message.id)).toEqual([newer.id]);
    expect(next.params).toMatchObject({ since: anchor.id });
    expect(next.params).not.toHaveProperty("anchorMessageId");
  });

  it("preserves an anchored idle system notice in Jarvis status output", async () => {
    const sessionId = "ses_086552f07a7dJq0K9ruq0P5U4D";
    const anchor = insertAgentMessage(
      sessionId,
      "<say-to-me-system>ses_086552f07a7dJq0K9ruq0P5U4D is idle now</say-to-me-system>",
    );
    insertAgentMessage(sessionId, "newer displayable message");

    const response = await Effect.runPromise(
      jarvisStatusByMessageRequest(anchor.id, "?limit=1&wait=1000"),
    );
    const payload = await responseJson<{
      messages: Array<{ id: number; text: string }>;
      params: { anchorMessageId: number };
    }>(response);

    expect(response.status).toBe(200);
    expect(payload.messages).toEqual([
      {
        id: anchor.id,
        author: "agent",
        text: "<say-to-me-system>ses_086552f07a7dJq0K9ruq0P5U4D is idle now</say-to-me-system>",
        createdAt: expect.any(String),
      },
    ]);
    expect(payload.params.anchorMessageId).toBe(anchor.id);
  });

  it("returns anchored Jarvis status errors without requiring a session id", async () => {
    const invalid = await Effect.runPromise(jarvisStatusByMessageRequest("nope"));
    const missing = await Effect.runPromise(jarvisStatusByMessageRequest(999_999_999));

    expect(invalid.status).toBe(400);
    expect(await responseJson(invalid)).toEqual({ error: "Invalid message id." });
    expect(missing.status).toBe(404);
    expect(await responseJson(missing)).toEqual({ error: "Message not found." });
  });

  it("returns 404 for non-existent sessions", async () => {
    const response = await Effect.runPromise(
      jarvisStatusRequest("ses_a832783083162DWcPnDKqjp48G_jarvis_status"),
    );
    const payload = await responseJson<{ error: string; status: number }>(response);

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: "Session not found." });
  });

  it("waits for a busy OpenCode session to become idle", async () => {
    const sessionId = "ses_19333be025d25sVAwi5OoQsvZH";
    const fakeOpenCode = fakeJarvisStatusOpenCode({ statuses: ["pending", "idle"] });

    insertAgentMessage(sessionId, "waiting done");
    const payload = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* jarvisStatusProgram(sessionId, new URLSearchParams("wait=500ms")).pipe(
          Effect.provide(fakeOpenCode.layer),
          Effect.fork,
        );

        yield* TestClock.adjust(Duration.millis(100));
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(payload).toMatchObject({
      sessionId,
      opencodeState: "idle",
      params: { wait: 500 },
      wait: { requestedMs: 500, timedOut: false },
    });
    expect(fakeOpenCode.getStatusCalls()).toBe(2);
  });

  it("waits for idle with injected Effect dependencies", async () => {
    const statuses: Array<"pending" | "idle"> = ["pending", "pending", "idle"];
    const fakeOpenCode = fakeJarvisStatusOpenCode({ statuses: ["idle"] });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* waitForIdleStatusEffect("ses_bce84cb60b67M8MfVSyjkyO2fS", 500, {
          getStatusEffect: () => Effect.succeed(statuses.shift() ?? "idle"),
          pollMs: 100,
        }).pipe(Effect.fork);

        yield* TestClock.adjust(Duration.millis(200));
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(fakeOpenCode.layer), Effect.provide(TestContext.TestContext)),
    );

    expect(result).toEqual({ opencodeState: "idle", waitedMs: 200, timedOut: false });
  });

  it("times out with injected Effect dependencies", async () => {
    let statusCalls = 0;
    const fakeOpenCode = fakeJarvisStatusOpenCode({ statuses: ["idle"] });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* waitForIdleStatusEffect("ses_44f7092362fflEaVD4hkL1ZS1e", 250, {
          getStatusEffect: () =>
            Effect.sync(() => {
              statusCalls += 1;
              return "pending";
            }),
          pollMs: 100,
        }).pipe(Effect.fork);

        yield* TestClock.adjust(Duration.millis(250));
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(fakeOpenCode.layer), Effect.provide(TestContext.TestContext)),
    );

    expect(result).toEqual({ opencodeState: "pending", waitedMs: 250, timedOut: true });
    expect(statusCalls).toBe(4);
  });

  it("includes messages that arrive while waiting for idle", async () => {
    const sessionId = "ses_9d221c5773e6VO1r7YNeNWul1y";
    let createdDuringWaitId: number | null = null;
    const fakeOpenCode = fakeJarvisStatusOpenCode({
      statuses: ["pending", "idle"],
      onStatusCall: (call) => {
        if (call === 2) {
          createdDuringWaitId = insertAgentMessage(sessionId, "arrived during wait").id;
        }
      },
    });

    const beforeWait = insertAgentMessage(sessionId, "before wait");
    const payload = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* jarvisStatusProgram(
          sessionId,
          new URLSearchParams(`since=${beforeWait.id}&wait=500ms`),
        ).pipe(Effect.provide(fakeOpenCode.layer), Effect.fork);

        yield* TestClock.adjust(Duration.millis(100));
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(createdDuringWaitId).not.toBeNull();
    expect(payload).toMatchObject({
      opencodeState: "idle",
      messages: [
        {
          id: createdDuringWaitId,
          text: "arrived during wait",
        },
      ],
      nextPullCursor: `?extended=0&limit=3&wait=500&since=${createdDuringWaitId}`,
    });
  });

  it("does not long-poll unavailable OpenCode sessions", async () => {
    const sessionId = "ses_771459108b422Pdnv73cpayEQY";
    const fakeOpenCode = fakeJarvisStatusOpenCode({ statuses: ["unavailable"] });

    insertAgentMessage(sessionId, "unavailable status");
    const payload = await Effect.runPromise(
      jarvisStatusProgram(sessionId, new URLSearchParams("wait=500ms")).pipe(
        Effect.provide(fakeOpenCode.layer),
      ),
    );

    expect(payload).toMatchObject({
      opencodeState: "unavailable",
      wait: { requestedMs: 500, timedOut: false },
    });
    expect(fakeOpenCode.getStatusCalls()).toBe(1);
  });

  it("waits for a CLI session whose waiting-state is working", async () => {
    // Regression for #19: non-OpenCode backends report opencodeState null while
    // waitingState already knows the agent is mid-turn. wait must consult that.
    const sessionId = "gr_a19f0c11-0001-4000-8000-000000000001";
    const fakeOpenCode = fakeJarvisStatusOpenCode({
      statuses: [null, null],
      waitingStates: [
        {
          state: "working",
          reason: "The agent is working on the last message.",
          source: "heuristic",
        },
        {
          state: "can_continue",
          reason: "The agent reported back.",
          source: "heuristic",
        },
      ],
    });

    insertAgentMessage(sessionId, "cli turn in flight");
    const payload = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* jarvisStatusProgram(sessionId, new URLSearchParams("wait=500ms")).pipe(
          Effect.provide(fakeOpenCode.layer),
          Effect.fork,
        );

        yield* TestClock.adjust(Duration.millis(100));
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(payload).toMatchObject({
      sessionId,
      opencodeState: null,
      wait: { requestedMs: 500, timedOut: false },
      waitingState: { state: "can_continue" },
    });
    expect(payload.wait.waitedMs).toBeGreaterThan(0);
    expect(fakeOpenCode.getWaitingStateCalls()).toBeGreaterThanOrEqual(2);
  });

  it("times out when a CLI session stays working", async () => {
    const sessionId = "cur_b19f0c11-0002-4000-8000-000000000002";
    const fakeOpenCode = fakeJarvisStatusOpenCode({
      statuses: [null],
      waitingStates: [
        {
          state: "working",
          reason: "The agent is working on the last message.",
          source: "heuristic",
        },
      ],
    });

    insertAgentMessage(sessionId, "still working");
    const payload = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* jarvisStatusProgram(sessionId, new URLSearchParams("wait=250ms")).pipe(
          Effect.provide(fakeOpenCode.layer),
          Effect.fork,
        );

        yield* TestClock.adjust(Duration.millis(250));
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(payload).toMatchObject({
      opencodeState: null,
      wait: { requestedMs: 250, timedOut: true, waitedMs: 250 },
      waitingState: { state: "working" },
    });
    expect(fakeOpenCode.getWaitingStateCalls()).toBeGreaterThan(1);
  });

  it("does not long-poll an idle CLI session", async () => {
    const sessionId = "cc_c19f0c11-0003-4000-8000-000000000003";
    const fakeOpenCode = fakeJarvisStatusOpenCode({
      statuses: [null],
      waitingStates: [
        {
          state: "can_continue",
          reason: "The agent reported back.",
          source: "heuristic",
        },
      ],
    });

    insertAgentMessage(sessionId, "already idle");
    const payload = await Effect.runPromise(
      jarvisStatusProgram(sessionId, new URLSearchParams("wait=500ms")).pipe(
        Effect.provide(fakeOpenCode.layer),
      ),
    );

    expect(payload).toMatchObject({
      opencodeState: null,
      wait: { requestedMs: 500, timedOut: false },
      waitingState: { state: "can_continue" },
    });
    expect(payload.wait.waitedMs).toBeLessThan(50);
    expect(fakeOpenCode.getWaitingStateCalls()).toBe(2);
  });

  it("returns route-level JSON errors for invalid query strings", async () => {
    const sessionId = "ses_1eb17738d529WuKPDO621WnH2I";
    const cases = [
      ["?since=nope", "Invalid since message id."],
      ["?limit=0", "Invalid limit."],
      ["?extended=maybe", "Invalid extended flag."],
      ["?wait=10min", "Invalid wait timeout. Maximum wait is 300000 ms (5 minutes)."],
    ] as const;

    for (const [query, error] of cases) {
      const response = await Effect.runPromise(jarvisStatusRequest(sessionId, query));
      const payload = await responseJson<{ error: string }>(response);

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(payload).toEqual({ error });
    }
  });
});
