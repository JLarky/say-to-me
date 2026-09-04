import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { JsonValue } from "@say-to-me/runtime-validation";
import {
  type ApiMessage,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
  waitFor,
} from "./api.harness.ts";
import { clearForwardCompletionNotificationWatches } from "./notifications.ts";
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

async function waitForOpenCodePrompt(
  openCode: Awaited<ReturnType<typeof mockOpenCode>>,
  sessionId: string,
): Promise<(typeof openCode.requests)[number]> {
  let prompt: (typeof openCode.requests)[number] | undefined;
  await waitFor(() => {
    prompt = openCode.requests.find(
      (request) => request.method === "POST" && request.url === `/session/${sessionId}/message`,
    );
    return prompt != null;
  });
  return prompt!;
}

describe("say API: message forwarding basics", () => {
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

  it("redacts inline mp3 temp paths when forwarding messages", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_fcd7a98f0bc6v56Z5lLtofpi3p";
    const targetSessionId = "ses_164d8c9d7437QDQrFNIXPrOtsa";
    const audioPath = path.join(tmpdir(), "12121212-1212-4212-8212-121212121212.mp3");
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: JsonValue) => {
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
        return respond({ info: { id: "msg_forwarded_audio" }, parts: [] });
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
          text: `please review ${audioPath}`,
          notifyOnCompletion: false,
        }),
      });
      const payload = await response.json();
      const prompt = await waitForOpenCodePrompt(openCode, targetSessionId);
      const promptText = (prompt.body as { parts: { text: string }[] }).parts[0].text;

      expect(response.status).toBe(201);
      expect(payload.message.text).toContain("please review [audio attachment]");
      expect(payload.targetMessage.text).toBe("please review [audio attachment]");
      expect(promptText).toContain("please review [audio attachment]");
      expect(promptText).not.toContain(audioPath);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("forwards user extra markdown as a target markdown attachment", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_e1943956a1d8SiYBHeSHRBOEUX";
    const targetSessionId = "ses_334fcbba58ddjqbpgCz22Lz823";
    const markdown = "# Timer UI requirements\n\n- trigger now\n- pause or stop";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: JsonValue) => {
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
        return respond({ info: { id: "msg_forwarded_markdown" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/forward-markdown-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/forward-markdown-target" });
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
          text: "Please implement timers.",
          extraMarkdown: markdown,
          notifyOnCompletion: false,
        }),
      });
      const payload = await response.json();
      const attachment = payload.targetMessage.attachments[0];
      const prompt = await waitForOpenCodePrompt(openCode, targetSessionId);
      const promptText = (prompt.body as { parts: { text: string }[] }).parts[0].text;

      expect(response.status).toBe(201);
      expect(payload.message.extraMarkdown).toBeNull();
      expect(payload.message.attachments).toEqual([]);
      expect(payload.targetMessage.extraMarkdown).toBeNull();
      expect(attachment).toMatchObject({
        originalName: "extra-markdown.md",
        mimeType: "text/markdown",
      });
      expect(readFileSync(attachment.filePath, "utf8")).toBe(markdown);
      expect(promptText).toContain("Please implement timers.");
      expect(promptText).toContain(attachment.filePath);
      expect(promptText).not.toContain("Timer UI requirements");
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("preserves links on both source and target when forwarding", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_f1a2b3c4d5e6ForwardLinkSrc";
    const targetSessionId = "ses_a9b8c7d6e5f4ForwardLinkTgt";
    const links = ["https://github.com/JLarky/say-to-me/pull/18"];
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
        return respond({ info: { id: "msg_forwarded_links" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/forward-links-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/forward-links-target" });
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
          text: "Please review pull request 18 with an Effect focus.",
          links,
          notifyOnCompletion: false,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({
        sessionId: sourceSessionId,
        forwardRole: "source",
        links,
      });
      expect(payload.targetMessage).toMatchObject({
        sessionId: targetSessionId,
        forwardRole: "target",
        text: "Please review pull request 18 with an Effect focus.",
        links,
      });

      const sourceMessages = await fetchSessionMessages(origin, sourceSessionId);
      const targetMessages = await fetchSessionMessages(origin, targetSessionId);
      expect(sourceMessages.find((message) => message.id === payload.message.id)?.links).toEqual(
        links,
      );
      expect(
        targetMessages.find((message) => message.id === payload.targetMessage.id)?.links,
      ).toEqual(links);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("forwards a leading raw session id shorthand with the target prompt stripped", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_792ad01e97a5v6UeRxKf79xhmB";
    const targetSessionId = "ses_12f94ae96ffepCN7Wdi3ZUA7zl";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: JsonValue) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: "idle" },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_auto_relay_source" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_auto_relay" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/auto-relay-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/auto-relay-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: `${targetSessionId} please sleep 5 seconds` }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({
        sessionId: sourceSessionId,
        forwardRole: "source",
        forwardTargetSessionId: targetSessionId,
        opencodeDeliveryStatus: null,
        opencodeMessageId: null,
        text: `<say-to-me-system>${targetSessionId} received message: please sleep 5 seconds. You will be notified once the session is idle.</say-to-me-system>`,
        sessions: [expect.objectContaining({ id: targetSessionId })],
      });
      expect(payload.targetMessage).toMatchObject({
        sessionId: targetSessionId,
        text: "please sleep 5 seconds",
        forwardRole: "target",
        forwardSourceSessionId: sourceSessionId,
        opencodeDeliveryStatus: "queued",
      });
      await waitForForwardStatus(origin, sourceSessionId, payload.message.id, "sent");
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`) &&
            JSON.stringify(request.body).includes("received message: please sleep 5 seconds"),
        ),
      ).toHaveLength(0);
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${targetSessionId}/message`) &&
            typeof request.body === "object" &&
            request.body != null &&
            JSON.stringify(request.body).includes(
              `${targetSessionId} said: please sleep 5 seconds`,
            ) &&
            !JSON.stringify(request.body).includes(`${targetSessionId} please sleep 5 seconds`),
        ),
      ).toHaveLength(1);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("forwards a leading aliased session mention with the target prompt stripped", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_4ba57698639aCv7iJ3bLCFre6x";
    const targetSessionId = "ses_12e688222ffeUE0jc3PK76cS8r";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: JsonValue) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({ [targetSessionId]: { type: "idle" } });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_alias_relay" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/alias-relay-target" });
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
          text: `say-to-me(${targetSessionId}, effect expert) ping me once you are done`,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({
        sessionId: sourceSessionId,
        forwardRole: "source",
        forwardTargetSessionId: targetSessionId,
        text: `<say-to-me-system>${targetSessionId} received message: ping me once you are done. You will be notified once the session is idle.</say-to-me-system>`,
        sessions: [expect.objectContaining({ id: targetSessionId, alias: "effect expert" })],
      });
      expect(payload.targetMessage).toMatchObject({
        sessionId: targetSessionId,
        text: "ping me once you are done",
        forwardRole: "target",
        forwardSourceSessionId: sourceSessionId,
        opencodeDeliveryStatus: "queued",
      });
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${targetSessionId}/message`) &&
            typeof request.body === "object" &&
            request.body != null &&
            JSON.stringify(request.body).includes(
              `${targetSessionId} said: ping me once you are done`,
            ) &&
            JSON.stringify(request.body).includes("ping me once you are done"),
        ),
      ).toHaveLength(1);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("allows forwarded completion notification to be disabled", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_563defa5d022tlBHB5pPharRsG";
    const targetSessionId = "ses_504c81119a5600Foe7xCxJonF0";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: JsonValue) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({ [targetSessionId]: { type: "idle" } });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_forwarded_no_notify" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/forward-target-no-notify" });
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
          text: "please check this",
          notifyOnCompletion: false,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({
        forwardRole: "source",
        forwardTargetSessionId: targetSessionId,
        forwardTargetMessageId: payload.targetMessage.id,
        forwardStatus: "queued",
      });
      expect(payload.targetMessage).toMatchObject({
        sessionId: targetSessionId,
        forwardRole: "target",
        forwardSourceSessionId: sourceSessionId,
        forwardSourceMessageId: payload.message.id,
        opencodeDeliveryStatus: "queued",
        opencodeMessageId: null,
        forwardStatus: "queued",
      });
      await waitForMessageStatus(origin, targetSessionId, payload.targetMessage.id, "sent");
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`),
        ),
      ).toHaveLength(0);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });
});
