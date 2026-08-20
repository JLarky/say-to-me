import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { drizzleDb } = await import("../db/index.ts");
const { cursorDeliveryJobs } = await import("../db/drizzle-schema.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueCursorDeliveryJob } = await import("../cursor/durable-delivery.ts");
const { runCursorRestDeliveryOnce } = await import("../cursor/rest-delivery-worker.ts");

const UNCONFIRMED_MESSAGE =
  "Cursor was given this message, but the delivery could not be confirmed. Check the session before resending.";

const scriptDir = mkdtempSync(path.join(tmpdir(), "say-to-me-dispatch-worker-"));
const invocationLog = path.join(scriptDir, "invocations.log");

/**
 * Stands in for the `agent` binary: records that it was invoked with the prompt,
 * then exits with `exitCode`. A non-zero exit is a provider that ran and failed,
 * which is exactly the case that must not be prompted a second time.
 */
function writeFakeProvider(exitCode: number): string {
  const script = path.join(scriptDir, `agent-${exitCode}.sh`);
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

function cursorJob(messageId: number) {
  const row = drizzleDb
    .select({
      id: cursorDeliveryJobs.id,
      status: cursorDeliveryJobs.status,
      attemptCount: cursorDeliveryJobs.attemptCount,
      lastError: cursorDeliveryJobs.lastError,
      promptDispatchedAt: cursorDeliveryJobs.promptDispatchedAt,
    })
    .from(cursorDeliveryJobs)
    .where(eq(cursorDeliveryJobs.messageId, messageId))
    .get();
  if (!row) throw new Error(`No Cursor delivery job for message ${messageId}.`);
  return row;
}

let sessionCounter = 0;

function seedSession(text: string): { sessionId: string; messageId: number } {
  sessionCounter += 1;
  const sessionId = `cur_00000000-0000-4000-8000-${String(sessionCounter).padStart(12, "0")}`;
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
  enqueueCursorDeliveryJob({
    messageId: message.id,
    messageSessionId: sessionId,
    cursorSessionId: sessionId,
    kind: "direct_user_message",
  });
  return { sessionId, messageId: message.id };
}

describe("Cursor REST delivery worker dispatch fencing", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    writeFileSync(invocationLog, "");
    drizzleDb.delete(cursorDeliveryJobs).run();
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    // Exercise the real spawn path so provider failures are classified the way
    // production classifies them, rather than through the echo stand-in.
    process.env.SAY_TO_ME_CURSOR_WORKER_MODE = "cursor";
  });

  afterEach(async () => {
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_CURSOR_WORKER_MODE;
    delete process.env.SAY_TO_ME_CURSOR_BIN;
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("does not prompt again after the provider ran and exited non-zero", async () => {
    process.env.SAY_TO_ME_CURSOR_BIN = writeFakeProvider(1);
    const { sessionId, messageId } = seedSession("post-dispatch failure");

    await expect(Effect.runPromise(runCursorRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(1);
    const job = cursorJob(messageId);
    expect(job.status).toBe("failed");
    expect(job.promptDispatchedAt).not.toBeNull();
    expect(job.lastError).toContain("exited with code 1");
    expect(getMessage(messageId)).toMatchObject({
      opencodeDeliveryStatus: "cli_unconfirmed",
      opencodeDeliveryError: job.lastError,
    });

    // A worker that polls again must find nothing to do for this message.
    await expect(Effect.runPromise(runCursorRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      false,
    );
    expect(invocationCount()).toBe(1);
  });

  it("reports a dispatched-but-unconfirmed delivery instead of claiming it failed to send", async () => {
    process.env.SAY_TO_ME_CURSOR_BIN = writeFakeProvider(1);
    const { sessionId, messageId } = seedSession("unconfirmed is not failed");

    await Effect.runPromise(runCursorRestDeliveryOnce("worker-a", sessionId));

    expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("cli_unconfirmed");
    expect(getMessage(messageId)?.opencodeDeliveryStatus).not.toBe("failed");
  });

  it("retries a spawn failure even though the job is already marked dispatched", async () => {
    process.env.SAY_TO_ME_CURSOR_BIN = path.join(scriptDir, "definitely-not-installed");
    const { sessionId, messageId } = seedSession("spawn failure stays retryable");

    await expect(Effect.runPromise(runCursorRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(0);
    const job = cursorJob(messageId);
    // Marking happens before the spawn, so this job is dispatched and yet its
    // prompt provably never landed. It must go back to the queue.
    expect(job.promptDispatchedAt).not.toBeNull();
    expect(job.status).toBe("retrying");
    expect(job.lastError).toContain("could not be started");
    expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("queued");
  });

  it("re-enqueuing a message whose delivery is unconfirmed does not prompt again", async () => {
    process.env.SAY_TO_ME_CURSOR_BIN = writeFakeProvider(1);
    const { sessionId, messageId } = seedSession("re-enqueue after unconfirmed");

    await Effect.runPromise(runCursorRestDeliveryOnce("worker-a", sessionId));
    expect(cursorJob(messageId).status).toBe("failed");

    enqueueCursorDeliveryJob({
      messageId,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    await expect(Effect.runPromise(runCursorRestDeliveryOnce("worker-b", sessionId))).resolves.toBe(
      false,
    );

    expect(cursorJob(messageId).status).toBe("failed");
    expect(invocationCount()).toBe(1);
  });

  it("delivers normally when the provider succeeds", async () => {
    const script = path.join(scriptDir, "agent-ok.sh");
    writeFileSync(
      script,
      `#!/bin/sh\nprintf 'invoked\\n' >> ${JSON.stringify(invocationLog)}\n` +
        `printf '{"type":"result","is_error":false,"result":"all done"}'\n`,
    );
    chmodSync(script, 0o755);
    process.env.SAY_TO_ME_CURSOR_BIN = script;
    const { sessionId, messageId } = seedSession("happy path is unchanged");

    await expect(Effect.runPromise(runCursorRestDeliveryOnce("worker-a", sessionId))).resolves.toBe(
      true,
    );

    expect(invocationCount()).toBe(1);
    expect(cursorJob(messageId).status).toBe("succeeded");
    expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("sent");
  });
});
