import { Effect, Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type TestServer,
  clearQueue,
  createApiMiddleware,
  createTestSession,
  listen,
  mockOpenCode,
  teardownApi,
} from "./api.harness.ts";
import { insertMessageRow } from "./messages.ts";
import { ensureSession } from "./sessions.ts";
import { WaitingStateOpenCode, getWaitingStateEffect } from "./waiting-state.ts";
import { dispatchEffectApiRequest } from "./api-routes/effect-api.ts";

describe("getWaitingStateEffect", () => {
  it("uses injected OpenCode status instead of the real client", async () => {
    const sessionId = "ses_7c6041d41eaeS5Gy4w2u46Pozl";
    let statusCalls = 0;
    ensureSession(sessionId);
    insertMessageRow({
      sessionId,
      text: "Should I update the docs?",
      extraMarkdown: null,
      author: "agent",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    const layer = Layer.succeed(WaitingStateOpenCode, {
      getStatus: (calledSessionId) =>
        Effect.sync(() => {
          statusCalls += 1;
          expect(calledSessionId).toBe(sessionId);
          return "idle" as const;
        }),
    });

    const payload = await Effect.runPromise(
      getWaitingStateEffect(sessionId).pipe(Effect.provide(layer)),
    );

    expect(payload).toMatchObject({
      state: "needs_answer",
      action: "Answer question",
      source: "heuristic",
    });
    expect(statusCalls).toBe(1);
  });
});

describe("say API: waiting state", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("registers waiting-state without claiming session event streams", async () => {
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_f67b251e4270nUAaR3Rj4Nqkuj/waiting-state"),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_f67b251e4270nUAaR3Rj4Nqkuj/events"),
      ),
    ).toBeNull();
  });

  it("rejects malformed session ids", async () => {
    try {
      const response = await fetch(`${origin}/api/sessions/not%20a%20session/waiting-state`);
      expect(response.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("returns unknown when OpenCode is unreachable", async () => {
    try {
      const payload = await fetch(
        `${origin}/api/sessions/ses_f94c8a586294iWvZxZR7C3BGu9/waiting-state`,
      ).then((response) => response.json());
      expect(payload).toMatchObject({ state: "unknown" });
      expect(payload.reason).toEqual(expect.any(String));
    } finally {
      server.close();
    }
  });

  it("classifies an idle agent question as needs_answer", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_736f43c2946aJEuqyOfopED0II";
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ [sessionId]: { type: "idle" } }));
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: sessionId, directory: "/tmp/ws-project" }));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "agent", text: "Should I update the docs?" }),
      });
      expect(created.status).toBe(201);

      const payload = await fetch(`${origin}/api/sessions/${sessionId}/waiting-state`).then(
        (response) => response.json(),
      );
      expect(payload).toMatchObject({
        state: "needs_answer",
        action: "Answer question",
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });
});
