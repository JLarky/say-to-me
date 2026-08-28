import { createServer } from "node:http";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";

process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CLAUDE_ECHO_ACCEPT_DELAY_MS = "0";
process.env.SAY_TO_ME_CLAUDE_ECHO_REPLY_DELAY_MS = "50";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { drizzleDb } = await import("../db/index.ts");
const { messages: messagesTable } = await import("../db/drizzle-schema.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueClaudeDeliveryJob } = await import("./durable-delivery.ts");
const { claudeCommandArgs, parseClaudeStreamLine, runClaudeRestDeliveryOnce } =
  await import("./rest-delivery-worker.ts");

describe("Claude REST delivery worker", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
  });

  afterEach(async () => {
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("claims and completes a Claude job through internal REST APIs", async () => {
    const sessionId = "cc_5c708e22-807e-4579-807a-b56d8e4341e1";
    setSessionCwd(sessionId, "/tmp/claude-rest-worker-test");
    const message = insertMessageRow({
      sessionId,
      text: "rest worker echo",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueClaudeDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      claudeSessionId: sessionId,
      kind: "direct_user_message",
    });

    const worked = await Effect.runPromise(
      runClaudeRestDeliveryOnce("test-rest-worker", sessionId),
    );

    expect(worked).toBe(true);
    expect(getMessage(message.id)).toMatchObject({ opencodeDeliveryStatus: "sent" });
    // The echo is looked up by session, not by id arithmetic: other tests share
    // the DB and may insert rows between this user message and its reply.
    const replies = drizzleDb
      .select({ extraMarkdown: messagesTable.extraMarkdown })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.sessionId, sessionId),
          eq(messagesTable.author, "agent"),
          gt(messagesTable.id, message.id),
        ),
      )
      .all();
    expect(replies.map((row) => row.extraMarkdown)).toContain(
      `Echo from Claude worker: you have to reply to this message with voice (cli \`say-to-me usage\` to learn how/why)\n\n${sessionId} says: rest worker echo`,
    );
  });

  it("retires when claim returns a non-200 response", async () => {
    if (server) await closeTestServer(server);
    server = null;
    const fakeServer = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server unavailable" }));
    });
    await new Promise<void>((resolve) => fakeServer.listen(0, "127.0.0.1", resolve));
    const address = fakeServer.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP test server.");
    process.env.SAY_TO_ME_INTERNAL_URL = `http://127.0.0.1:${address.port}`;

    try {
      await expect(
        Effect.runPromise(runClaudeRestDeliveryOnce("test-rest-worker", "cc_non200")),
      ).resolves.toBe("stale-worker");
    } finally {
      await closeTestServer(fakeServer);
    }
  });

  it("builds real Claude print command args with resume", () => {
    expect(claudeCommandArgs("--resume", "1234", "1+1?")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--resume",
      "1234",
      "--permission-mode",
      "bypassPermissions",
      "1+1?",
    ]);
  });

  it("extracts text from Claude stream JSON events", () => {
    expect(
      parseClaudeStreamLine(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "The answer is 2." }] },
        }),
      ),
    ).toEqual({ text: "The answer is 2." });
    expect(
      parseClaudeStreamLine(
        JSON.stringify({ type: "result", is_error: false, result: "Final answer." }),
      ),
    ).toEqual({ isError: false, text: "Final answer." });
  });
});
