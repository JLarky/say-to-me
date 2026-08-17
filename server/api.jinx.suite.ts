import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { JsonValue } from "@say-to-me/runtime-validation";
import {
  type TestServer,
  clearQueue,
  createApiMiddleware,
  createTestSession,
  listen,
  mockOpenCode,
  waitFor,
} from "./api.harness.ts";

const jinxSessionId = "ses_18f79a5c3558lt0vwaZ2nRk9bT";

function isSessionCreateUrl(url: string | undefined): boolean {
  return url === "/session" || url?.startsWith("/session?") === true;
}

describe("say API: jinx waiting-state refinement", () => {
  let server: TestServer;
  let origin: string;
  const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
    process.env.SAY_TO_ME_JINX = "1";
  });

  afterEach(() => {
    delete process.env.SAY_TO_ME_JINX;
    process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
    server.close();
  });

  function mockOpenCodeWithJinx(
    targetSessionId: string,
    structured: JsonValue,
  ): ReturnType<typeof mockOpenCode> {
    return mockOpenCode((req, res) => {
      const respond = (payload: JsonValue) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({ [targetSessionId]: { type: "idle" } });
      }
      if (req.method === "POST" && isSessionCreateUrl(req.url)) {
        return respond({ id: jinxSessionId, directory: "/tmp/say-to-me-jinx" });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${jinxSessionId}/message`)) {
        return respond({ info: { structured }, parts: [] });
      }
      if (req.method === "DELETE" && req.url?.startsWith(`/session/${jinxSessionId}`)) {
        return respond({ ok: true });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/jinx-project" });
      }
      res.writeHead(404).end();
    });
  }

  it("serves the heuristic first, then the cached jinx refinement", async () => {
    const sessionId = "ses_3c083f05e92eSvnf4VLcw74EsI";
    const openCode = await mockOpenCodeWithJinx(sessionId, {
      state: "review",
      reason: "The agent finished the feature and wants a review.",
      action: "Review result",
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "agent", text: "Feature is done and pushed." }),
      });
      expect(created.status).toBe(201);

      const first = await fetch(`${origin}/api/sessions/${sessionId}/waiting-state`).then(
        (response) => response.json(),
      );
      expect(first).toMatchObject({ state: "can_continue", source: "heuristic" });

      await waitFor(async () => {
        const payload = await fetch(`${origin}/api/sessions/${sessionId}/waiting-state`).then(
          (response) => response.json(),
        );
        return payload.state === "review";
      });

      const refined = await fetch(`${origin}/api/sessions/${sessionId}/waiting-state`).then(
        (response) => response.json(),
      );
      expect(refined).toMatchObject({
        state: "review",
        reason: "The agent finished the feature and wants a review.",
        action: "Review result",
        source: "jinx",
      });

      const creates = openCode.requests.filter(
        (request) => request.method === "POST" && isSessionCreateUrl(request.url),
      );
      const prompts = openCode.requests.filter(
        (request) =>
          request.method === "POST" && request.url?.startsWith(`/session/${jinxSessionId}/message`),
      );
      const deletes = openCode.requests.filter(
        (request) =>
          request.method === "DELETE" && request.url?.startsWith(`/session/${jinxSessionId}`),
      );
      expect(creates).toHaveLength(1);
      expect(prompts).toHaveLength(1);
      expect(deletes).toHaveLength(1);

      const prompt = prompts[0].body as {
        agent?: string;
        system?: string;
        format?: { type?: string };
        parts?: Array<{ text?: string }>;
      };
      expect(prompt.agent).toBe("plan");
      expect(prompt.format?.type).toBe("json_schema");
      expect(prompt.system).toContain("Jinx");
      expect(prompt.parts?.[0]?.text).toContain("Feature is done and pushed.");
    } finally {
      openCode.server.close();
    }
  });

  it("keeps the heuristic when jinx returns an invalid classification", async () => {
    const sessionId = "ses_42f9b14a2708OmHa6DmMsfvaCR";
    const openCode = await mockOpenCodeWithJinx(sessionId, { state: "nonsense" });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "agent", text: "All done here." }),
      });
      expect(created.status).toBe(201);

      await fetch(`${origin}/api/sessions/${sessionId}/waiting-state`);
      await waitFor(() =>
        openCode.requests.some(
          (request) =>
            request.method === "DELETE" && request.url?.startsWith(`/session/${jinxSessionId}`),
        ),
      );

      const payload = await fetch(`${origin}/api/sessions/${sessionId}/waiting-state`).then(
        (response) => response.json(),
      );
      expect(payload).toMatchObject({ state: "can_continue", source: "heuristic" });
    } finally {
      openCode.server.close();
    }
  });

  it.each([undefined, "false", "0"])("does not call jinx when disabled with %s", async (value) => {
    if (value === undefined) {
      delete process.env.SAY_TO_ME_JINX;
    } else {
      process.env.SAY_TO_ME_JINX = value;
    }
    const sessionId = "ses_2eb84f72122fhc2L6uMEi946Dk";
    const openCode = await mockOpenCodeWithJinx(sessionId, { state: "review", reason: "r" });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "agent", text: "All done here." }),
      });
      expect(created.status).toBe(201);

      const payload = await fetch(`${origin}/api/sessions/${sessionId}/waiting-state`).then(
        (response) => response.json(),
      );
      expect(payload).toMatchObject({ state: "can_continue", source: "heuristic" });
      expect(
        openCode.requests.filter(
          (request) => request.method === "POST" && isSessionCreateUrl(request.url),
        ),
      ).toHaveLength(0);
    } finally {
      openCode.server.close();
    }
  });
});
