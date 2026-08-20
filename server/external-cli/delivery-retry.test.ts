import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-test-delivery-retry-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";

const { createTestRequest, expectHandledResponse, teardownApi } = await import("../api.harness.ts");
const { dispatchEffectApiRequest } = await import("../api-routes/effect-api.ts");
const { drizzleDb } = await import("../db/index.ts");
const { claudeDeliveryJobs, codexDeliveryJobs, cursorDeliveryJobs, grokDeliveryJobs } =
  await import("../db/drizzle-schema.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const claude = await import("../claude/durable-delivery.ts");
const cursor = await import("../cursor/durable-delivery.ts");
const codex = await import("../codex/durable-delivery.ts");
const grok = await import("../grok/durable-delivery.ts");

type DeliveryJobsTable =
  | typeof claudeDeliveryJobs
  | typeof cursorDeliveryJobs
  | typeof codexDeliveryJobs
  | typeof grokDeliveryJobs;

type Lease = { id: number };

type BackendSuite<TJob extends Lease> = {
  label: string;
  /** Session id prefix that routes a message to this provider. */
  prefix: string;
  table: DeliveryJobsTable;
  enqueue: (messageId: number, sessionId: string) => void;
  claim: (workerId: string, sessionId?: string) => Promise<{ job: TJob } | null>;
  markDispatched: (job: TJob) => Promise<boolean>;
  fail: (job: TJob, error: string) => Promise<boolean>;
  /** The human override under test. */
  retryJob: (messageId: number) => TJob | null;
};

let sessionCounter = 0;

function nextSessionId(prefix: string): string {
  sessionCounter += 1;
  const suffix = String(sessionCounter).padStart(12, "0");
  return `${prefix}00000000-0000-4000-8000-${suffix}`;
}

function seedMessage(sessionId: string, text: string): number {
  setSessionCwd(sessionId, testDbDir);
  return insertMessageRow({
    sessionId,
    text,
    extraMarkdown: null,
    author: "user",
    status: "received",
    links: null,
    sessionRefs: null,
    clientMessageId: null,
  }).id;
}

function jobRow(table: DeliveryJobsTable, jobId: number) {
  const row = drizzleDb
    .select({
      status: table.status,
      nextAttemptAt: table.nextAttemptAt,
      lockedAt: table.lockedAt,
      lockedBy: table.lockedBy,
      lastError: table.lastError,
      promptDispatchedAt: table.promptDispatchedAt,
    })
    .from(table)
    .where(eq(table.id, jobId))
    .get();
  if (!row) throw new Error(`Delivery job ${jobId} disappeared.`);
  return row;
}

function retryRequest(messageId: number) {
  const request = createTestRequest(`/api/messages/${messageId}/retry-delivery`, {
    method: "POST",
  });
  return dispatchEffectApiRequest(request).then((response) =>
    expectHandledResponse(response, request),
  );
}

/**
 * Drive a message all the way to the state the dispatch marker strands: the
 * prompt was handed to the provider, the outcome came back unknown, and the job
 * is terminal with `promptDispatchedAt` set. Nothing automatic can revive it.
 */
async function seedDispatchedFailure<TJob extends Lease>(
  backend: BackendSuite<TJob>,
): Promise<{ sessionId: string; messageId: number; jobId: number }> {
  const sessionId = nextSessionId(backend.prefix);
  const messageId = seedMessage(sessionId, "dispatched, then lost");
  backend.enqueue(messageId, sessionId);
  const claimed = await backend.claim("worker-a", sessionId);
  if (!claimed) throw new Error(`Expected ${backend.label} to hand out a job.`);
  await backend.markDispatched(claimed.job);
  await backend.fail(claimed.job, "provider ran and failed");

  const row = jobRow(backend.table, claimed.job.id);
  expect(row.status).toBe("failed");
  expect(row.promptDispatchedAt).not.toBeNull();
  return { sessionId, messageId, jobId: claimed.job.id };
}

function describeBackend<TJob extends Lease>(backend: BackendSuite<TJob>): void {
  describe(backend.label, () => {
    it("clears the dispatch marker and makes a dispatched terminal job claimable again", async () => {
      const { sessionId, messageId, jobId } = await seedDispatchedFailure(backend);

      // The automatic path is still refused: only the human override clears it.
      backend.enqueue(messageId, sessionId);
      expect(jobRow(backend.table, jobId).status).toBe("failed");
      await expect(backend.claim("worker-b", sessionId)).resolves.toBeNull();

      const retried = backend.retryJob(messageId);
      expect(retried?.id).toBe(jobId);

      expect(jobRow(backend.table, jobId)).toMatchObject({
        status: "pending",
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        promptDispatchedAt: null,
      });
      expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("queued");

      const reclaimed = await backend.claim("worker-b", sessionId);
      expect(reclaimed?.job.id).toBe(jobId);
    });

    it("clears the dispatch marker through the retry route", async () => {
      const { messageId, jobId } = await seedDispatchedFailure(backend);

      const response = await retryRequest(messageId);
      expect(response.status).toBe(200);

      // The 200 alone would pass even if the marker survived, so assert the row.
      // Claimability is asserted as row state rather than by racing a claim: once
      // the job is pending and due, any worker is *entitled* to take it, so a test
      // that demands it still be sitting there asserts the opposite of the intent.
      // The direct-call test above owns the end-to-end claim.
      const row = jobRow(backend.table, jobId);
      expect(row).toMatchObject({
        status: "pending",
        lockedBy: null,
        promptDispatchedAt: null,
      });
      expect(row.nextAttemptAt).toBeLessThanOrEqual(Date.now());
    });

    it("enqueues a fresh job when the retry route finds no job row", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const messageId = seedMessage(sessionId, "never enqueued");

      const response = await retryRequest(messageId);
      expect(response.status).toBe(200);

      const claimed = await backend.claim("worker-a", sessionId);
      expect(claimed).not.toBeNull();
      expect(jobRow(backend.table, claimed!.job.id).promptDispatchedAt).toBeNull();
    });

    it("returns the message with the deprecated retry-opencode alias too", async () => {
      const { messageId, jobId } = await seedDispatchedFailure(backend);
      const request = createTestRequest(`/api/messages/${messageId}/retry-opencode`, {
        method: "POST",
      });
      const response = expectHandledResponse(await dispatchEffectApiRequest(request), request);

      expect(response.status).toBe(200);
      expect(jobRow(backend.table, jobId).promptDispatchedAt).toBeNull();
    });
  });
}

