import { readFileSync } from "node:fs";
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

describe("say API: messages", () => {
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

  it("requires an explicit author for session message posts", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_1a9e96595109OOHAXQwR7fMmSO";
    const targetSessionId = "ses_cf2ad6b9131fKVw3T0dch4u5Wb";
    await createTestSession(sessionId);
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(
          JSON.stringify({ [sessionId]: { type: "idle" }, [targetSessionId]: { type: "idle" } }),
        );
        return;
      }
      res.end(JSON.stringify({ info: { id: "msg_should_not_send" }, parts: [] }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const missing = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "I finished the check." }),
      });
      const invalid = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "assistant", text: "I finished the check." }),
      });
      const missingForward = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSessionId, text: "please check this" }),
      });
      const queue = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((response) =>
        response.json(),
      );

      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({ error: expect.stringContaining("required") });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: expect.stringContaining("agent") });
      expect(missingForward.status).toBe(400);
      expect(queue.messages).toHaveLength(0);
      expect(openCode.requests.some((request) => request.method === "POST")).toBe(false);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("rejects external CLI user messages until a working directory is saved", async () => {
    const sessionId = "cc_5c708e22-807e-4579-807a-b56d8e4341e1";
    await createTestSession(sessionId);
    try {
      const response = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: "please run tests" }),
      });
      const queue = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((res) =>
        res.json(),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "External CLI sessions need a working directory before messages can be sent.",
      });
      expect(queue.messages).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it("rejects Cursor user messages until a working directory is saved", async () => {
    const sessionId = "cur_a35fda79-2e0e-4884-9085-0a250ef8f965";
    await createTestSession(sessionId);
    try {
      const response = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: "2+2" }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "External CLI sessions need a working directory before messages can be sent.",
      });
    } finally {
      server.close();
    }
  });

  it("returns 404 when posting an agent message to a missing session", async () => {
    const sessionId = "ses_c4313752b8a7qdYwA7jXT4IZ9l";
    try {
      const response = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "agent", text: "test wrong session send" }),
      });
      const sessions = await fetch(`${origin}/api/sessions`).then((res) => res.json());

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: "Session not found." });
      expect(sessions.sessions.some((session: { id: string }) => session.id === sessionId)).toBe(
        false,
      );
    } finally {
      server.close();
    }
  });

  it("deduplicates retried user messages by client message id", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_b1b63dee4e4eVMvrAUcXDVMaZD: { type: "idle" } }));
        return;
      }
      res.end(JSON.stringify({ info: { id: "msg_deduped" }, parts: [] }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession("ses_b1b63dee4e4eVMvrAUcXDVMaZD");
      const body = {
        author: "user",
        clientMessageId: "pending-dedupe-test",
        text: "same message",
      };
      const first = await fetch(`${origin}/api/sessions/ses_b1b63dee4e4eVMvrAUcXDVMaZD/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((response) => response.json());
      const secondResponse = await fetch(
        `${origin}/api/sessions/ses_b1b63dee4e4eVMvrAUcXDVMaZD/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const second = await secondResponse.json();
      const queue = await fetch(
        `${origin}/api/sessions/ses_b1b63dee4e4eVMvrAUcXDVMaZD/messages`,
      ).then((response) => response.json());

      expect(secondResponse.status).toBe(200);
      expect(second.message.id).toBe(first.message.id);
      expect(
        queue.messages.filter((message: ApiMessage) => message.author === "user"),
      ).toHaveLength(1);
      await waitForMessageStatus(
        origin,
        "ses_b1b63dee4e4eVMvrAUcXDVMaZD",
        first.message.id,
        "sent",
      );
      expect(
        openCode.requests.filter(
          (request) => request.url === "/session/ses_b1b63dee4e4eVMvrAUcXDVMaZD/message",
        ),
      ).toHaveLength(1);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("converts user extra markdown into a markdown attachment", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_23f0cf157774sUyuIcrUruc55f";
    const markdown = "## Context\n\n- keep the voice body short\n- preserve this table";
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ [sessionId]: { type: "idle" } }));
        return;
      }
      res.end(JSON.stringify({ info: { id: "msg_user_markdown" }, parts: [] }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          text: "Please use the attached markdown context.",
          extraMarkdown: markdown,
        }),
      }).then((response) => response.json());

      const attachment = created.message.attachments[0];
      const prompt = await waitForOpenCodePrompt(openCode, sessionId);
      const promptText = (prompt.body as { parts: { text: string }[] }).parts[0].text;
      const attachmentResponse = await fetch(`${origin}${attachment.url}`);

      expect(created.message.extraMarkdown).toBeNull();
      expect(attachment).toMatchObject({
        originalName: "extra-markdown.md",
        mimeType: "text/markdown",
        thumbnailDataUrl: "",
      });
      expect(readFileSync(attachment.filePath, "utf8")).toBe(markdown);
      expect(attachmentResponse.status).toBe(200);
      expect(attachmentResponse.headers.get("content-type")).toContain("text/markdown");
      expect(attachmentResponse.headers.get("content-disposition")).toContain(
        'inline; filename="extra-markdown.md"',
      );
      expect(attachmentResponse.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await attachmentResponse.text()).toBe(markdown);
      expect(promptText).toContain("Please use the attached markdown context.");
      expect(promptText).toContain(attachment.filePath);
      expect(promptText).not.toContain("preserve this table");
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });
});
