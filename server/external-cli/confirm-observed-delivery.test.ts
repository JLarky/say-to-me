import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-test-confirm-observed-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";

const { teardownApi } = await import("../api.harness.ts");
const { drizzleDb } = await import("../db/index.ts");
const { cursorDeliveryJobs, opencodeDeliveryJobs } = await import("../db/drizzle-schema.ts");
const { getMessage, insertMessageRow, updateOpencodeDelivery } = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const {
  claimCursorDeliveryJobForWorker,
  confirmCursorDeliveryFromObservedWork,
  confirmCursorDeliveriesForSessionFromObservedWork,
  enqueueCursorDeliveryJob,
  markCursorDeliveryJobDispatchedFromWorker,
  markCursorDeliveryJobUnconfirmedFromWorker,
} = await import("../cursor/durable-delivery.ts");
const { confirmObservedDeliveriesForSession } = await import("./confirm-observed-delivery.ts");
const { confirmOpenCodeDeliveryFromObservedWork } = await import("../opencode/durable-delivery.ts");
const { createMessageResult } = await import("../create-message.ts");

const UNCONFIRMED = "Couldn't confirm this reached Cursor — check the session before retrying";

function seedUser(sessionId: string, text: string) {
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
  });
}

describe("confirm delivery from observed agent work", () => {
  beforeEach(() => {
    drizzleDb.delete(cursorDeliveryJobs).run();
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("upgrades a dispatched unconfirmed delivery to sent when an agent replies later", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000001";
    const user = seedUser(sessionId, "calculate 2+2");
    enqueueCursorDeliveryJob({
      messageId: user.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    const claimed = await claimCursorDeliveryJobForWorker("worker-confirm", sessionId);
    expect(claimed).not.toBeNull();
    await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
    await markCursorDeliveryJobUnconfirmedFromWorker(claimed!.job, UNCONFIRMED);

    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("failed");

    insertMessageRow({
      sessionId,
      text: "2 plus 2 is 4",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    const jobsBefore = drizzleDb
      .select({ id: cursorDeliveryJobs.id })
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.messageId, user.id))
      .all();
    expect(jobsBefore).toHaveLength(1);

    expect(confirmCursorDeliveryFromObservedWork(user.id)).toBe(true);

    const message = getMessage(user.id);
    expect(message?.opencodeDeliveryStatus).toBe("sent");
    expect(message?.opencodeDeliveryError).toBeNull();

    const jobsAfter = drizzleDb
      .select({
        id: cursorDeliveryJobs.id,
        status: cursorDeliveryJobs.status,
        promptDispatchedAt: cursorDeliveryJobs.promptDispatchedAt,
        attemptCount: cursorDeliveryJobs.attemptCount,
      })
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.messageId, user.id))
      .all();
    expect(jobsAfter).toHaveLength(1);
    expect(jobsAfter[0]?.status).toBe("succeeded");
    expect(jobsAfter[0]?.promptDispatchedAt).not.toBeNull();
    expect(jobsAfter[0]?.attemptCount).toBe(claimed!.job.attemptCount);
  });

  it("does not confirm when the job was never dispatched", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000002";
    const user = seedUser(sessionId, "never dispatched");
    enqueueCursorDeliveryJob({
      messageId: user.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    updateOpencodeDelivery(user.id, "failed", "spawn failed before dispatch", null);
    insertMessageRow({
      sessionId,
      text: "unrelated agent chatter",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    expect(confirmCursorDeliveryFromObservedWork(user.id)).toBe(false);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("failed");
  });

  it("createMessage agent path confirms without creating another delivery job", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000003";
    const user = seedUser(sessionId, "relay target");
    enqueueCursorDeliveryJob({
      messageId: user.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "forward_target_message",
    });
    const claimed = await claimCursorDeliveryJobForWorker("worker-confirm-2", sessionId);
    await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
    await markCursorDeliveryJobUnconfirmedFromWorker(claimed!.job, UNCONFIRMED);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("failed");

    const jobCountBefore = drizzleDb
      .select({ n: sql<number>`count(*)` })
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.cursorSessionId, sessionId))
      .get()?.n;

    const result = await createMessageResult({
      sessionId,
      text: "experiment-ack",
      author: "agent",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
      extractInlineImages: false,
    });
    expect(result.status).toBe(201);
    expect(confirmObservedDeliveriesForSession(sessionId)).toBe(0); // already confirmed
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("sent");

    const jobCountAfter = drizzleDb
      .select({ n: sql<number>`count(*)` })
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.cursorSessionId, sessionId))
      .get()?.n;
    expect(jobCountAfter).toBe(jobCountBefore);
  });

  it("session scan confirms watching-style failed deliveries", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000004";
    const user = seedUser(sessionId, "scan me");
    enqueueCursorDeliveryJob({
      messageId: user.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    const claimed = await claimCursorDeliveryJobForWorker("worker-confirm-3", sessionId);
    await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
    await markCursorDeliveryJobUnconfirmedFromWorker(claimed!.job, UNCONFIRMED);
    insertMessageRow({
      sessionId,
      text: "done",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    expect(confirmCursorDeliveriesForSessionFromObservedWork(sessionId)).toBe(1);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("sent");
  });

  it("does not confirm a running job from a later agent reply", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000005";
    const user = seedUser(sessionId, "still running");
    enqueueCursorDeliveryJob({
      messageId: user.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    const claimed = await claimCursorDeliveryJobForWorker("worker-running", sessionId);
    expect(claimed).not.toBeNull();
    await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
    insertMessageRow({
      sessionId,
      text: "progress",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    expect(confirmCursorDeliveryFromObservedWork(user.id)).toBe(false);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("pending");
  });

  it("does not confirm a failed job from an unrelated later agent message", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000006";
    const first = seedUser(sessionId, "first prompt failed");
    enqueueCursorDeliveryJob({
      messageId: first.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    const claimed = await claimCursorDeliveryJobForWorker("worker-unrelated", sessionId);
    await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
    await markCursorDeliveryJobUnconfirmedFromWorker(claimed!.job, UNCONFIRMED);
    expect(getMessage(first.id)?.opencodeDeliveryStatus).toBe("failed");

    const second = seedUser(sessionId, "second prompt");
    insertMessageRow({
      sessionId,
      text: "answer for the second prompt",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    expect(confirmCursorDeliveryFromObservedWork(first.id)).toBe(false);
    expect(getMessage(first.id)?.opencodeDeliveryStatus).toBe("failed");
    expect(getMessage(second.id)?.opencodeDeliveryStatus).toBeNull();
  });

  it("does not confirm a failed job from a later idle notice or ui_only watch row", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000007";
    const user = seedUser(sessionId, "failed then watch ding");
    enqueueCursorDeliveryJob({
      messageId: user.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    const claimed = await claimCursorDeliveryJobForWorker("worker-idle-notice", sessionId);
    await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
    await markCursorDeliveryJobUnconfirmedFromWorker(claimed!.job, UNCONFIRMED);

    insertMessageRow({
      sessionId,
      text: "Session is now idle.",
      extraMarkdown: null,
      author: "agent",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    const watchRow = insertMessageRow({
      sessionId,
      text: "watch marker",
      extraMarkdown: null,
      author: "agent",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(watchRow.id, "ui_only", null, null);

    expect(confirmCursorDeliveryFromObservedWork(user.id)).toBe(false);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("failed");
  });

  it("confirms a failed job when a later agent reply is linked to this prompt", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000008";
    const user = seedUser(sessionId, "linked reply");
    enqueueCursorDeliveryJob({
      messageId: user.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    const claimed = await claimCursorDeliveryJobForWorker("worker-linked", sessionId);
    await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
    await markCursorDeliveryJobUnconfirmedFromWorker(claimed!.job, UNCONFIRMED);
    insertMessageRow({
      sessionId,
      text: "answer to this prompt",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
      parentId: user.id,
    });
    expect(confirmCursorDeliveryFromObservedWork(user.id)).toBe(true);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("sent");
  });

  it("confirms a failed job when an intervening user idle notice sits before the agent reply", async () => {
    const sessionId = "cur_00000000-0000-4000-8000-000000000009";
    const user = seedUser(sessionId, "yes, do that");
    enqueueCursorDeliveryJob({
      messageId: user.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });
    const claimed = await claimCursorDeliveryJobForWorker("worker-user-idle", sessionId);
    await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
    await markCursorDeliveryJobUnconfirmedFromWorker(claimed!.job, UNCONFIRMED);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("failed");

    const idle = insertMessageRow({
      sessionId,
      text: "Session is now idle.",
      extraMarkdown: null,
      author: "user",
      status: "played",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(idle.id, "ui_only", null, null);
    insertMessageRow({
      sessionId,
      text: "I will review pull request 53 now.",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    expect(confirmCursorDeliveryFromObservedWork(user.id)).toBe(true);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("sent");
  });
});

describe("confirm OpenCode delivery from observed agent work", () => {
  it("createMessage agent path confirms without creating another delivery job", async () => {
    const sessionId = "ses_aaaaaaaaaaaaCreateMsg00001";
    const user = seedUser(sessionId, "relay target");
    updateOpencodeDelivery(user.id, "pending", null, null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
        lastError: "OpenCode delivery lease expired after prompt dispatch.",
      })
      .run();
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("pending");

    const jobCountBefore = drizzleDb
      .select({ n: sql<number>`count(*)` })
      .from(opencodeDeliveryJobs)
      .where(eq(opencodeDeliveryJobs.opencodeSessionId, sessionId))
      .get()?.n;

    const result = await createMessageResult({
      sessionId,
      text: "experiment-ack",
      author: "agent",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
      extractInlineImages: false,
    });
    expect(result.status).toBe(201);
    expect(confirmObservedDeliveriesForSession(sessionId)).toBe(0); // already confirmed
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("sent");
    expect(confirmOpenCodeDeliveryFromObservedWork(user.id)).toBe(false);

    const jobCountAfter = drizzleDb
      .select({ n: sql<number>`count(*)` })
      .from(opencodeDeliveryJobs)
      .where(eq(opencodeDeliveryJobs.opencodeSessionId, sessionId))
      .get()?.n;
    expect(jobCountAfter).toBe(jobCountBefore);
  });

  it("confirms a failed OpenCode job when an intervening user idle notice sits before the agent reply", async () => {
    const sessionId = "ses_aaaaaaaaaaaaIdleNotice0002";
    const user = seedUser(sessionId, "yes, do that");
    updateOpencodeDelivery(
      user.id,
      "failed",
      "OpenCode delivery lease expired after prompt dispatch.",
      null,
    );
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
        lastError: "OpenCode delivery lease expired after prompt dispatch.",
      })
      .run();

    const idle = insertMessageRow({
      sessionId,
      text: "Session is now idle.",
      extraMarkdown: null,
      author: "user",
      status: "played",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(idle.id, "ui_only", null, null);
    insertMessageRow({
      sessionId,
      text: "Pending while busy is intended.",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    expect(confirmOpenCodeDeliveryFromObservedWork(user.id)).toBe(true);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("sent");
  });

  it("does not confirm when a delivered idle-continue user row sits before the agent reply", async () => {
    const sessionId = "ses_aaaaaaaaaaaaIdleContinue03";
    const user = seedUser(sessionId, "yes, do that");
    updateOpencodeDelivery(
      user.id,
      "failed",
      "OpenCode delivery lease expired after prompt dispatch.",
      null,
    );
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
        lastError: "OpenCode delivery lease expired after prompt dispatch.",
      })
      .run();

    insertMessageRow({
      sessionId,
      text: "at 12:09 ses_aaaaaaaaaaaaIdleContinue03 said: say-to-me(ses_bbbbbbbbbbbbIdleContinue04, review) is now idle.",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    insertMessageRow({
      sessionId,
      text: "I will pick up the idle continue now.",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    expect(confirmOpenCodeDeliveryFromObservedWork(user.id)).toBe(false);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("failed");
  });
});
