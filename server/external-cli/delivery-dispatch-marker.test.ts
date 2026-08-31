import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-test-dispatch-marker-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";

const { teardownApi } = await import("../api.harness.ts");
const { drizzleDb } = await import("../db/index.ts");
const { claudeDeliveryJobs, codexDeliveryJobs, cursorDeliveryJobs, grokDeliveryJobs } =
  await import("../db/drizzle-schema.ts");
const { getMessage, insertMessageRow, listMessages } = await import("../messages.ts");
const { getSessionWorkStatus } = await import("./session-work-status.ts");
const { setSessionCwd } = await import("../sessions.ts");
const claude = await import("../claude/durable-delivery.ts");
const cursor = await import("../cursor/durable-delivery.ts");
const codex = await import("../codex/durable-delivery.ts");
const grok = await import("../grok/durable-delivery.ts");

const JOB_LEASE_MS = 30_000;

type DeliveryJobsTable =
  | typeof claudeDeliveryJobs
  | typeof cursorDeliveryJobs
  | typeof codexDeliveryJobs
  | typeof grokDeliveryJobs;

type Lease = { id: number; attemptCount: number };

type BackendSuite<TJob extends Lease> = {
  label: string;
  /** Session id prefix that routes a message to this provider. */
  prefix: string;
  table: DeliveryJobsTable;
  unconfirmedMessage: string;
  enqueue: (messageId: number, sessionId: string) => void;
  claim: (workerId: string, sessionId?: string) => Promise<{ job: TJob } | null>;
  markDispatched: (job: TJob) => Promise<boolean>;
  complete: (
    job: TJob,
    reply: string | null,
    options?: { readonly processExited?: boolean },
  ) => Promise<boolean>;
  retry: (job: TJob, error: string) => Promise<boolean>;
  fail: (
    job: TJob,
    error: string,
    options?: { readonly processExited?: boolean },
  ) => Promise<boolean>;
  renew: (job: TJob) => Promise<TJob | null>;
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
      attemptCount: table.attemptCount,
      lockedBy: table.lockedBy,
      lastError: table.lastError,
      promptDispatchedAt: table.promptDispatchedAt,
      cliTurnEndedAt: table.cliTurnEndedAt,
    })
    .from(table)
    .where(eq(table.id, jobId))
    .get();
  if (!row) throw new Error(`Delivery job ${jobId} disappeared.`);
  return row;
}

function expireLease(table: DeliveryJobsTable, jobId: number): void {
  drizzleDb
    .update(table)
    .set({ lockedAt: Date.now() - JOB_LEASE_MS - 1_000 })
    .where(eq(table.id, jobId))
    .run();
}

/**
 * The four providers share one delivery factory, so each one is run through the
 * same marker and lease assertions rather than trusting a single stand-in.
 */
