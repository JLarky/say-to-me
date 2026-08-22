import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiMessage,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  createTestSession,
  listen,
  mockOpenCode,
  waitFor,
} from "./api.harness.ts";
import {
  checkForwardCompletionNotification,
  checkIdleNotification,
  clearForwardCompletionNotificationWatches,
  startForwardCompletionNotificationWatch,
} from "./notifications.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";
import { stopAllCompletionWatches } from "./opencode/completion-watch.ts";

async function fetchSessionMessages(origin: string, sessionId: string): Promise<ApiMessage[]> {
  const queue = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((response) =>
    response.json(),
  );
  return queue.messages;
}

async function waitForMessageStatus(
  origin: string,
  sessionId: string,
  messageId: number,
  status: string,
): Promise<ApiMessage> {
  let found: ApiMessage | undefined;
  await waitFor(async () => {
    found = (await fetchSessionMessages(origin, sessionId)).find(
      (message) => message.id === messageId,
    );
    return found?.opencodeDeliveryStatus === status;
  });
  return found!;
}

async function waitForForwardStatus(
  origin: string,
  sessionId: string,
  messageId: number,
  status: string,
): Promise<ApiMessage> {
  let found: ApiMessage | undefined;
  await waitFor(async () => {
    found = (await fetchSessionMessages(origin, sessionId)).find(
      (message) => message.id === messageId,
    );
    return found?.forwardStatus === status;
  });
  return found!;
}

