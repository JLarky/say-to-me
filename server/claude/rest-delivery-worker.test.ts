import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";

function isTcpAddress(address: AddressInfo | string | null): address is AddressInfo {
  return address !== null && Object.hasOwn(Object(address), "port");
}

process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CLAUDE_ECHO_ACCEPT_DELAY_MS = "0";
process.env.SAY_TO_ME_CLAUDE_ECHO_REPLY_DELAY_MS = "50";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { drizzleDb } = await import("../db/index.ts");
const { claudeDeliveryJobs, messages: messagesTable } = await import("../db/drizzle-schema.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueClaudeDeliveryJob } = await import("./durable-delivery.ts");
const { hasExternalCliSessionWork } = await import("../external-cli/cli-session-busy.ts");
const { hasLiveChild, resetLiveChildrenForTests } = await import("../external-cli/live-child.ts");
const {
  claudeCommandArgs,
  claudeDeliveryPrompt,
  parseClaudeStreamLine,
  runClaudeRestDeliveryOnce,
} = await import("./rest-delivery-worker.ts");

describe("Claude REST delivery worker", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
  });

  afterEach(async () => {
    resetLiveChildrenForTests();
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
    delete process.env.SAY_TO_ME_CLAUDE_BIN;
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
      `Echo from Claude worker: ${claudeDeliveryPrompt({ claudeSessionId: sessionId }, message)}`,
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
    if (!isTcpAddress(address)) throw new Error("Expected TCP test server.");
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

  it("includes the isolated CLI origin", () => {
    expect(
      claudeDeliveryPrompt(
        { claudeSessionId: "cc_abc" },
        { text: "hello" },
        {
          env: { SAY_TO_ME_URL: "http://127.0.0.1:5412" },
          existsSync: () => false,
          readFileSync: () => "",
        },
      ),
    ).toContain("say-to-me api --server http://127.0.0.1:5412");
  });

  it("isolated gate: Stop stays busy after stamping cliTurnEndedAt until the Claude child exits", async () => {
    const sessionId = `cc_${randomUUID()}`;
    const cwd = mkdtempSync(path.join(tmpdir(), "say-to-me-claude-busy-gate-"));
    const provider = path.join(cwd, "claude.sh");
    writeFileSync(
      provider,
      [
        "#!/bin/sh",
        "sleep 2",
        `printf '%s\\n' '${JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "5" }] },
        })}'`,
        "sleep 8",
        `printf '%s\\n' '${JSON.stringify({
          type: "result",
          is_error: false,
          result: "2 minutes",
        })}'`,
        "",
      ].join("\n"),
    );
    chmodSync(provider, 0o755);
    process.env.SAY_TO_ME_CLAUDE_WORKER_MODE = "claude";
    process.env.SAY_TO_ME_CLAUDE_BIN = provider;
    expect(new URL(process.env.SAY_TO_ME_INTERNAL_URL!).port).not.toBe("5411");
    setSessionCwd(sessionId, cwd);
    const message = insertMessageRow({
      sessionId,
      text: "sleep, reply 5, sleep, reply 2 minutes",
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

    const worker = Effect.runPromise(runClaudeRestDeliveryOnce("busy-gate", sessionId));
    await expect.poll(() => hasLiveChild(sessionId), { timeout: 15_000 }).toBe(true);

    drizzleDb
      .update(claudeDeliveryJobs)
      .set({ cliTurnEndedAt: Date.now() })
      .where(eq(claudeDeliveryJobs.messageId, message.id))
      .run();
    expect(hasExternalCliSessionWork(sessionId)).toBe(true);

    await expect(worker).resolves.toBe(true);
    expect(hasExternalCliSessionWork(sessionId)).toBe(false);
  }, 40_000);
});