function describeBackend<TJob extends Lease>(backend: BackendSuite<TJob>): void {
  async function claimOne(workerId: string, sessionId: string): Promise<TJob> {
    const claimed = await backend.claim(workerId, sessionId);
    if (!claimed) throw new Error(`Expected ${backend.label} to hand out a job.`);
    return claimed.job;
  }

  describe(backend.label, () => {
    it("does not return a dispatched job to the queue when its lease expires", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const messageId = seedMessage(sessionId, "stale lease must not re-prompt");
      backend.enqueue(messageId, sessionId);
      const job = await claimOne("worker-a", sessionId);
      await expect(backend.markDispatched(job)).resolves.toBe(true);

      expireLease(backend.table, job.id);
      // A worker sweeps expired leases as part of claiming.
      await expect(backend.claim("worker-b", sessionId)).resolves.toBeNull();

      const row = jobRow(backend.table, job.id);
      expect(row.status).toBe("failed");
      expect(row.lastError).toBe(backend.unconfirmedMessage);
      expect(row.promptDispatchedAt).not.toBeNull();
      expect(row.cliTurnEndedAt).not.toBeNull();
      expect(await getSessionWorkStatus(sessionId)).toBe("idle");
      // Terminal `failed`, but carrying the unconfirmed explanation rather than
      // the generic failure text, so the user knows to check before retrying.
      expect(getMessage(messageId)).toMatchObject({
        opencodeDeliveryStatus: "failed",
        opencodeDeliveryError: backend.unconfirmedMessage,
      });
    });

    it("goes idle after a dispatched reclaim and stays idle after a later clean turn", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const firstId = seedMessage(sessionId, "crashed mid-turn");
      backend.enqueue(firstId, sessionId);
      const first = await claimOne("worker-a", sessionId);
      await backend.markDispatched(first);
      expect(await getSessionWorkStatus(sessionId)).toBe("pending");

      expireLease(backend.table, first.id);
      await expect(backend.claim("worker-b", sessionId)).resolves.toBeNull();
      expect(await getSessionWorkStatus(sessionId)).toBe("idle");

      const secondId = seedMessage(sessionId, "turn two");
      backend.enqueue(secondId, sessionId);
      const second = await claimOne("worker-c", sessionId);
      await backend.markDispatched(second);
      expect(await getSessionWorkStatus(sessionId)).toBe("pending");
      await expect(backend.complete(second, "done", { processExited: true })).resolves.toBe(true);
      expect(await getSessionWorkStatus(sessionId)).toBe("idle");
    });

    it("closes the open CLI turn on fail and retry even without a prior turn-ended write", async () => {
      const failSession = nextSessionId(backend.prefix);
      const failMessage = seedMessage(failSession, "fail closes turn");
      backend.enqueue(failMessage, failSession);
      const failJob = await claimOne("fail-worker", failSession);
      await backend.markDispatched(failJob);
      await expect(backend.fail(failJob, "provider failed", { processExited: true })).resolves.toBe(
        true,
      );
      expect(jobRow(backend.table, failJob.id).cliTurnEndedAt).not.toBeNull();
      expect(await getSessionWorkStatus(failSession)).toBe("idle");

      const retrySession = nextSessionId(backend.prefix);
      const retryMessage = seedMessage(retrySession, "retry closes this attempt");
      backend.enqueue(retryMessage, retrySession);
      const retryJob = await claimOne("retry-worker", retrySession);
      await backend.markDispatched(retryJob);
      await expect(backend.retry(retryJob, "spawn failed")).resolves.toBe(true);
      expect(jobRow(backend.table, retryJob.id).cliTurnEndedAt).not.toBeNull();
      expect(jobRow(backend.table, retryJob.id).status).toBe("retrying");
      expect(await getSessionWorkStatus(retrySession)).toBe("pending");
    });

    it("still reclaims a job that was claimed but never dispatched", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const messageId = seedMessage(sessionId, "un-dispatched reclaim still works");
      backend.enqueue(messageId, sessionId);
      const job = await claimOne("worker-a", sessionId);
      expect(jobRow(backend.table, job.id).promptDispatchedAt).toBeNull();

      expireLease(backend.table, job.id);
      const reclaimed = await claimOne("worker-b", sessionId);

      expect(reclaimed.id).toBe(job.id);
      expect(jobRow(backend.table, job.id)).toMatchObject({
        status: "running",
        attemptCount: job.attemptCount + 1,
        lockedBy: "worker-b",
      });
      expect(getMessage(messageId)?.opencodeDeliveryStatus).not.toBe("failed");
    });

    it("refuses to revive a dispatched job on re-enqueue, but revives an un-dispatched one", async () => {
      const dispatchedSession = nextSessionId(backend.prefix);
      const dispatchedMessageId = seedMessage(dispatchedSession, "re-enqueue must not re-prompt");
      backend.enqueue(dispatchedMessageId, dispatchedSession);
      const dispatchedJob = await claimOne("worker-a", dispatchedSession);
      await backend.markDispatched(dispatchedJob);
      await backend.fail(dispatchedJob, "provider ran and failed", { processExited: true });

      backend.enqueue(dispatchedMessageId, dispatchedSession);
      expect(jobRow(backend.table, dispatchedJob.id).status).toBe("failed");

      const cleanSession = nextSessionId(backend.prefix);
      const cleanMessageId = seedMessage(cleanSession, "re-enqueue may revive this one");
      backend.enqueue(cleanMessageId, cleanSession);
      const cleanJob = await claimOne("worker-a", cleanSession);
      await backend.fail(cleanJob, "provider never started");

      backend.enqueue(cleanMessageId, cleanSession);
      expect(jobRow(backend.table, cleanJob.id).status).toBe("pending");
    });

    it("records a reply even when a lease renewal commits during completion", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const messageId = seedMessage(sessionId, "renewal during completion");
      backend.enqueue(messageId, sessionId);
      const job = await claimOne("worker-a", sessionId);
      await backend.markDispatched(job);

      // The heartbeat renews the lease while the delivery is still finishing; the
      // worker then completes with the lease object it captured beforehand.
      await expect(backend.renew(job)).resolves.not.toBeNull();
      await expect(
        backend.complete(job, "the agent replied", { processExited: true }),
      ).resolves.toBe(true);

      expect(jobRow(backend.table, job.id).status).toBe("succeeded");
      expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("sent");
      expect(listMessages(sessionId).at(-1)).toMatchObject({
        author: "agent",
        extraMarkdown: "the agent replied",
      });
    });

    it("records nothing for a worker whose lease was taken away", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const messageId = seedMessage(sessionId, "lease loss records nothing");
      backend.enqueue(messageId, sessionId);
      const stale = await claimOne("worker-a", sessionId);

      expireLease(backend.table, stale.id);
      const thief = await claimOne("worker-b", sessionId);
      expect(thief.attemptCount).toBe(stale.attemptCount + 1);

      await expect(
        backend.complete(stale, "reply from the old worker", { processExited: true }),
      ).resolves.toBe(false);
      await expect(
        backend.fail(stale, "failure from the old worker", { processExited: true }),
      ).resolves.toBe(false);
      await expect(backend.retry(stale, "retry from the old worker")).resolves.toBe(false);

      expect(jobRow(backend.table, stale.id)).toMatchObject({
        status: "running",
        lockedBy: "worker-b",
        lastError: null,
      });
      expect(getMessage(messageId)?.opencodeDeliveryStatus).toBe("pending");
      expect(listMessages(sessionId).every((message) => message.author === "user")).toBe(true);
    });

    it("keeps the marker set across a retry so it can never be cleared", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const messageId = seedMessage(sessionId, "marker survives a retry");
      backend.enqueue(messageId, sessionId);
      const job = await claimOne("worker-a", sessionId);
      await backend.markDispatched(job);
      const dispatchedAt = jobRow(backend.table, job.id).promptDispatchedAt;

      await expect(backend.retry(job, "spawn failed after the mark")).resolves.toBe(true);

      expect(jobRow(backend.table, job.id)).toMatchObject({
        status: "retrying",
        promptDispatchedAt: dispatchedAt,
      });
    });

    it("refuses to mark a job dispatched once another worker owns it", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const messageId = seedMessage(sessionId, "mark requires the lease");
      backend.enqueue(messageId, sessionId);
      const stale = await claimOne("worker-a", sessionId);
      expireLease(backend.table, stale.id);
      await claimOne("worker-b", sessionId);

      await expect(backend.markDispatched(stale)).resolves.toBe(false);
    });
  });
}

