import { createServer } from "node:http";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";

process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CURSOR_ECHO_ACCEPT_DELAY_MS = "0";
process.env.SAY_TO_ME_CURSOR_ECHO_REPLY_DELAY_MS = "50";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueCursorDeliveryJob } = await import("./durable-delivery.ts");
const { cursorAssistantText, cursorCommandArgs, parseCursorJsonOutput, runCursorRestDeliveryOnce } =
  await import("./rest-delivery-worker.ts");

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
    expect(getMessage(message.id + 1)).toMatchObject({
      author: "agent",
      extraMarkdown: `Echo from Cursor worker: you have to reply to this message with voice (cli \`say-to-me usage\` to learn how/why)\n\n${sessionId} says: rest worker echo`,
      sessionId,
    });
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
});
