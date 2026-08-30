import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiMessage,
  type TestServer,
  clearQueue,
  closeTestServer,
  createApiMiddleware,
  listen,
  mockOpenCode,
  waitFor,
  createTestSession,
} from "./api.harness.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";

async function waitForPrompt(openCode: Awaited<ReturnType<typeof mockOpenCode>>, url: string) {
  let prompt: (typeof openCode.requests)[number] | undefined;
  await waitFor(() => {
    prompt = openCode.requests.find((request) => request.url === url);
    return prompt != null;
  });
  return prompt!;
}

describe("say API: OpenCode delivery and status", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  it("forwards replies to the attached OpenCode session", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_1dd864100ffes6uqv2NbJatAKt: { type: "idle" } }));
        return;
      }
      res.end(JSON.stringify({ info: { id: "msg_mock" }, parts: [] }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession("ses_1dd864100ffes6uqv2NbJatAKt");
      await fetch(`${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: "user" }),
      });

      const promptRequest = await waitForPrompt(
        openCode,
        "/session/ses_1dd864100ffes6uqv2NbJatAKt/message",
      );

      expect(promptRequest).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const body = promptRequest!.body as { parts: { type: string; text: string }[] };
      expect(body.parts[0]).toMatchObject({ type: "text" });
      expect(body.parts[0].text).toMatch(
        /^you have to reply to this message with voice \(cli `say-to-me usage` to learn how\/why\)\n\nat \d{2}:\d{2} ses_1dd864100ffes6uqv2NbJatAKt said: user$/,
      );
      await waitFor(async () => {
        const queue = await fetch(
          `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
        ).then((response) => response.json());
        return queue.messages.some(
          (message: ApiMessage) =>
            message.author === "user" &&
            message.opencodeDeliveryStatus === "sent" &&
            message.opencodeMessageId === "msg_mock",
        );
      });
      const queue = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
      ).then((response) => response.json());
      expect(queue.messages).toContainEqual(
        expect.objectContaining({
          author: "user",
          opencodeDeliveryStatus: "sent",
          opencodeMessageId: "msg_mock",
        }),
      );
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("preserves public OpenCode model control error responses through Express", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "model list failed" }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const invalidSelection = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/opencode-model`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerID: "", modelID: "gpt-5.5" }),
        },
      );
      expect(invalidSelection.status).toBe(400);
      await expect(invalidSelection.json()).resolves.toEqual({
        error: "Model is required.",
        status: 400,
      });

      const upstreamList = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/opencode-models`,
      );
      expect(upstreamList.status).toBe(502);
      await expect(upstreamList.json()).resolves.toEqual({
        error: "OpenCode returned HTTP 500",
        status: 502,
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      await closeTestServer(openCode.server);
      server.close();
    }
  });

  it("updates an OpenCode session title", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_5dfdabafcb34FqPXa7AGCdYtjJ: { type: "idle" } }));
        return;
      }
      if (
        req.method === "PATCH" &&
        req.url?.startsWith("/session/ses_5dfdabafcb34FqPXa7AGCdYtjJ")
      ) {
        res.end(
          JSON.stringify({
            id: "ses_5dfdabafcb34FqPXa7AGCdYtjJ",
            title: "Better title",
            directory: "/tmp/demo-project",
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          id: "ses_5dfdabafcb34FqPXa7AGCdYtjJ",
          title: "Old title",
          directory: "/tmp/demo-project",
          time: { created: 1, updated: 2 },
        }),
      );
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(
        `${origin}/api/sessions/ses_5dfdabafcb34FqPXa7AGCdYtjJ/opencode-title`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Better title" }),
        },
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.session).toMatchObject({
        id: "ses_5dfdabafcb34FqPXa7AGCdYtjJ",
        opencodeTitle: "Better title",
      });
      const update = openCode.requests.find(
        (request) =>
          request.method === "PATCH" &&
          request.url?.startsWith("/session/ses_5dfdabafcb34FqPXa7AGCdYtjJ"),
      );
      expect(update?.body).toMatchObject({ title: "Better title" });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("marks failed OpenCode reply delivery and retries it", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_1dd864100ffes6uqv2NbJatAKt: { type: "idle" } }));
        return;
      }
      res.end(JSON.stringify({ info: { id: "msg_retry" }, parts: [] }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = "http://127.0.0.1:1";

    try {
      await createTestSession("ses_1dd864100ffes6uqv2NbJatAKt");
      await fetch(`${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: "user" }),
      });
      const failedQueue = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
      ).then((response) => response.json());
      const reply = failedQueue.messages.find((message: ApiMessage) => message.author === "user");

      expect(reply).toMatchObject({ opencodeDeliveryStatus: "queued" });

      process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;
      await fetch(`${origin}/api/messages/${reply.id}/retry-opencode`, { method: "POST" });
      await waitForPrompt(openCode, "/session/ses_1dd864100ffes6uqv2NbJatAKt/message");
      const retriedQueue = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
      ).then((response) => response.json());

      const promptRequests = openCode.requests.filter(
        (request) => request.url === "/session/ses_1dd864100ffes6uqv2NbJatAKt/message",
      );

      expect(promptRequests).toHaveLength(1);
      expect(retriedQueue.messages).toContainEqual(
        expect.objectContaining({
          id: reply.id,
          opencodeDeliveryStatus: "sent",
          opencodeMessageId: "msg_retry",
        }),
      );
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("maps OpenCode session statuses into session payload statuses", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    await createTestSession("ses_f98de3514a09pVgm0F0buZrRkc");
    await createTestSession("ses_09a0fc08523fctVzW8czyW9yAN");
    await createTestSession("ses_92ced347ce4dV60i8Dk4OPMNNK");
    await createTestSession("ses_78005ca397ddLflchkuca2bNU1");
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ses_f98de3514a09pVgm0F0buZrRkc: { type: "busy" },
            ses_09a0fc08523fctVzW8czyW9yAN: { type: "idle" },
            ses_92ced347ce4dV60i8Dk4OPMNNK: {
              type: "retry",
              attempt: 1,
              message: "retrying",
              next: Date.now(),
            },
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const busy = await fetch(
        `${origin}/api/sessions/ses_f98de3514a09pVgm0F0buZrRkc/messages`,
      ).then((response) => response.json());
      const idle = await fetch(
        `${origin}/api/sessions/ses_09a0fc08523fctVzW8czyW9yAN/messages`,
      ).then((response) => response.json());
      const retry = await fetch(
        `${origin}/api/sessions/ses_92ced347ce4dV60i8Dk4OPMNNK/messages`,
      ).then((response) => response.json());
      process.env.SAY_TO_ME_OPENCODE_URL = "http://127.0.0.1:1";
      const unavailable = await fetch(
        `${origin}/api/sessions/ses_78005ca397ddLflchkuca2bNU1/messages`,
      ).then((response) => response.json());

      expect(busy.session.opencodeStatus).toBe("pending");
      expect(idle.session.opencodeStatus).toBe("idle");
      expect(retry.session.opencodeStatus).toBe("retrying");
      expect(unavailable.session.opencodeStatus).toBe("unavailable");
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("force-refreshes OpenCode status for session message payloads", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_af24935d484bkmSM6eeljKVjej";
    await createTestSession(sessionId);
    let statusType: "idle" | "busy" = "idle";
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: sessionId, directory: "/tmp/live-status" }));
        return;
      }
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ [sessionId]: { type: statusType } }));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      opencodeStatusCache.clear();
      const idle = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((response) =>
        response.json(),
      );
      statusType = "busy";
      const busy = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((response) =>
        response.json(),
      );

      expect(idle.session.opencodeStatus).toBe("idle");
      expect(busy.session.opencodeStatus).toBe("pending");
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("uses the OpenCode session directory when fetching status", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_b087eb4347d3fof8AToXwcc0Bk";
    const sessionDirectory = "/tmp/external-project";
    const statusDirectories: string[] = [];
    await createTestSession(sessionId);
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: sessionId, directory: sessionDirectory }));
        return;
      }
      if (req.url?.startsWith("/session/status")) {
        statusDirectories.push(new URL(req.url, openCode.url).searchParams.get("directory") || "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ [sessionId]: { type: "busy" } }));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const payload = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((response) =>
        response.json(),
      );

      expect(payload.session.opencodeStatus).toBe("pending");
      expect(statusDirectories).toEqual([sessionDirectory]);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });
});