describe("say API: message forward completion", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    stopAllCompletionWatches();
    clearForwardCompletionNotificationWatches();
    opencodeStatusCache.clear();
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  afterEach(() => {
    stopAllCompletionWatches();
    clearForwardCompletionNotificationWatches();
    opencodeStatusCache.clear();
  });

  it("notifies the source session when a watched forwarded session becomes idle", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_32a3a39f5ccdIhIMtLJ5od58Ey";
    const targetSessionId = "ses_26f5aeb1976f4B0RsHqLm8qShF";
    let targetStatus: "idle" | "busy" = "idle";
    let sourceStatus: "idle" | "busy" = "idle";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: sourceStatus },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_notify" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_idle_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/notify-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/notify-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "please do this",
          notifyOnCompletion: true,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ forwardStatus: "queued" });
      expect(payload.targetMessage).toMatchObject({
        forwardStatus: "queued",
        completionWatchStatus: "watching",
      });
      await waitForForwardStatus(origin, sourceSessionId, payload.message.id, "sent");
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");

      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(false);

      targetStatus = "idle";
      sourceStatus = "idle";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const targetQueue = await fetch(`${origin}/api/sessions/${targetSessionId}/messages`).then(
        (res) => res.json(),
      );
      const sourceNotice = sourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      const targetNotice = targetQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `target-idle-${payload.message.id}`,
      );
      const deliveredSourceNotice = await waitForMessageStatus(
        origin,
        sourceSessionId,
        sourceNotice.id,
        "sent",
      );
      expect(targetNotice).toMatchObject({
        author: "user",
        opencodeDeliveryStatus: "ui_only",
        text: `<say-to-me-system>${targetSessionId} is idle now</say-to-me-system>`,
        sessions: [expect.objectContaining({ id: targetSessionId })],
      });
      expect(deliveredSourceNotice).toMatchObject({
        author: "user",
        forwardRole: "target",
        forwardSourceSessionId: targetSessionId,
        forwardSourceMessageId: targetNotice.id,
        opencodeDeliveryStatus: "sent",
        opencodeMessageId: "msg_idle_notice",
        text: `<say-to-me-system>${targetSessionId} is idle now after message: please do this</say-to-me-system>`,
        sessions: [expect.objectContaining({ id: targetSessionId })],
      });
      expect(sourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: payload.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: sourceNotice.id,
          }),
        ]),
      );
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`),
        ).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${targetSessionId}/message`),
        ),
      ).toHaveLength(1);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("does not duplicate the forwarded idle notification if the watch restarts", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_993bfab22e57ueC2wfRAs5tkJS";
    const targetSessionId = "ses_fd49e6250708U43G45fZkaDtp0";
    let targetStatus: "idle" | "busy" = "idle";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_notify_duplicate" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_duplicate_idle_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/notify-duplicate-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/notify-duplicate-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", targetSessionId, text: "please do this" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");
      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(false);

      targetStatus = "idle";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      startForwardCompletionNotificationWatch({
        sourceMessageId: payload.message.id,
        sourceSessionId,
        targetMessageId: payload.targetMessage.id,
        targetSessionId,
        seenWorking: true,
      });
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const sourceNotices = sourceQueue.messages.filter(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      expect(sourceNotices).toHaveLength(1);
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`),
        ).length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("posts an idle message to a session after normal user work completes", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_1b007f064b166Tp0rW6eO8CcwU";
    let status: "idle" | "busy" = "idle";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({ [sessionId]: { type: status } });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sessionId}/message`)) {
        return respond({ info: { id: "msg_normal_work" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        return respond({ id: sessionId, directory: "/tmp/idle-own-session" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const response = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: "please do this" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ opencodeDeliveryStatus: "queued" });
      await waitForMessageStatus(origin, sessionId, payload.message.id, "sent");

      status = "busy";
      opencodeStatusCache.clear();
      expect(await checkIdleNotification(payload.message.id)).toBe(false);

      status = "idle";
      opencodeStatusCache.clear();
      expect(await checkIdleNotification(payload.message.id)).toBe(true);

      const updatedQueue = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((res) =>
        res.json(),
      );
      expect(updatedQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            author: "user",
            clientMessageId: `target-idle-${payload.message.id}`,
            opencodeDeliveryStatus: "ui_only",
            text: "Session is now idle.",
          }),
        ]),
      );
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("summarizes idle system messages as idle in session cards", async () => {
    const sessionId = "ses_aaaaaaaaaaaaaaaaaaaaaaaaaa";

    try {
      await createTestSession(sessionId);
      await createTestSession("ses_bbbbbbbbbbbbbbbbbbbbbbbbbb");
      const idleResponse = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          forceOpencode: true,
          text: "Session is now idle.",
        }),
      });
      expect(idleResponse.status).toBe(201);

      const cardResponse = await fetch(
        `${origin}/api/sessions/ses_bbbbbbbbbbbbbbbbbbbbbbbbbb/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            text: `Check say-to-me(${sessionId})`,
          }),
        },
      );
      const payload = await cardResponse.json();

      expect(cardResponse.status).toBe(201);
      expect(payload.message.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: sessionId,
            summary: "Idle notification: Session is now idle.",
            waitingState: "can_continue",
          }),
        ]),
      );
    } finally {
      server.close();
    }
  });

  it("posts only the target idle message for forwarded work without a watcher", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_2fc544fcf8e10Rg8jdYABweE6l";
    const targetSessionId = "ses_57ebf84ec10dV3QffnedVGXlgD";
    let targetStatus: "idle" | "busy" = "idle";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_forward_no_watch" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/idle-forward-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/idle-forward-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "please do this",
          notifyOnCompletion: false,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ forwardStatus: "queued" });
      expect(payload.targetMessage).toMatchObject({ opencodeDeliveryStatus: "queued" });
      await waitForForwardStatus(origin, sourceSessionId, payload.message.id, "sent");
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");

      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkIdleNotification(payload.targetMessage.id)).toBe(false);

      targetStatus = "idle";
      opencodeStatusCache.clear();
      expect(await checkIdleNotification(payload.targetMessage.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const targetQueue = await fetch(`${origin}/api/sessions/${targetSessionId}/messages`).then(
        (res) => res.json(),
      );
      expect(targetQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            clientMessageId: `target-idle-${payload.targetMessage.id}`,
            text: `<say-to-me-system>${targetSessionId} is idle now</say-to-me-system>`,
          }),
        ]),
      );
      expect(
        sourceQueue.messages.some(
          (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
        ),
      ).toBe(false);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("posts the target idle message when fire-and-forget forwarded work starts queued", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_215822b77754qWjpLZvQjHxYUj";
    const targetSessionId = "ses_14855a3877c5Izufbcw3lLAJs1";
    let targetStatus: "idle" | "busy" = "busy";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_forward_queued_no_watch" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/idle-queued-forward-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/idle-queued-forward-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "please do this later",
          notifyOnCompletion: false,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ forwardStatus: "queued" });
      expect(payload.targetMessage).toMatchObject({ opencodeDeliveryStatus: "queued" });

      targetStatus = "idle";
      opencodeStatusCache.clear();
      const delivered = await waitForMessageStatus(
        origin,
        targetSessionId,
        payload.targetMessage.id,
        "sent",
      );

      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkIdleNotification(delivered.id)).toBe(false);

      targetStatus = "idle";
      opencodeStatusCache.clear();
      expect(await checkIdleNotification(delivered.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const targetQueue = await fetch(`${origin}/api/sessions/${targetSessionId}/messages`).then(
        (res) => res.json(),
      );
      expect(targetQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            clientMessageId: `target-idle-${delivered.id}`,
            opencodeDeliveryStatus: "ui_only",
            text: "Session is now idle.",
          }),
        ]),
      );
      expect(
        sourceQueue.messages.some(
          (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
        ),
      ).toBe(false);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("notifies even when forwarded work is already idle by the first completion check", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_19362a9d1cf4AnRN1XQpe77AX3";
    const targetSessionId = "ses_23aeb069ef64xS5dTidJmaSCS7";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: "idle" },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_notify_fast" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_fast_idle_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/notify-fast-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/notify-fast-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "please do this",
          notifyOnCompletion: true,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ forwardStatus: "queued" });
      await waitForForwardStatus(origin, sourceSessionId, payload.message.id, "sent");
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const targetQueue = await fetch(`${origin}/api/sessions/${targetSessionId}/messages`).then(
        (res) => res.json(),
      );
      const sourceNotice = sourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      const targetNotice = targetQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `target-idle-${payload.message.id}`,
      );
      const deliveredSourceNotice = await waitForMessageStatus(
        origin,
        sourceSessionId,
        sourceNotice.id,
        "sent",
      );
      expect(targetNotice).toMatchObject({
        text: `<say-to-me-system>${targetSessionId} is idle now</say-to-me-system>`,
      });
      expect(deliveredSourceNotice).toMatchObject({
        forwardRole: "target",
        forwardSourceMessageId: targetNotice.id,
        opencodeMessageId: "msg_fast_idle_notice",
        text: `<say-to-me-system>${targetSessionId} is idle now after message: please do this</say-to-me-system>`,
      });
      expect(sourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: payload.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: sourceNotice.id,
          }),
        ]),
      );
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("queues one completion notification when the source session is busy", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_78ccd19b5bfaCsU1ERcpzZ2WuW";
    const targetSessionId = "ses_df024386c1ddQeu8EX1hSTVdqO";
    let targetStatus: "idle" | "busy" = "idle";
    let sourceStatus: "idle" | "busy" = "busy";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: sourceStatus },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_notify_busy" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_busy_idle_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/notify-busy-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/notify-busy-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "please do this",
          notifyOnCompletion: true,
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(201);
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");

      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(false);

      targetStatus = "idle";
      sourceStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const targetQueue = await fetch(`${origin}/api/sessions/${targetSessionId}/messages`).then(
        (res) => res.json(),
      );
      const sourceNotice = sourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      const targetNotice = targetQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `target-idle-${payload.message.id}`,
      );
      expect(targetNotice).toMatchObject({
        text: `<say-to-me-system>${targetSessionId} is idle now</say-to-me-system>`,
      });
      expect(sourceNotice).toMatchObject({
        author: "user",
        forwardRole: "target",
        forwardSourceMessageId: targetNotice.id,
        opencodeDeliveryStatus: "queued",
        opencodeMessageId: null,
        text: `<say-to-me-system>${targetSessionId} is idle now after message: please do this</say-to-me-system>`,
      });
      expect(sourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: payload.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: sourceNotice.id,
          }),
        ]),
      );
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`),
        ),
      ).toHaveLength(0);
      sourceStatus = "busy";
      opencodeStatusCache.clear();
      sourceStatus = "idle";
      await waitForMessageStatus(origin, sourceSessionId, sourceNotice.id, "sent");
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`),
        ),
      ).toHaveLength(1);
      const deliveredSourceQueue = await fetch(
        `${origin}/api/sessions/${sourceSessionId}/messages`,
      ).then((res) => res.json());
      expect(deliveredSourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            opencodeDeliveryStatus: "sent",
            opencodeMessageId: "msg_busy_idle_notice",
          }),
        ]),
      );
      startForwardCompletionNotificationWatch({
        sourceMessageId: payload.message.id,
        sourceSessionId,
        targetMessageId: payload.targetMessage.id,
        targetSessionId,
        seenWorking: true,
      });
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`),
        ).length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("keeps failed forwarded idle notifications retryable when a restarted watch finds the source busy", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_d6aed9aa3815DEZkND0CgabDJP";
    const targetSessionId = "ses_a554287a99a4scsCQcDIPM6dsr";
    let targetStatus: "idle" | "busy" = "idle";
    let sourceStatus: "idle" | "busy" = "idle";
    let sourcePostCount = 0;
    const openCode = await mockOpenCode((req, res) => {
      const respond = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond(200, {
          [sourceSessionId]: { type: sourceStatus },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond(200, { info: { id: "msg_notify_failed_retry" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        sourcePostCount += 1;
        if (sourcePostCount === 1) return respond(500, { error: "retry later" });
        return respond(200, { info: { id: "msg_failed_retry_idle_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond(200, { id: sourceSessionId, directory: "/tmp/notify-failed-retry-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond(200, { id: targetSessionId, directory: "/tmp/notify-failed-retry-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", targetSessionId, text: "please do this" }),
      });
      const payload = await response.json();
      expect(response.status).toBe(201);
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");

      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(false);

      targetStatus = "idle";
      sourceStatus = "idle";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);
      expect(sourcePostCount).toBeGreaterThanOrEqual(1);

      let sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      let sourceNotice = sourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      sourceNotice = await waitForMessageStatus(origin, sourceSessionId, sourceNotice.id, "sent");
      expect(sourceNotice).toMatchObject({ opencodeDeliveryStatus: "sent" });

      sourceStatus = "busy";
      startForwardCompletionNotificationWatch({
        sourceMessageId: payload.message.id,
        sourceSessionId,
        targetMessageId: payload.targetMessage.id,
        targetSessionId,
        seenWorking: true,
      });
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then((res) =>
        res.json(),
      );
      sourceNotice = sourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      expect(sourceNotice).toMatchObject({ opencodeDeliveryStatus: "sent" });
      expect(sourcePostCount).toBeGreaterThanOrEqual(2);

      sourceStatus = "idle";
      startForwardCompletionNotificationWatch({
        sourceMessageId: payload.message.id,
        sourceSessionId,
        targetMessageId: payload.targetMessage.id,
        targetSessionId,
        seenWorking: true,
      });
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then((res) =>
        res.json(),
      );
      sourceNotice = sourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      expect(sourceNotice).toMatchObject({
        opencodeDeliveryStatus: "sent",
        opencodeMessageId: "msg_failed_retry_idle_notice",
      });
      expect(sourcePostCount).toBeGreaterThanOrEqual(2);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("coalesces busy-source forwarded idle notifications per target session", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_3a442c05b63bpiyOwFQ5Ka6hf1";
    const targetSessionId = "ses_7d2c4c65d10743FlnlW6Bkmqit";
    let targetStatus: "idle" | "busy" = "idle";
    let sourceStatus: "idle" | "busy" = "busy";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: sourceStatus },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_notify_coalesce" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_coalesced_idle_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/notify-coalesce-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/notify-coalesce-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const firstResponse = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", targetSessionId, text: "first watched task" }),
      });
      const secondResponse = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", targetSessionId, text: "second watched task" }),
      });
      const first = await firstResponse.json();
      const second = await secondResponse.json();
      expect(firstResponse.status).toBe(201);
      expect(secondResponse.status).toBe(201);
      startForwardCompletionNotificationWatch({
        sourceMessageId: first.message.id,
        sourceSessionId,
        targetMessageId: first.targetMessage.id,
        targetSessionId,
        seenWorking: true,
      });
      startForwardCompletionNotificationWatch({
        sourceMessageId: second.message.id,
        sourceSessionId,
        targetMessageId: second.targetMessage.id,
        targetSessionId,
        seenWorking: true,
      });

      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(first.message.id)).toBe(false);
      expect(await checkForwardCompletionNotification(second.message.id)).toBe(false);

      targetStatus = "idle";
      sourceStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(first.message.id)).toBe(true);
      expect(await checkForwardCompletionNotification(second.message.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const sourceNotices = sourceQueue.messages.filter(
        (message: ApiMessage) =>
          message.clientMessageId === `forward-idle-${first.message.id}` ||
          message.clientMessageId === `forward-idle-${second.message.id}`,
      );
      expect(sourceNotices).toHaveLength(1);
      expect(sourceNotices[0]).toMatchObject({
        opencodeDeliveryStatus: "queued",
        opencodeMessageId: null,
        text: `<say-to-me-system>${targetSessionId} is idle now after message: first watched task</say-to-me-system>`,
      });
      expect(sourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: first.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: sourceNotices[0].id,
          }),
          expect.objectContaining({
            id: second.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: sourceNotices[0].id,
          }),
        ]),
      );

      sourceStatus = "idle";
      startForwardCompletionNotificationWatch({
        sourceMessageId: second.message.id,
        sourceSessionId,
        targetMessageId: second.targetMessage.id,
        targetSessionId,
        seenWorking: true,
      });
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(second.message.id)).toBe(true);
      const restartedSourceQueue = await fetch(
        `${origin}/api/sessions/${sourceSessionId}/messages`,
      ).then((res) => res.json());
      const restartedSourceNotices = restartedSourceQueue.messages.filter(
        (message: ApiMessage) =>
          message.clientMessageId === `forward-idle-${first.message.id}` ||
          message.clientMessageId === `forward-idle-${second.message.id}`,
      );
      expect(restartedSourceNotices).toHaveLength(1);
      expect(restartedSourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: sourceNotices[0].id,
            opencodeDeliveryStatus: expect.stringMatching(/queued|pending|sent/),
          }),
          expect.objectContaining({
            id: first.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: sourceNotices[0].id,
          }),
          expect.objectContaining({
            id: second.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: sourceNotices[0].id,
          }),
        ]),
      );
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("creates a fresh source notice on a second forward after the first was delivered", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_6525cc35527cinT6bNApojdJhF";
    const targetSessionId = "ses_48ba70ff71a1j4ZgagKSd7fi0D";
    let targetStatus: "idle" | "busy" = "idle";
    let sourceStatus: "idle" | "busy" = "idle";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: sourceStatus },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_second_forward_target" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_second_forward_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/notify-second-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/notify-second-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const first = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "first task",
          notifyOnCompletion: true,
        }),
      }).then((response) => response.json());
      await waitForForwardStatus(origin, sourceSessionId, first.message.id, "sent");
      await waitForMessageStatus(origin, targetSessionId, first.targetMessage.id, "sent");

      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(first.message.id)).toBe(false);

      targetStatus = "idle";
      sourceStatus = "idle";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(first.message.id)).toBe(true);

      const firstNotice = await waitForMessageStatus(
        origin,
        sourceSessionId,
        (
          await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then((res) =>
            res.json(),
          )
        ).messages.find(
          (message: ApiMessage) => message.clientMessageId === `forward-idle-${first.message.id}`,
        ).id,
        "sent",
      );
      expect(firstNotice.text).toBe("Session is now idle.");

      const second = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "second task",
          notifyOnCompletion: true,
        }),
      }).then((response) => response.json());
      await waitForForwardStatus(origin, sourceSessionId, second.message.id, "sent");
      await waitForMessageStatus(origin, targetSessionId, second.targetMessage.id, "sent");

      targetStatus = "busy";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(second.message.id)).toBe(false);

      targetStatus = "idle";
      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(second.message.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const secondNotice = sourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${second.message.id}`,
      );
      expect(secondNotice).toBeTruthy();
      expect(secondNotice.id).not.toBe(firstNotice.id);
      const deliveredSecondNotice = await waitForMessageStatus(
        origin,
        sourceSessionId,
        secondNotice.id,
        "sent",
      );
      expect(deliveredSecondNotice).toMatchObject({
        forwardRole: "target",
        opencodeDeliveryStatus: "sent",
        text: "Session is now idle.",
      });
      expect(sourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: second.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: secondNotice.id,
          }),
        ]),
      );
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("keeps notify-on-completion when the target session starts busy", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_5afe8701ad64U3t7hHRKs2BR5h";
    const targetSessionId = "ses_86f470a5a309lEnX5IZ13ISKRw";
    let targetStatus: "idle" | "busy" = "busy";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_notify_queued" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_queued_idle_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/notify-queued-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/notify-queued-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "please do this",
          notifyOnCompletion: true,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ forwardStatus: "queued" });
      expect(payload.targetMessage).toMatchObject({
        forwardStatus: "queued",
        opencodeDeliveryStatus: "queued",
      });

      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(false);

      targetStatus = "idle";
      opencodeStatusCache.clear();
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");
      await waitForForwardStatus(origin, sourceSessionId, payload.message.id, "sent");

      let queue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then((res) =>
        res.json(),
      );
      expect(queue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: payload.message.id, forwardStatus: "sent" }),
        ]),
      );
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${targetSessionId}/message`),
        ),
      ).toHaveLength(1);

      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const targetQueue = await fetch(`${origin}/api/sessions/${targetSessionId}/messages`).then(
        (res) => res.json(),
      );
      const sourceNotice = sourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      const targetNotice = targetQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `target-idle-${payload.message.id}`,
      );
      const deliveredSourceNotice = await waitForMessageStatus(
        origin,
        sourceSessionId,
        sourceNotice.id,
        "sent",
      );
      expect(targetNotice).toMatchObject({
        text: "Session is now idle.",
      });
      expect(deliveredSourceNotice).toMatchObject({
        forwardRole: "target",
        forwardSourceMessageId: targetNotice.id,
        opencodeMessageId: "msg_queued_idle_notice",
        text: "Session is now idle.",
      });
      expect(sourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: payload.message.id,
            forwardStatus: "notified",
            forwardTargetMessageId: sourceNotice.id,
          }),
        ]),
      );
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("keeps notify-on-completion when a queued forward is flushed by the target session", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_cefab99440fcUJdwTO6B2gb4R7";
    const targetSessionId = "ses_82539735e295v40p9y3wIti5ZV";
    let targetStatus: "idle" | "busy" = "busy";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_notify_flush" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_flush_idle_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/notify-flush-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/notify-flush-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", targetSessionId, text: "please do this" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ forwardStatus: "queued" });

      targetStatus = "idle";
      opencodeStatusCache.clear();
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");
      await waitForForwardStatus(origin, sourceSessionId, payload.message.id, "sent");

      const sourceQueue = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`).then(
        (res) => res.json(),
      );
      const targetQueue = await fetch(`${origin}/api/sessions/${targetSessionId}/messages`).then(
        (res) => res.json(),
      );
      expect(sourceQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: payload.message.id, forwardStatus: "sent" }),
        ]),
      );
      expect(targetQueue.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: payload.targetMessage.id,
            forwardStatus: "sent",
            opencodeDeliveryStatus: "sent",
          }),
        ]),
      );

      opencodeStatusCache.clear();
      expect(await checkForwardCompletionNotification(payload.message.id)).toBe(true);

      const notifiedSourceQueue = await fetch(
        `${origin}/api/sessions/${sourceSessionId}/messages`,
      ).then((res) => res.json());
      const sourceNotice = notifiedSourceQueue.messages.find(
        (message: ApiMessage) => message.clientMessageId === `forward-idle-${payload.message.id}`,
      );
      const deliveredSourceNotice = await waitForMessageStatus(
        origin,
        sourceSessionId,
        sourceNotice.id,
        "sent",
      );
      expect(deliveredSourceNotice).toMatchObject({
        opencodeMessageId: "msg_flush_idle_notice",
        text: "Session is now idle.",
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("validates notify-on-completion as a boolean", async () => {
    try {
      const response = await fetch(
        `${origin}/api/sessions/ses_053848e37ed1gPTzthxYLrKwKp/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            targetSessionId: "ses_7ec70ca9dbb7RWF0vHqqD8zBVc",
            text: "please do this",
            notifyOnCompletion: "yes",
          }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "Notify on completion must be a boolean.",
      });
    } finally {
      server.close();
    }
  });

  it("queues forwarded messages when the target session is busy", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_9459a64516d6E1j04Uqx1w6aab";
    const targetSessionId = "ses_3a06aaee8b4anycU9jU4xo9Fqw";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({ [targetSessionId]: { type: "busy" } });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/forward-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", targetSessionId, text: "hold this" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ forwardStatus: "queued" });
      expect(payload.targetMessage).toMatchObject({
        forwardStatus: "queued",
        opencodeDeliveryStatus: "queued",
      });
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${targetSessionId}/message`),
        ),
      ).toHaveLength(0);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
    }
  });

  it("keeps failed forwarded delivery queued for retry", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_87b9fb471e59AxRMOpU0gr9cSN";
    const targetSessionId = "ses_c3d5425c4b32bLtpOolONE9hBf";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond(200, { [targetSessionId]: { type: "idle" } });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond(500, { error: "nope" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond(200, { id: targetSessionId, directory: "/tmp/forward-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", targetSessionId, text: "this should fail" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({ forwardStatus: "queued" });
      expect(payload.targetMessage).toMatchObject({
        forwardStatus: "queued",
        opencodeDeliveryStatus: "queued",
      });
      let targetMessage: ApiMessage | undefined;
      await waitFor(async () => {
        targetMessage = (await fetchSessionMessages(origin, targetSessionId)).find(
          (message) => message.id === payload.targetMessage.id,
        );
        return Boolean(targetMessage?.opencodeDeliveryError);
      });
      expect(targetMessage?.opencodeDeliveryStatus).toBe("queued");
      expect(targetMessage?.opencodeDeliveryError).toContain("OpenCode returned HTTP 500");
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
    }
  });
});
