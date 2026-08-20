import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { drizzleDb } = await import("../db/index.ts");
const { claudeDeliveryJobs, codexDeliveryJobs, grokDeliveryJobs } =
  await import("../db/drizzle-schema.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueClaudeDeliveryJob } = await import("../claude/durable-delivery.ts");
const { runClaudeRestDeliveryOnce } = await import("../claude/rest-delivery-worker.ts");
const { enqueueCodexDeliveryJob } = await import("../codex/durable-delivery.ts");
const { runCodexRestDeliveryOnce } = await import("../codex/rest-delivery-worker.ts");
const { enqueueGrokDeliveryJob } = await import("../grok/durable-delivery.ts");
const { runGrokRestDeliveryOnce } = await import("../grok/rest-delivery-worker.ts");

const scriptDir = mkdtempSync(path.join(tmpdir(), "say-to-me-dispatch-providers-"));
const invocationLog = path.join(scriptDir, "invocations.log");

/**
 * Stands in for a provider binary: records that it was invoked, then exits with
 * `exitCode`. A non-zero exit is a provider that ran and failed — the case that
 * must not be prompted a second time.
 */
function writeFakeProvider(name: string, exitCode: number): string {
  const script = path.join(scriptDir, `${name}-${exitCode}.sh`);
  writeFileSync(
    script,
    `#!/bin/sh\nprintf 'invoked\\n' >> ${JSON.stringify(invocationLog)}\nexit ${exitCode}\n`,
  );
  chmodSync(script, 0o755);
  return script;
}

function invocationCount(): number {
  try {
    return readFileSync(invocationLog, "utf8").trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function claudeJob(messageId: number) {
  const row = drizzleDb
    .select({
      id: claudeDeliveryJobs.id,
      status: claudeDeliveryJobs.status,
      attemptCount: claudeDeliveryJobs.attemptCount,
      lastError: claudeDeliveryJobs.lastError,
      promptDispatchedAt: claudeDeliveryJobs.promptDispatchedAt,
    })
    .from(claudeDeliveryJobs)
    .where(eq(claudeDeliveryJobs.messageId, messageId))
    .get();
  if (!row) throw new Error(`No Claude delivery job for message ${messageId}.`);
  return row;
}

function codexJob(messageId: number) {
  const row = drizzleDb
    .select({
      id: codexDeliveryJobs.id,
      status: codexDeliveryJobs.status,
      attemptCount: codexDeliveryJobs.attemptCount,
      lastError: codexDeliveryJobs.lastError,
      promptDispatchedAt: codexDeliveryJobs.promptDispatchedAt,
    })
    .from(codexDeliveryJobs)
    .where(eq(codexDeliveryJobs.messageId, messageId))
    .get();
  if (!row) throw new Error(`No Codex delivery job for message ${messageId}.`);
  return row;
}

function grokJob(messageId: number) {
  const row = drizzleDb
    .select({
      id: grokDeliveryJobs.id,
      status: grokDeliveryJobs.status,
      attemptCount: grokDeliveryJobs.attemptCount,
      lastError: grokDeliveryJobs.lastError,
      promptDispatchedAt: grokDeliveryJobs.promptDispatchedAt,
    })
    .from(grokDeliveryJobs)
    .where(eq(grokDeliveryJobs.messageId, messageId))
    .get();
  if (!row) throw new Error(`No Grok delivery job for message ${messageId}.`);
  return row;
}

let sessionCounter = 0;

function seedClaudeSession(text: string): { sessionId: string; messageId: number } {
  sessionCounter += 1;
  const sessionId = `cc_00000000-0000-4000-8000-${String(sessionCounter).padStart(12, "0")}`;
  setSessionCwd(sessionId, scriptDir);
  const message = insertMessageRow({
    sessionId,
    text,
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
  return { sessionId, messageId: message.id };
}

function seedCodexSession(text: string): { sessionId: string; messageId: number } {
  sessionCounter += 1;
  const sessionId = `cx_00000000-0000-4000-8000-${String(sessionCounter).padStart(12, "0")}`;
  setSessionCwd(sessionId, scriptDir);
  const message = insertMessageRow({
    sessionId,
    text,
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
  return { sessionId, messageId: message.id };
}

function seedGrokSession(text: string): { sessionId: string; messageId: number } {
  sessionCounter += 1;
  const sessionId = `gr_00000000-0000-4000-8000-${String(sessionCounter).padStart(12, "0")}`;
  setSessionCwd(sessionId, scriptDir);
  const message = insertMessageRow({
    sessionId,
    text,
    extraMarkdown: null,
    author: "user",
    status: "received",
    links: null,
    sessionRefs: null,
    clientMessageId: null,
  });
  enqueueGrokDeliveryJob({
    messageId: message.id,
    messageSessionId: sessionId,
    grokSessionId: sessionId,
    kind: "direct_user_message",
  });
  return { sessionId, messageId: message.id };
}

describe("Claude REST delivery worker dispatch fencing", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    writeFileSync(invocationLog, "");
    drizzleDb.delete(claudeDeliveryJobs).run();
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    process.env.SAY_TO_ME_CLAUDE_WORKER_MODE = "claude";
  });

  afterEach(async () => {
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
    delete process.env.SAY_TO_ME_CLAUDE_BIN;
  });

  it("does not prompt again after the provider ran and exited non-zero", async () => {
    process.env.SAY_TO_ME_CLAUDE_BIN = writeFakeProvider("claude", 1);
    const { sessionId, messageId } = seedClaudeSession("post-dispatch failure");

    await expect(Effect.runPromise(runClaudeRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(1);
    const job = claudeJob(messageId);
    expect(job.status).toBe("failed");
    expect(job.promptDispatchedAt).not.toBeNull();
    expect(job.lastError).toContain("exited with code 1");
    expect(getMessage(messageId)).toMatchObject({
      opencodeDeliveryStatus: "cli_unconfirmed",
      opencodeDeliveryError: job.lastError,
    });

    await expect(Effect.runPromise(runClaudeRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      false,
    );
    expect(invocationCount()).toBe(1);
  });

  it("retries a spawn failure even though the job is already marked dispatched", async () => {
    process.env.SAY_TO_ME_CLAUDE_BIN = path.join(scriptDir, "claude-definitely-not-installed");
    const { sessionId, messageId } = seedClaudeSession("spawn failure stays retryable");

    await expect(Effect.runPromise(runClaudeRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(0);
    const job = claudeJob(messageId);
    expect(job.promptDispatchedAt).not.toBeNull();
    expect(job.status).toBe("retrying");
    expect(job.lastError).toContain("could not be started");
    expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("queued");
  });
});

describe("Codex REST delivery worker dispatch fencing", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    writeFileSync(invocationLog, "");
    drizzleDb.delete(codexDeliveryJobs).run();
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    process.env.SAY_TO_ME_CODEX_WORKER_MODE = "codex";
  });

  afterEach(async () => {
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_CODEX_WORKER_MODE;
    delete process.env.SAY_TO_ME_CODEX_BIN;
  });

  it("does not prompt again after the provider ran and exited non-zero", async () => {
    // Codex writes a last-message temp file and cleans it up on both error and
    // close; a non-zero exit still counts as a started provider.
    process.env.SAY_TO_ME_CODEX_BIN = writeFakeProvider("codex", 1);
    const { sessionId, messageId } = seedCodexSession("post-dispatch failure");

    await expect(Effect.runPromise(runCodexRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(1);
    const job = codexJob(messageId);
    expect(job.status).toBe("failed");
    expect(job.promptDispatchedAt).not.toBeNull();
    expect(job.lastError).toContain("exited with code 1");
    expect(getMessage(messageId)).toMatchObject({
      opencodeDeliveryStatus: "cli_unconfirmed",
      opencodeDeliveryError: job.lastError,
    });

    await expect(Effect.runPromise(runCodexRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      false,
    );
    expect(invocationCount()).toBe(1);
  });

  it("retries a spawn failure even though the job is already marked dispatched", async () => {
    process.env.SAY_TO_ME_CODEX_BIN = path.join(scriptDir, "codex-definitely-not-installed");
    const { sessionId, messageId } = seedCodexSession("spawn failure stays retryable");

    await expect(Effect.runPromise(runCodexRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(0);
    const job = codexJob(messageId);
    expect(job.promptDispatchedAt).not.toBeNull();
    expect(job.status).toBe("retrying");
    expect(job.lastError).toContain("could not be started");
    expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("queued");
  });
});

describe("Grok REST delivery worker dispatch fencing", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    writeFileSync(invocationLog, "");
    drizzleDb.delete(grokDeliveryJobs).run();
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    process.env.SAY_TO_ME_GROK_WORKER_MODE = "grok";
  });

  afterEach(async () => {
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_GROK_WORKER_MODE;
    delete process.env.SAY_TO_ME_GROK_BIN;
  });

  it("does not prompt again after the provider ran and exited non-zero", async () => {
    process.env.SAY_TO_ME_GROK_BIN = writeFakeProvider("grok", 1);
    const { sessionId, messageId } = seedGrokSession("post-dispatch failure");

    await expect(Effect.runPromise(runGrokRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(1);
    const job = grokJob(messageId);
    expect(job.status).toBe("failed");
    expect(job.promptDispatchedAt).not.toBeNull();
    expect(job.lastError).toContain("exited with code 1");
    expect(getMessage(messageId)).toMatchObject({
      opencodeDeliveryStatus: "cli_unconfirmed",
      opencodeDeliveryError: job.lastError,
    });

    await expect(Effect.runPromise(runGrokRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      false,
    );
    expect(invocationCount()).toBe(1);
  });

  it("retries a spawn failure even though the job is already marked dispatched", async () => {
    process.env.SAY_TO_ME_GROK_BIN = path.join(scriptDir, "grok-definitely-not-installed");
    const { sessionId, messageId } = seedGrokSession("spawn failure stays retryable");

    await expect(Effect.runPromise(runGrokRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(0);
    const job = grokJob(messageId);
    expect(job.promptDispatchedAt).not.toBeNull();
    expect(job.status).toBe("retrying");
    expect(job.lastError).toContain("could not be started");
    expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("queued");
  });
});
