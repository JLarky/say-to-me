import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";

process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_ECHO_ACCEPT_DELAY_MS = "0";
process.env.SAY_TO_ME_CODEX_ECHO_REPLY_DELAY_MS = "50";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { drizzleDb } = await import("../db/index.ts");
const { messages: messagesTable } = await import("../db/drizzle-schema.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueCodexDeliveryJob } = await import("./durable-delivery.ts");
const { codexCommandArgs, parseCodexLastMessage, runCodexRestDeliveryOnce } =
  await import("./rest-delivery-worker.ts");

describe("Codex REST delivery worker", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;
  let origin = "";

  beforeEach(async () => {
    const started = await listen(createApiMiddleware());
    server = started.server;
    origin = started.origin;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    process.env.SAY_TO_ME_CODEX_WORKER_MODE = "echo";
  });

  afterEach(async () => {
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_CODEX_WORKER_MODE;
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("claims and completes a Codex job through internal REST APIs", async () => {
    const sessionId = "cx_e6ca1259-5b7f-4de3-afd5-a877811435cb";
    setSessionCwd(sessionId, "/tmp/codex-rest-worker-test");
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
    enqueueCodexDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      codexSessionId: sessionId,
      kind: "direct_user_message",
    });

    const worked = await Effect.runPromise(runCodexRestDeliveryOnce("test-rest-worker", sessionId));

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
      `Echo from Codex worker: you have to reply to this message with voice (cli \`say-to-me usage\` to learn how/why)\nThis session requires \`say-to-me api --server ${origin}\` on every call. Do not use say.local.\n\n${sessionId} says: rest worker echo`,
    );
  });

  it("builds codex exec resume command args", () => {
    expect(codexCommandArgs("1234", "1+1?")).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "resume",
      "1234",
      "1+1?",
    ]);
  });

  it("adds the reasoning effort config only when selected", () => {
    expect(codexCommandArgs("1234", "1+1?", "gpt-5.4", "xhigh")).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "resume",
      "1234",
      "--model",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="xhigh"',
      "1+1?",
    ]);
  });

  it("trims codex last-message output", () => {
    expect(parseCodexLastMessage("  hello  \n")).toBe("hello");
  });
});
