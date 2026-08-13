import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiMessage,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  createTestSession,
  listen,
} from "./api.harness.ts";
import { clearForwardCompletionNotificationWatches } from "./notifications.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";
import { stopAllCompletionWatches } from "./opencode/completion-watch.ts";
import { SPELLED_NUMBER_WORDS_ERROR } from "./validation.ts";

describe("say API: message fields and lifecycle", () => {
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

  it("accepts https links in user session message text", async () => {
    try {
      await createTestSession("ses_5e9f7fc0443509doyAur61AxbF");
      const response = await fetch(
        `${origin}/api/sessions/ses_5e9f7fc0443509doyAur61AxbF/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "Read https://example.com instead",
          }),
        },
      );
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({
        author: "user",
        text: "Read https://example.com instead",
      });
    } finally {
      server.close();
    }
  });

  it("accepts https links through the session message links field", async () => {
    try {
      await createTestSession("ses_e49bf5a7ddaeS2LkzNtzdSLPl0");
      const response = await fetch(
        `${origin}/api/sessions/ses_e49bf5a7ddaeS2LkzNtzdSLPl0/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            text: "Read this instead",
            links: ["https://example.com"],
          }),
        },
      );
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({
        text: "Read this instead",
        links: ["https://example.com"],
      });
    } finally {
      server.close();
    }
  });

  it("accepts full git SHAs in agent extra markdown", async () => {
    try {
      await createTestSession("ses_87507006f6b5NQ62ZEYikTeXaA");
      const response = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            text: "See the commit details below.",
            extraMarkdown: "Commit: d3152bae093ae41291ee91e80b1357b4849c75d3",
          }),
        },
      );
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({
        text: "See the commit details below.",
        extraMarkdown: "Commit: d3152bae093ae41291ee91e80b1357b4849c75d3",
      });
    } finally {
      server.close();
    }
  });

  it("rejects more than two common spelled-out numbers in agent session message text", async () => {
    try {
      const response = await fetch(
        `${origin}/api/sessions/ses_69b02dd861b4c3F4t3X3inMocs/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            text: "Items six, seven, and eight need follow-up.",
          }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: SPELLED_NUMBER_WORDS_ERROR,
      });
    } finally {
      server.close();
    }
  });

  it("stores explicit session references without applying alias renames", async () => {
    try {
      await createTestSession("ses_87507006f6b5NQ62ZEYikTeXaA");
      const initialResponse = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            text: "Set the first referenced session name.",
            sessions: [{ id: "ses_a43d8741bec9FSVpu4JerUoJ9K", alias: "Session name" }],
          }),
        },
      );
      expect(initialResponse.status).toBe(201);
      const initial = await initialResponse.json();
      await fetch(`${origin}/api/messages/${initial.message.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "played" }),
      });
      const explicitResponse = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            text: "Use the referenced session.",
            sessions: [{ id: "ses_a43d8741bec9FSVpu4JerUoJ9K", alias: "Morgan" }],
          }),
        },
      );
      expect(explicitResponse.status).toBe(201);
      const explicit = await explicitResponse.json();
      const laterResponse = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            text: "Use the same referenced session again.",
            sessions: ["ses_a43d8741bec9FSVpu4JerUoJ9K"],
          }),
        },
      );
      expect(laterResponse.status).toBe(201);
      const later = await laterResponse.json();
      await fetch(`${origin}/api/messages/${explicit.message.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "played" }),
      });
      const queue = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
      ).then((res) => res.json());
      const sessions = await fetch(`${origin}/api/sessions`).then((res) => res.json());

      expect(explicit.message.sessions).toMatchObject([
        { id: "ses_a43d8741bec9FSVpu4JerUoJ9K", alias: "Morgan" },
      ]);
      expect(later.message.sessions).toMatchObject([{ id: "ses_a43d8741bec9FSVpu4JerUoJ9K" }]);
      expect(
        sessions.sessions.find(
          (session: { id: string }) => session.id === "ses_a43d8741bec9FSVpu4JerUoJ9K",
        ),
      ).toMatchObject({ alias: null });
      expect(queue.messages.map((message: ApiMessage) => message.sessions?.[0]?.id)).toEqual([
        "ses_a43d8741bec9FSVpu4JerUoJ9K",
        "ses_a43d8741bec9FSVpu4JerUoJ9K",
        "ses_a43d8741bec9FSVpu4JerUoJ9K",
      ]);
    } finally {
      server.close();
    }
  });

  it("does not apply an explicit session alias already used by another session", async () => {
    try {
      await createTestSession("ses_87507006f6b5NQ62ZEYikTeXaA");
      await fetch(`${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "agent",
          text: "Name the first session.",
          sessions: [{ id: "ses_2587f3a8a2a6m0PQiwi9YWxLsP", alias: "Shared alias" }],
        }),
      });
      const response = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            text: "Try to reuse the alias.",
            sessions: [{ id: "ses_f1c6a79a690edqUhVcKOyeMHcU", alias: "Shared alias" }],
          }),
        },
      );
      const payload = await response.json();
      const sessions = await fetch(`${origin}/api/sessions`).then((res) => res.json());

      expect(response.status).toBe(201);
      expect(payload.message.sessions).toMatchObject([
        { id: "ses_f1c6a79a690edqUhVcKOyeMHcU", alias: "Shared alias" },
      ]);
      expect(
        sessions.sessions.find(
          (session: { id: string }) => session.id === "ses_2587f3a8a2a6m0PQiwi9YWxLsP",
        ),
      ).toMatchObject({ alias: null });
      expect(
        sessions.sessions.find(
          (session: { id: string }) => session.id === "ses_f1c6a79a690edqUhVcKOyeMHcU",
        ),
      ).toMatchObject({ alias: null });
    } finally {
      server.close();
    }
  });

  it("detects bare session ids in message text", async () => {
    try {
      const referencedSessionId = "ses_12345678901234567890123456";
      await createTestSession("ses_87507006f6b5NQ62ZEYikTeXaA");
      const response = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: `Please look at ${referencedSessionId} before replying.`,
          }),
        },
      );
      const payload = await response.json();
      const queue = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
      ).then((res) => res.json());

      expect(response.status).toBe(201);
      expect(payload.message.sessions).toMatchObject([{ id: referencedSessionId }]);
      expect(queue.messages[0].sessions).toMatchObject([{ id: referencedSessionId }]);
    } finally {
      server.close();
    }
  });

  it("does not detect short session-looking text as a session reference", async () => {
    try {
      await createTestSession("ses_87507006f6b5NQ62ZEYikTeXaA");
      const response = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "Please reply to ses_shortfake as plain text.",
          }),
        },
      );
      const payload = await response.json();
      const queue = await fetch(
        `${origin}/api/sessions/ses_87507006f6b5NQ62ZEYikTeXaA/messages`,
      ).then((res) => res.json());

      expect(response.status).toBe(201);
      expect(payload.message.sessions).toEqual([]);
      expect(queue.messages[0].sessions).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("stores optional extra markdown separately from spoken text", async () => {
    try {
      await createTestSession("ses_4dba2d93072dmPeha39ZbkahgM");
      const response = await fetch(
        `${origin}/api/sessions/ses_4dba2d93072dmPeha39ZbkahgM/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            extraMarkdown: "| A | B |\n|---|---|\n| true | false |",
            text: "Here is a small truth table.",
          }),
        },
      );
      const payload = await response.json();
      const queue = await fetch(
        `${origin}/api/sessions/ses_4dba2d93072dmPeha39ZbkahgM/messages`,
      ).then((res) => res.json());

      expect(response.status).toBe(201);
      expect(payload.message).toMatchObject({
        extraMarkdown: "| A | B |\n|---|---|\n| true | false |",
        text: "Here is a small truth table.",
      });
      expect(typeof payload.message.extraMarkdownHtml).toBe("string");
      expect(payload.message.extraMarkdownHtml).toContain("<table");
      expect(payload.message.extraMarkdownHtml.toLowerCase()).not.toContain("<script");
      expect(queue.messages[0]).toMatchObject({
        extraMarkdown: "| A | B |\n|---|---|\n| true | false |",
        text: "Here is a small truth table.",
      });
      expect(queue.messages[0].extraMarkdownHtml).toBe(payload.message.extraMarkdownHtml);
    } finally {
      server.close();
    }
  });

  it("stores optional push notification text on agent messages", async () => {
    try {
      await createTestSession("ses_65065b6e1ec7mko8083MrdDiH6");
      const withPush = await fetch(
        `${origin}/api/sessions/ses_65065b6e1ec7mko8083MrdDiH6/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "agent",
            pushNotificationText: "Build finished",
            text: "The build finished successfully.",
          }),
        },
      );
      const withPushPayload = await withPush.json();
      expect(withPush.status).toBe(201);
      expect(withPushPayload.message).toMatchObject({
        pushNotificationText: "Build finished",
        text: "The build finished successfully.",
      });

      const withoutPush = await fetch(
        `${origin}/api/sessions/ses_65065b6e1ec7mko8083MrdDiH6/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "No push for this one." }),
        },
      );
      const withoutPushPayload = await withoutPush.json();
      expect(withoutPush.status).toBe(201);
      expect(withoutPushPayload.message.pushNotificationText).toBeNull();
    } finally {
      server.close();
    }
  });

  it("rejects push notification text that is not a string or is on a user message", async () => {
    try {
      const badType = await fetch(
        `${origin}/api/sessions/ses_65065b6e1ec7mko8083MrdDiH6/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", pushNotificationText: 1, text: "bad push" }),
        },
      );
      expect(badType.status).toBe(400);

      const onUserMessage = await fetch(
        `${origin}/api/sessions/ses_65065b6e1ec7mko8083MrdDiH6/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            pushNotificationText: "nope",
            text: "user cannot push",
          }),
        },
      );
      expect(onUserMessage.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("rejects unsupported fields instead of silently dropping them", async () => {
    try {
      await createTestSession("ses_1dd864100ffes6uqv2NbJatAKt");
      const sayWithSession = await fetch(`${origin}/say`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "ses_eeb39d7c36ddkBg335I61iPEwh", text: "to a session" }),
      });
      expect(sayWithSession.status).toBe(400);

      const sayWithLinks = await fetch(`${origin}/say`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "with links", links: ["https://example.com"] }),
      });
      expect(sayWithLinks.status).toBe(400);

      const sayWithImages = await fetch(`${origin}/say`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "with images", images: ["/tmp/a.png"] }),
      });
      expect(sayWithImages.status).toBe(400);

      const sessionWithImages = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "shots", images: ["/tmp/a.png"] }),
        },
      );
      expect(sessionWithImages.status).toBe(400);

      const sessionWithBadLinks = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "bad links", links: "not-an-array" }),
        },
      );
      expect(sessionWithBadLinks.status).toBe(400);

      const sessionWithBadSessions = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "bad refs", sessions: ["bad"] }),
        },
      );
      expect(sessionWithBadSessions.status).toBe(400);

      const sessionWithBadExtraMarkdown = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", extraMarkdown: 1, text: "bad markdown" }),
        },
      );
      expect(sessionWithBadExtraMarkdown.status).toBe(400);

      // None of the rejected requests should have been stored.
      const queue = await fetch(`${origin}/api/queue`).then((response) => response.json());
      expect(queue.messages).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it("registers OpenCode activity preview routes by default", async () => {
    try {
      const response = await fetch(
        `${origin}/api/sessions/ses_af261eb974e5Tz4bVO2cbTzOz1/opencode-activity`,
      );
      const runtime = await fetch(
        `${origin}/api/debug/session-runtime/ses_af261eb974e5Tz4bVO2cbTzOz1`,
      ).then((response) => response.json());

      expect(response.status).toBe(200);
      expect(runtime).toEqual({ runtime: null });
    } finally {
      server.close();
    }
  });

  it("accepts played as a completion state", async () => {
    try {
      const created = await fetch(`${origin}/say`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "played" }),
      }).then((response) => response.json());

      const status = await fetch(`${origin}/api/messages/${created.message.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "played" }),
      });
      const queue = await fetch(`${origin}/api/queue`).then((response) => response.json());

      expect(status.ok).toBe(true);
      expect(queue.messages).toContainEqual(
        expect.objectContaining({ author: "agent", status: "played" }),
      );
    } finally {
      server.close();
    }
  });

  it("prunes oldest played entries when played history exceeds the cap", async () => {
    try {
      for (const text of ["one", "two", "three"]) {
        const created = await fetch(`${origin}/say`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }).then((response) => response.json());

        await fetch(`${origin}/api/messages/${created.message.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "played" }),
        });
      }

      const fourth = await fetch(`${origin}/say`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "four" }),
      }).then((response) => response.json());

      await fetch(`${origin}/api/messages/${fourth.message.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "played" }),
      });

      const queue = await fetch(`${origin}/api/queue`).then((response) => response.json());

      expect(queue.messages.map((message: ApiMessage) => message.text)).toEqual([
        "two",
        "three",
        "four",
      ]);
    } finally {
      server.close();
    }
  });

  it("does not prune messages from other sessions when one session hits the cap", async () => {
    try {
      const sessionA = "ses_1dd864100ffes6uqv2NbJatAKt";
      const sessionB = "ses_acea5a2ee51aFkcRCmXCebKkKN";
      await createTestSession(sessionA);
      await createTestSession(sessionB);

      // Fill sessionA up to the cap (3) and mark all played
      for (const text of ["a1", "a2", "a3"]) {
        const created = await fetch(`${origin}/api/sessions/${sessionA}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, author: "agent" }),
        }).then((response) => response.json());
        await fetch(`${origin}/api/messages/${created.message.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "played" }),
        });
      }

      // Add one message to sessionB and mark it played
      const bCreated = await fetch(`${origin}/api/sessions/${sessionB}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "b1", author: "agent" }),
      }).then((response) => response.json());
      await fetch(`${origin}/api/messages/${bCreated.message.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "played" }),
      });

      // Now add a 4th message to sessionA — pruning should only drop from sessionA
      const a4 = await fetch(`${origin}/api/sessions/${sessionA}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "a4", author: "agent" }),
      }).then((response) => response.json());
      await fetch(`${origin}/api/messages/${a4.message.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "played" }),
      });

      const queueA = await fetch(`${origin}/api/sessions/${sessionA}/messages`).then((r) =>
        r.json(),
      );
      const queueB = await fetch(`${origin}/api/sessions/${sessionB}/messages`).then((r) =>
        r.json(),
      );

      // sessionA should have pruned a1, keeping a2, a3, a4
      expect(queueA.messages.map((m: ApiMessage) => m.text)).toEqual(["a2", "a3", "a4"]);
      // sessionB's message must be untouched
      expect(queueB.messages.map((m: ApiMessage) => m.text)).toEqual(["b1"]);
    } finally {
      server.close();
    }
  });

  it("adds user replies beneath an agent message", async () => {
    try {
      const created = await fetch(`${origin}/say`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "agent" }),
      }).then((response) => response.json());

      await fetch(`${origin}/api/messages/${created.message.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "played" }),
      });

      const reply = await fetch(`${origin}/api/messages/${created.message.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "user" }),
      });
      const replyBody = await reply.json();
      const queue = await fetch(`${origin}/api/queue`).then((response) => response.json());

      expect(reply.status).toBe(201);
      expect(replyBody.message).toMatchObject({
        author: "user",
        parentId: created.message.id,
        status: "received",
        links: null,
        attachments: [],
      });
      expect(queue.messages).toContainEqual(
        expect.objectContaining({
          author: "user",
          parentId: created.message.id,
          status: "received",
        }),
      );
    } finally {
      server.close();
    }
  });
});
