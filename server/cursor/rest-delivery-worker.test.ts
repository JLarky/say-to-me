import { createServer } from "node:http";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";

process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CURSOR_ECHO_ACCEPT_DELAY_MS = "0";
process.env.SAY_TO_ME_CURSOR_ECHO_REPLY_DELAY_MS = "50";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { drizzleDb } = await import("../db/index.ts");
const { messages: messagesTable } = await import("../db/drizzle-schema.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueCursorDeliveryJob } = await import("./durable-delivery.ts");
const {
  cursorAssistantText,
  cursorCommandArgs,
  cursorDeliveryPrompt,
  cursorTurnEndedOnClose,
  parseCursorJsonOutput,
  runCursorRestDeliveryOnce,
} = await import("./rest-delivery-worker.ts");

describe("Cursor REST delivery worker", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    process.env.SAY_TO_ME_CURSOR_WORKER_MODE = "echo";
  });

  afterEach(async () => {
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_CURSOR_WORKER_MODE;
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("claims and completes a Cursor job through internal REST APIs", async () => {
    const sessionId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";
    setSessionCwd(sessionId, "/tmp/cursor-rest-worker-test");
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
    enqueueCursorDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });

    const worked = await Effect.runPromise(
      runCursorRestDeliveryOnce("test-rest-worker", sessionId),
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
      `Echo from Cursor worker: ${cursorDeliveryPrompt({ cursorSessionId: sessionId }, message)}`,
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
        Effect.runPromise(runCursorRestDeliveryOnce("test-rest-worker", "cur_non200")),
      ).resolves.toBe("stale-worker");
    } finally {
      await closeTestServer(fakeServer);
    }
  });

  it("builds real Cursor print command args with resume and force", () => {
    expect(cursorCommandArgs("1234", "1+1?")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--resume",
      "1234",
      "--force",
      "1+1?",
    ]);
  });

  it("extracts text from Cursor json output", () => {
    expect(
      parseCursorJsonOutput(
        JSON.stringify({
          type: "result",
          is_error: false,
          result: "2 + 2 = **4**",
        }),
      ),
    ).toEqual({ isError: false, text: "2 + 2 = **4**" });
  });

  it("reads assistant text from stream-json without treating result as done", () => {
    expect(
      cursorAssistantText({
        type: "assistant",
        message: { content: [{ type: "text", text: "STARTING" }] },
      }),
    ).toBe("STARTING");
    expect(
      cursorAssistantText({
        type: "result",
        is_error: false,
        result: "done text is not idle",
      }),
    ).toBeNull();
    expect(
      parseCursorJsonOutput(
        [
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "STARTING" }] },
          }),
          JSON.stringify({ type: "result", is_error: false, result: "pirate ahoy" }),
        ].join("\n"),
      ),
    ).toEqual({ isError: false, text: "pirate ahoy" });
  });

  it("does not treat an early Cursor close without a final result as turn end", () => {
    const progressOnly = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "I am still working" }] },
    });
    expect(cursorTurnEndedOnClose(progressOnly, 0)).toBe(false);
    expect(cursorTurnEndedOnClose(progressOnly, 1)).toBe(false);
    expect(
      cursorTurnEndedOnClose(
        [progressOnly, JSON.stringify({ type: "result", is_error: false, result: "done" })].join(
          "\n",
        ),
        0,
      ),
    ).toBe(true);
  });

  it("includes the isolated CLI origin", () => {
    expect(
      cursorDeliveryPrompt(
        { cursorSessionId: "cur_abc" },
        { text: "hello" },
        {
          env: { SAY_TO_ME_URL: "http://127.0.0.1:5412" },
          existsSync: () => false,
          readFileSync: () => "",
        },
      ),
    ).toContain("say-to-me api --server http://127.0.0.1:5412");
  });
});
