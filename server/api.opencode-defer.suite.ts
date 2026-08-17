import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiMessage,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
  waitFor,
  createTestSession,
} from "./api.harness.ts";
import {
  checkIdleNotification,
  clearForwardCompletionNotificationWatches,
} from "./notifications.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";

const sessionId = "ses_1dd864100ffes6uqv2NbJatAKt";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Test request fixtures intentionally model arbitrary JSON accepted by the message endpoint.
type UserMessageFixture = Record<string, unknown>;

describe("say API: send-when-idle delivery", () => {
  let server: TestServer;
  let origin: string;
  const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
    // Status is cached for 2s; clearing keeps busy→idle transitions deterministic.
    opencodeStatusCache.clear();
  });

  afterEach(() => {
    process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
    server.close();
  });

  function mockOpenCodeWithStatus(getStatus: () => string): ReturnType<typeof mockOpenCode> {
    return mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({ [sessionId]: { type: getStatus() } });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sessionId}/message`)) {
        return respond({ info: { id: "msg_delivered" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        return respond({ id: sessionId, directory: "/tmp/defer-project" });
      }
      res.writeHead(404).end();
    });
  }

  function postUserMessage(body: UserMessageFixture): Promise<Response> {
    return fetch(`${origin}/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "user", ...body }),
    });
  }

  async function fetchUserMessages(): Promise<ApiMessage[]> {
    const queue = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((response) =>
      response.json(),
    );
    return queue.messages.filter((message: ApiMessage) => message.author === "user");
  }

  async function fetchUserReply(): Promise<ApiMessage> {
    return (await fetchUserMessages())[0];
  }

  function promptCount(openCode: Awaited<ReturnType<typeof mockOpenCode>>): number {
    return openCode.requests.filter(
      (request) =>
        request.method === "POST" && request.url?.startsWith(`/session/${sessionId}/message`),
    ).length;
  }

  it("queues a message without interrupting a busy session", async () => {
    const openCode = await mockOpenCodeWithStatus(() => "busy");
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await postUserMessage({ text: "hold for idle" });
      expect(created.status).toBe(201);
      expect((await created.json()).message).toMatchObject({ opencodeDeliveryStatus: "queued" });

      const reply = await fetchUserReply();
      expect(reply.opencodeDeliveryStatus).toBe("queued");
      expect(promptCount(openCode)).toBe(0);
    } finally {
      openCode.server.close();
    }
  });

  it("delivers asynchronously when OpenCode is idle", async () => {
    const openCode = await mockOpenCodeWithStatus(() => "idle");
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await postUserMessage({ text: "go now" }).then((response) => response.json());
      expect(created.message).toMatchObject({ opencodeDeliveryStatus: "queued" });

      await waitFor(async () => (await fetchUserReply()).opencodeDeliveryStatus === "sent");
      const reply = await fetchUserReply();
      expect(reply).toMatchObject({
        opencodeDeliveryStatus: "sent",
        opencodeMessageId: "msg_delivered",
      });
      expect(promptCount(openCode)).toBe(1);
    } finally {
      openCode.server.close();
    }
  });

  it("resumes idle notification watches from durable delivery jobs on API startup", async () => {
    let status = "busy";
    const openCode = await mockOpenCodeWithStatus(() => status);
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      await postUserMessage({ text: "resume idle notification" });
      await waitFor(async () => (await fetchUserReply()).opencodeDeliveryStatus === "queued");

      status = "idle";
      opencodeStatusCache.clear();
      await waitFor(async () => (await fetchUserReply()).opencodeDeliveryStatus === "sent");
      const delivered = await fetchUserReply();

      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      clearForwardCompletionNotificationWatches();
      ({ server, origin } = await listen(createApiMiddleware()));

      expect(await checkIdleNotification(delivered.id)).toBe(true);
      expect(await fetchUserMessages()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            clientMessageId: `target-idle-${delivered.id}`,
            opencodeDeliveryStatus: "ui_only",
          }),
        ]),
      );
    } finally {
      openCode.server.close();
    }
  });

  it("force sends deliver immediately even when OpenCode is busy", async () => {
    const openCode = await mockOpenCodeWithStatus(() => "busy");
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await postUserMessage({ text: "interrupt now", forceOpencode: true });
      expect(created.status).toBe(201);

      // A normal send would stay "queued" until idle; a force send bypasses the
      // wait-for-idle gate and is delivered to the busy session.
      await waitFor(async () => (await fetchUserReply()).opencodeDeliveryStatus === "sent");
      const reply = await fetchUserReply();
      expect(reply).toMatchObject({
        opencodeDeliveryStatus: "sent",
        opencodeMessageId: "msg_delivered",
      });
      expect(promptCount(openCode)).toBe(1);
    } finally {
      openCode.server.close();
    }
  });
});