describe("external CLI delivery dispatch marker", () => {
  beforeEach(() => {
    drizzleDb.delete(cursorDeliveryJobs).run();
    drizzleDb.delete(claudeDeliveryJobs).run();
    drizzleDb.delete(codexDeliveryJobs).run();
    drizzleDb.delete(grokDeliveryJobs).run();
  });

  afterAll(async () => {
    await teardownApi();
  });

  describeBackend({
    label: "Cursor",
    prefix: "cur_",
    table: cursorDeliveryJobs,
    unconfirmedMessage: "Couldn't confirm this reached Cursor — check the session before retrying",
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
    complete: cursor.completeCursorDeliveryJobFromWorker,
    retry: cursor.retryCursorDeliveryJobFromWorker,
    fail: cursor.failCursorDeliveryJobFromWorker,
    renew: cursor.renewCursorDeliveryJobFromWorker,
  });

  describeBackend({
    label: "Claude",
    prefix: "cc_",
    table: claudeDeliveryJobs,
    unconfirmedMessage: "Couldn't confirm this reached Claude — check the session before retrying",
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
    complete: claude.completeClaudeDeliveryJobFromWorker,
    retry: claude.retryClaudeDeliveryJobFromWorker,
    fail: claude.failClaudeDeliveryJobFromWorker,
    renew: claude.renewClaudeDeliveryJobFromWorker,
  });

  describeBackend({
    label: "Codex",
    prefix: "cx_",
    table: codexDeliveryJobs,
    unconfirmedMessage: "Couldn't confirm this reached Codex — check the session before retrying",
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
    complete: codex.completeCodexDeliveryJobFromWorker,
    retry: codex.retryCodexDeliveryJobFromWorker,
    fail: codex.failCodexDeliveryJobFromWorker,
    renew: codex.renewCodexDeliveryJobFromWorker,
  });

  describeBackend({
    label: "Grok",
    prefix: "gr_",
    table: grokDeliveryJobs,
    unconfirmedMessage: "Couldn't confirm this reached Grok — check the session before retrying",
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
    complete: grok.completeGrokDeliveryJobFromWorker,
    retry: grok.retryGrokDeliveryJobFromWorker,
    fail: grok.failGrokDeliveryJobFromWorker,
    renew: grok.renewGrokDeliveryJobFromWorker,
  });
});