describe("external CLI delivery retry", () => {
  beforeEach(() => {
    process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
    process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
    process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
    process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";
  });

  afterAll(async () => {
    await teardownApi();
  });

  describeBackend({
    label: "Cursor",
    prefix: "cur_",
    table: cursorDeliveryJobs,
    enqueue: (messageId, sessionId) => {
      cursor.enqueueCursorDeliveryJob({
        messageId,
        messageSessionId: sessionId,
        cursorSessionId: sessionId,
        kind: "direct_user_message",
      });
    },
    claim: cursor.claimCursorDeliveryJobForWorker,
    markDispatched: cursor.markCursorDeliveryJobDispatchedFromWorker,
    fail: cursor.failCursorDeliveryJobFromWorker,
    retryJob: cursor.retryCursorDeliveryJob,
  });

  describeBackend({
    label: "Claude",
    prefix: "cc_",
    table: claudeDeliveryJobs,
    enqueue: (messageId, sessionId) => {
      claude.enqueueClaudeDeliveryJob({
        messageId,
        messageSessionId: sessionId,
        claudeSessionId: sessionId,
        kind: "direct_user_message",
      });
    },
    claim: claude.claimClaudeDeliveryJobForWorker,
    markDispatched: claude.markClaudeDeliveryJobDispatchedFromWorker,
    fail: claude.failClaudeDeliveryJobFromWorker,
    retryJob: claude.retryClaudeDeliveryJob,
  });

  describeBackend({
    label: "Codex",
    prefix: "cx_",
    table: codexDeliveryJobs,
    enqueue: (messageId, sessionId) => {
      codex.enqueueCodexDeliveryJob({
        messageId,
        messageSessionId: sessionId,
        codexSessionId: sessionId,
        kind: "direct_user_message",
      });
    },
    claim: codex.claimCodexDeliveryJobForWorker,
    markDispatched: codex.markCodexDeliveryJobDispatchedFromWorker,
    fail: codex.failCodexDeliveryJobFromWorker,
    retryJob: codex.retryCodexDeliveryJob,
  });

  describeBackend({
    label: "Grok",
    prefix: "gr_",
    table: grokDeliveryJobs,
    enqueue: (messageId, sessionId) => {
      grok.enqueueGrokDeliveryJob({
        messageId,
        messageSessionId: sessionId,
        grokSessionId: sessionId,
        kind: "direct_user_message",
      });
    },
    claim: grok.claimGrokDeliveryJobForWorker,
    markDispatched: grok.markGrokDeliveryJobDispatchedFromWorker,
    fail: grok.failGrokDeliveryJobFromWorker,
    retryJob: grok.retryGrokDeliveryJob,
  });

  describe("non-delivery backends", () => {
    it.each([
      ["a T3 session", "t3_00000000-0000-4000-8000-000000009001"],
      ["a voice session", "vo_shopping-notes"],
    ])("rejects %s with a 400", async (_label, sessionId) => {
      const messageId = seedMessage(sessionId, "no delivery backend here");

      const response = await retryRequest(messageId);

      expect(response.status).toBe(400);
      // The old wording claimed the session was not OpenCode-backed, which reads
      // as nonsense on a t3_ or voice session.
      const body = await response.json();
      expect(body).toMatchObject({ error: "Message is not in a delivery-backed session." });
    });
  });
});
