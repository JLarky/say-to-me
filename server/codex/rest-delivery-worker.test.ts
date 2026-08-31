import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
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
const { codexDeliveryJobs, messages: messagesTable } = await import("../db/drizzle-schema.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueCodexDeliveryJob } = await import("./durable-delivery.ts");
const { hasExternalCliSessionWork } = await import("../external-cli/cli-session-busy.ts");
const { hasLiveChild, resetLiveChildrenForTests } = await import("../external-cli/live-child.ts");
const { codexCommandArgs, codexDeliveryPrompt, parseCodexLastMessage, runCodexRestDeliveryOnce } =
  await import("./rest-delivery-worker.ts");

describe("Codex REST delivery worker", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    process.env.SAY_TO_ME_CODEX_WORKER_MODE = "echo";
  });

  afterEach(async () => {
    resetLiveChildrenForTests();
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_CODEX_WORKER_MODE;
    delete process.env.SAY_TO_ME_CODEX_BIN;
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
      `Echo from Codex worker: ${codexDeliveryPrompt({ codexSessionId: sessionId }, message)}`,
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

  it("includes the isolated CLI origin", () => {
    expect(
      codexDeliveryPrompt(
        { codexSessionId: "cx_abc" },
        { text: "hello" },
        {
          env: { SAY_TO_ME_URL: "http://127.0.0.1:5412" },
          existsSync: () => false,
          readFileSync: () => "",
        },
      ),
    ).toContain("say-to-me api --server http://127.0.0.1:5412");
  });

  it("isolated gate: Stop stays busy after stamping cliTurnEndedAt until the Codex child exits", async () => {
    const sessionId = `cx_${randomUUID()}`;
    const cwd = mkdtempSync(path.join(tmpdir(), "say-to-me-codex-busy-gate-"));
    const provider = path.join(cwd, "codex.sh");
    writeFileSync(
      provider,
      [
        "#!/bin/sh",
        "out=''",
        "prev=''",
        'for arg in "$@"; do',
        '  if [ "$prev" = "-o" ]; then out="$arg"; fi',
        '  prev="$arg"',
        "done",
        "sleep 2",
        "sleep 8",
        'if [ -n "$out" ]; then printf "2 minutes\\n" > "$out"; fi',
        "",
      ].join("\n"),
    );
    chmodSync(provider, 0o755);
    process.env.SAY_TO_ME_CODEX_WORKER_MODE = "codex";
    process.env.SAY_TO_ME_CODEX_BIN = provider;
    expect(new URL(process.env.SAY_TO_ME_INTERNAL_URL!).port).not.toBe("5411");
    setSessionCwd(sessionId, cwd);
    const message = insertMessageRow({
      sessionId,
      text: "sleep then reply 2 minutes",
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

    const worker = Effect.runPromise(runCodexRestDeliveryOnce("busy-gate", sessionId));
    await expect.poll(() => hasLiveChild(sessionId), { timeout: 15_000 }).toBe(true);

    drizzleDb
      .update(codexDeliveryJobs)
      .set({ cliTurnEndedAt: Date.now() })
      .where(eq(codexDeliveryJobs.messageId, message.id))
      .run();
    expect(hasExternalCliSessionWork(sessionId)).toBe(true);

    await expect(worker).resolves.toBe(true);
    expect(hasExternalCliSessionWork(sessionId)).toBe(false);
  }, 40_000);
});
