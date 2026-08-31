import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-busy-idle-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";

const { drizzleSqlite, drizzleDb } = await import("../db/index.ts");
const { cursorDeliveryJobs } = await import("../db/drizzle-schema.ts");
const { getMessage, getMessageByClientId, insertMessageRow, listMessages } =
  await import("../messages.ts");
const { getSessionWorkStatus } = await import("./session-work-status.ts");
const { getWaitingState } = await import("../waiting-state.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { isCursorSessionBusy } = await import("../cursor/delivery.ts");
const { createMessageResult } = await import("../create-message.ts");
const { registerLiveChild, clearLiveChild, resetLiveChildrenForTests } =
  await import("./live-child.ts");
const {
  checkIdleNotification,
  checkForwardCompletionNotification,
  clearForwardCompletionNotificationWatches,
  startForwardCompletionNotificationWatch,
  startIdleNotificationWatch,
} = await import("../notifications.ts");
const { createForwardRelayWithOptionalIdleWait } = await import("../forward-relay-idle.ts");
const {
  claimCursorDeliveryJobForWorker,
  completeCursorDeliveryJobFromWorker,
  enqueueCursorDeliveryJob,
  markCursorDeliveryJobCliTurnEndedFromWorker,
  markCursorDeliveryJobDispatchedFromWorker,
} = await import("../cursor/durable-delivery.ts");

const JOB_LEASE_MS = 30_000;

// Random suffix: sibling files mint look-alike synthetic ids.
function nextSessionId(): string {
  const sessionId = `cur_${randomUUID()}`;
  setSessionCwd(sessionId, testDbDir);
  return sessionId;
}

function dispatchTypedMessage(sessionId: string, text: string) {
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
  return message;
}

async function dispatchTurn(sessionId: string, messageId: number) {
  const claimed = await claimCursorDeliveryJobForWorker(`worker-${sessionId}`, sessionId);
  expect(claimed).not.toBeNull();
  expect(await markCursorDeliveryJobDispatchedFromWorker(claimed!.job)).toBe(true);
  expect(claimed!.job.messageId).toBe(messageId);
  await registerLiveChild(sessionId, claimed!.job.id);
  return claimed!.job;
}

async function completeTurn(
  sessionId: string,
  job: Awaited<ReturnType<typeof dispatchTurn>>,
  reply: string | null,
  options?: { readonly processExited?: boolean },
) {
  clearLiveChild(sessionId, job.id);
  return completeCursorDeliveryJobFromWorker(job, reply, options);
}

/** Simulate the queue draining mid-turn while the CLI keeps working. */
function drainQueueKeepTurnOpen(jobId: number) {
  drizzleDb
    .update(cursorDeliveryJobs)
    .set({
      status: "succeeded",
      lockedAt: null,
      lockedBy: null,
      updatedAt: sqlNowOffset(-5 * JOB_LEASE_MS),
    })
    .where(eq(cursorDeliveryJobs.id, jobId))
    .run();
}

/** SQLite TEXT timestamps ("YYYY-MM-DD HH:MM:SS", UTC). */
function sqlNowOffset(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

describe("busy during the turn, one idle notice after process end", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  beforeEach(() => {
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    resetLiveChildrenForTests();
    clearForwardCompletionNotificationWatches();
    drizzleDb.delete(cursorDeliveryJobs).run();
  });

  it("typed direct message: busy at 1x and 5x lease with a drained queue (card + work status)", async () => {
    const sessionId = nextSessionId();
    const message = dispatchTypedMessage(sessionId, "please compute 3+4 silently");
    const job = await dispatchTurn(sessionId, message.id);

    drainQueueKeepTurnOpen(job.id);

    // Mid-turn progress line from the agent must not flip the card to idle.
    insertMessageRow({
      sessionId,
      text: "progress: crunching numbers",
      extraMarkdown: null,
      author: "agent",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    expect(await getSessionWorkStatus(sessionId)).toBe("pending");
    const waiting = await getWaitingState(sessionId);
    expect(waiting.state).toBe("working");
    expect(isCursorSessionBusy(sessionId)).toBe(true);

    const observerId = nextSessionId();
    insertMessageRow({
      sessionId: observerId,
      text: "watching the cursor session",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: JSON.stringify([{ id: sessionId }]),
      clientMessageId: null,
    });
    const card = listMessages(observerId)[0]?.sessions[0];
    expect(card).toMatchObject({ id: sessionId, waitingState: "working" });

    // Age the open-turn row well past JOB_LEASE_MS (but below the stale-turn
    // sweeper bound): still pending. Queue emptiness is not idle.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await getSessionWorkStatus(sessionId)).toBe("pending");
    expect((await getWaitingState(sessionId)).state).toBe("working");
  });

  it("direct: exactly one idle notice after process end, none before", async () => {
    const sessionId = nextSessionId();
    const message = dispatchTypedMessage(sessionId, "please compute 3+4");
    const job = await dispatchTurn(sessionId, message.id);

    // Watch like afterDelivery does; no notice may exist while the turn is open.
    startIdleNotificationWatch({ sessionId, triggerMessageId: message.id });
    expect(await checkIdleNotification(message.id)).toBe(false);
    expect(listMessages(sessionId).filter((m) => m.text.includes("is now idle."))).toEqual([]);

    // The worker observes the CLI process settle and posts its reply ding.
    // complete() also checks the idle watch immediately so the ding is not
    // delayed by the 5s poll. The watch stands down because that ding IS the
    // single notice — a later poll must not post a second one.
    expect(
      await completeTurn(sessionId, job, "3 plus 4 is 7", {
        processExited: true,
      }),
    ).toBe(true);
    expect(await checkIdleNotification(message.id)).toBe(false);

    const notices = listMessages(sessionId).filter((m) => m.text.includes("is now idle."));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.author).toBe("agent");
    expect(notices[0]?.extraMarkdown).toBe("3 plus 4 is 7");
    expect(getMessage(message.id)).toBeTruthy();
  });

  it("closes an abandoned earlier turn when a later turn ends", async () => {
    const sessionId = nextSessionId();
    const first = dispatchTypedMessage(sessionId, "early exit");
    const firstJob = await dispatchTurn(sessionId, first.id);
    drainQueueKeepTurnOpen(firstJob.id);
    expect(await getSessionWorkStatus(sessionId)).toBe("pending");

    const second = insertMessageRow({
      sessionId,
      text: "second turn",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueCursorDeliveryJob({
      messageId: second.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
      force: true,
    });
    const secondJob = await dispatchTurn(sessionId, second.id);

    const abandoned = drizzleDb
      .select({ endedAt: cursorDeliveryJobs.cliTurnEndedAt })
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.id, firstJob.id))
      .get();
    expect(abandoned?.endedAt).not.toBeNull();
    expect(await getSessionWorkStatus(sessionId)).toBe("pending");

    expect(await completeTurn(sessionId, secondJob, "done", { processExited: true })).toBe(true);
    expect(await getSessionWorkStatus(sessionId)).toBe("idle");
  });

  it("keeps a genuinely running turn open when a forced turn ends", async () => {
    const sessionId = nextSessionId();
    const first = dispatchTypedMessage(sessionId, "long-running turn");
    const firstJob = await dispatchTurn(sessionId, first.id);

    const forced = insertMessageRow({
      sessionId,
      text: "force this prompt",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueCursorDeliveryJob({
      messageId: forced.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
      force: true,
    });
    const forcedJob = await dispatchTurn(sessionId, forced.id);
    expect(
      await completeTurn(sessionId, forcedJob, "forced result", {
        processExited: true,
      }),
    ).toBe(true);

    const firstRow = drizzleDb
      .select({ status: cursorDeliveryJobs.status, endedAt: cursorDeliveryJobs.cliTurnEndedAt })
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.id, firstJob.id))
      .get();
    expect(firstRow).toMatchObject({ status: "running", endedAt: null });
    expect(await getSessionWorkStatus(sessionId)).toBe("pending");
  });

  it("direct: without a worker reply the watch itself posts the single idle notice", async () => {
    const sessionId = nextSessionId();
    const message = dispatchTypedMessage(sessionId, "please think quietly");
    const job = await dispatchTurn(sessionId, message.id);

    startIdleNotificationWatch({ sessionId, triggerMessageId: message.id, seenWorking: true });
    expect(await completeTurn(sessionId, job, null, { processExited: true })).toBe(true);
    // Cursor idle is process-end: complete() already posted with no extra quiet
    // window, so a later poll must not create a second notice.
    expect(await checkIdleNotification(message.id)).toBe(false);

    const notices = listMessages(sessionId).filter((m) => m.text.includes("is now idle."));
    expect(notices).toHaveLength(1);
    const marker = getMessageByClientId(sessionId, "user", `target-idle-${message.id}`);
    expect(marker?.id).toBe(notices[0]?.id);
  });

  it("relay: source stays quiet mid-turn and gets exactly one source notice after end", async () => {
    const targetSessionId = nextSessionId();
    const sourceSessionId = nextSessionId();
    const { sourceMessage, targetMessage } = createForwardRelayWithOptionalIdleWait({
      sessionId: sourceSessionId,
      targetSessionId,
      sourceText: "relayed: investigate flake",
      targetText: "investigate flake",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });

    // Relay creation queues the message; give it a cursor delivery job the
    // way the API layer would, then take it through dispatch like a worker.
    enqueueCursorDeliveryJob({
      messageId: targetMessage.id,
      messageSessionId: targetSessionId,
      cursorSessionId: targetSessionId,
      kind: "forward_target_message",
    });
    const job = await dispatchTurn(targetSessionId, targetMessage.id);
    drainQueueKeepTurnOpen(job.id);

    startForwardCompletionNotificationWatch({
      sourceMessageId: sourceMessage.id,
      sourceSessionId,
      targetMessageId: targetMessage.id,
      targetSessionId,
      seenWorking: true,
      autoPoll: false,
    });

    insertMessageRow({
      sessionId: targetSessionId,
      text: "progress: on it",
      extraMarkdown: null,
      author: "agent",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    expect(await getSessionWorkStatus(targetSessionId)).toBe("pending");
    expect(listMessages(sourceSessionId).filter((m) => m.text.includes("is now idle"))).toEqual([]);

    // The queue already drained (job terminal), so the worker's completion
    // CAS cannot hold — record the observed turn end directly instead.
    clearLiveChild(targetSessionId, job.id);
    expect(await markCursorDeliveryJobCliTurnEndedFromWorker(job)).toBe(true);
    expect(
      await checkForwardCompletionNotification(sourceMessage.id, {
        externalCliProcessExited: true,
      }),
    ).toBe(true);
    expect(await checkForwardCompletionNotification(sourceMessage.id)).toBe(false);

    const notices = listMessages(sourceSessionId).filter((m) => m.text.includes("is now idle"));
    expect(notices).toHaveLength(1);
  });

  it("stale sweeper closes legacy open turns so the session can go idle again", async () => {
    const sessionId = nextSessionId();
    const message = dispatchTypedMessage(sessionId, "legacy prompt");
    const job = await dispatchTurn(sessionId, message.id);

    // Legacy/pre-upgrade shape: dispatched, terminal, and never closed; quiet
    // far beyond the default stale bound so only the sweeper can close it.
    drizzleDb
      .update(cursorDeliveryJobs)
      .set({
        status: "succeeded",
        lockedAt: null,
        lockedBy: null,
        updatedAt: sqlNowOffset(-16 * 60_000),
      })
      .where(eq(cursorDeliveryJobs.id, job.id))
      .run();
    expect(await getSessionWorkStatus(sessionId)).toBe("pending");

    // Any claim sweep heals the row (LATE), after which idle returns.
    const swept = await claimCursorDeliveryJobForWorker(`sweeper-${sessionId}`, sessionId);
    expect(swept).toBeNull();
    const row = drizzleDb
      .select({ endedAt: cursorDeliveryJobs.cliTurnEndedAt })
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.id, job.id))
      .get();
    expect(row?.endedAt).not.toBeNull();
    expect(await getSessionWorkStatus(sessionId)).toBe("idle");
  });

  it("keeps busy and Stop on a starting ping or question while the child turn is open", async () => {
    const sessionId = nextSessionId();
    const message = dispatchTypedMessage(sessionId, "run the rounds");
    const job = await dispatchTurn(sessionId, message.id);
    drainQueueKeepTurnOpen(job.id);

    insertMessageRow({
      sessionId,
      text: "STARTING",
      extraMarkdown: null,
      author: "agent",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    insertMessageRow({
      sessionId,
      text: "Should I keep going?",
      extraMarkdown: null,
      author: "agent",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    expect(isCursorSessionBusy(sessionId)).toBe(true);
    expect(await getSessionWorkStatus(sessionId)).toBe("pending");
    expect((await getWaitingState(sessionId)).state).toBe("working");
    const observerId = nextSessionId();
    insertMessageRow({
      sessionId: observerId,
      text: "watching",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: JSON.stringify([{ id: sessionId }]),
      clientMessageId: null,
    });
    expect(listMessages(observerId)[0]?.sessions[0]).toMatchObject({
      id: sessionId,
      waitingState: "working",
    });
  });

  it("goes idle on process end; a later agent HTTP post does not reopen the turn", async () => {
    const sessionId = nextSessionId();
    const message = dispatchTypedMessage(sessionId, "sleep then nohup");
    const job = await dispatchTurn(sessionId, message.id);

    expect(await completeTurn(sessionId, job, "STARTING", { processExited: true })).toBe(true);
    expect(isCursorSessionBusy(sessionId)).toBe(false);
    expect(await getSessionWorkStatus(sessionId)).toBe("idle");
    expect((await getWaitingState(sessionId)).state).toBe("can_continue");

    const posted = await createMessageResult({
      sessionId,
      text: "DONE_AFTER_SLEEP",
      author: "agent",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
      extractInlineImages: false,
    });
    expect(posted.status).toBe(201);
    expect(isCursorSessionBusy(sessionId)).toBe(false);
    expect(await getSessionWorkStatus(sessionId)).toBe("idle");
    expect((await getWaitingState(sessionId)).state).toBe("can_continue");
  });
});
