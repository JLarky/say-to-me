import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-test-relay-invariant-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";

const { teardownApi } = await import("../api.harness.ts");
const { drizzleDb } = await import("../db/index.ts");
const { claudeDeliveryJobs, codexDeliveryJobs, cursorDeliveryJobs, grokDeliveryJobs } =
  await import("../db/drizzle-schema.ts");
const {
  getMessage,
  listActiveCompletionWatches,
  listMessages,
  listWatchingMessagesBySourceMessageId,
  markCompletionWorkSeen,
  setCompletionWatchStatus,
  updateOpencodeDelivery,
} = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { createForwardRelayWithOptionalIdleWait } = await import("../forward-relay-idle.ts");
const { createMessageResult } = await import("../create-message.ts");
const {
  checkForwardCompletionNotification,
  clearForwardCompletionNotificationWatches,
  startForwardCompletionNotificationWatch,
} = await import("../notifications.ts");
const { getSessionWorkStatus } = await import("./session-work-status.ts");
const { confirmObservedDeliveriesForSession } = await import("./confirm-observed-delivery.ts");
const {
  claimCursorDeliveryJobForWorker,
  completeCursorDeliveryJobFromWorker,
  enqueueCursorDeliveryJob,
  markCursorDeliveryJobCliTurnEndedFromWorker,
  markCursorDeliveryJobDispatchedFromWorker,
} = await import("../cursor/durable-delivery.ts");
const { enqueueClaudeDeliveryJob } = await import("../claude/durable-delivery.ts");
const { enqueueCodexDeliveryJob } = await import("../codex/durable-delivery.ts");
const { enqueueGrokDeliveryJob } = await import("../grok/durable-delivery.ts");

let sessionCounter = 0;

function nextSessionId(prefix: string): string {
  sessionCounter += 1;
  const suffix = String(sessionCounter).padStart(12, "0");
  const sessionId = `${prefix}00000000-0000-4000-8000-${suffix}`;
  setSessionCwd(sessionId, testDbDir);
  return sessionId;
}

function relayToTarget(sourceSessionId: string, targetSessionId: string) {
  return createForwardRelayWithOptionalIdleWait({
    sessionId: sourceSessionId,
    targetSessionId,
    sourceText: "relayed: please investigate",
    targetText: "please investigate",
    links: null,
    sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
    targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
    clientMessageId: null,
    notifyOnCompletion: true,
  });
}

/** Deliver a relay target the way a worker does, stopping mid-turn (prompt in front of the agent). */
async function startTargetTurn(targetMessageId: number, targetSessionId: string) {
  enqueueCursorDeliveryJob({
    messageId: targetMessageId,
    messageSessionId: targetSessionId,
    cursorSessionId: targetSessionId,
    kind: "forward_target_message",
  });
  const claimed = await claimCursorDeliveryJobForWorker(
    `worker-${targetSessionId}`,
    targetSessionId,
  );
  expect(claimed).not.toBeNull();
  await markCursorDeliveryJobDispatchedFromWorker(claimed!.job);
  return claimed!.job;
}

/** What the agent does first: a progress reply, posted while its turn is still running. */
async function postProgressMessage(sessionId: string, text: string) {
  const result = await createMessageResult({
    sessionId,
    text,
    author: "agent",
    links: null,
    sessionRefs: null,
    clientMessageId: null,
    extractInlineImages: false,
  });
  expect(result.status).toBe(201);
}

function sourceIdleNotices(sourceSessionId: string) {
  return listMessages(sourceSessionId).filter((message) => message.text.includes("is now idle."));
}

describe("relay completion invariant", () => {
  beforeEach(() => {
    clearForwardCompletionNotificationWatches();
    for (const table of [
      cursorDeliveryJobs,
      claudeDeliveryJobs,
      codexDeliveryJobs,
      grokDeliveryJobs,
    ]) {
      drizzleDb.delete(table).run();
    }
  });

  afterAll(async () => {
    clearForwardCompletionNotificationWatches();
    await teardownApi();
  });

  it("a progress message mid-turn neither confirms the delivery nor ends the turn", async () => {
    const targetSessionId = nextSessionId("cur_");
    const sourceSessionId = nextSessionId("cur_");
    const { targetMessage } = relayToTarget(sourceSessionId, targetSessionId);
    const job = await startTargetTurn(targetMessage.id, targetSessionId);

    await postProgressMessage(targetSessionId, "on it, will report back");

    expect(confirmObservedDeliveriesForSession(targetSessionId)).toBe(0);
    expect(getMessage(targetMessage.id)?.opencodeDeliveryStatus).toBe("pending");
    expect(await getSessionWorkStatus(targetSessionId)).toBe("pending");
    const jobRow = drizzleDb
      .select({ status: cursorDeliveryJobs.status })
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.id, job.id))
      .get();
    expect(jobRow?.status).toBe("running");
  });

  it("does not notify the relay source until the target turn actually finishes", async () => {
    const targetSessionId = nextSessionId("cur_");
    const sourceSessionId = nextSessionId("cur_");
    const { sourceMessage, targetMessage } = relayToTarget(sourceSessionId, targetSessionId);
    const job = await startTargetTurn(targetMessage.id, targetSessionId);

    startForwardCompletionNotificationWatch({
      sourceMessageId: sourceMessage.id,
      sourceSessionId,
      targetMessageId: targetMessage.id,
      targetSessionId,
      seenWorking: true,
      autoPoll: false,
    });

    await postProgressMessage(targetSessionId, "starting now");
    expect(await checkForwardCompletionNotification(sourceMessage.id)).toBe(false);
    expect(sourceIdleNotices(sourceSessionId)).toEqual([]);

    // The worker records the real outcome: only now is the turn over.
    expect(
      await completeCursorDeliveryJobFromWorker(job, "here is the answer", {
        processExited: true,
      }),
    ).toBe(true);
    expect(getMessage(targetMessage.id)?.opencodeDeliveryStatus).toBe("sent");
    // The worker's reply is only recorded when the lease compare-and-set holds,
    // so it also proves the mid-turn confirmation never stole the job.
    expect(
      listMessages(targetSessionId).some(
        (message) => message.author === "agent" && message.extraMarkdown === "here is the answer",
      ),
    ).toBe(true);

    // Completion consumes the process-exit witness and notifies the relay
    // source in the same event-driven path. A later check cannot duplicate it.
    expect(await checkForwardCompletionNotification(sourceMessage.id)).toBe(false);
    expect(sourceIdleNotices(sourceSessionId)).toHaveLength(1);
  });

  it("does not treat a succeeded job as idle while the CLI turn is still open", async () => {
    const targetSessionId = nextSessionId("cur_");
    const sourceSessionId = nextSessionId("cur_");
    const { sourceMessage, targetMessage } = relayToTarget(sourceSessionId, targetSessionId);

    enqueueCursorDeliveryJob({
      messageId: targetMessage.id,
      messageSessionId: targetSessionId,
      cursorSessionId: targetSessionId,
      kind: "forward_target_message",
    });
    // Terminal the way a 30s lease expiry + confirm would, without process-end.
    drizzleDb
      .update(cursorDeliveryJobs)
      .set({
        status: "succeeded",
        lockedAt: null,
        lockedBy: null,
        promptDispatchedAt: Date.now(),
        cliTurnEndedAt: null,
      })
      .where(eq(cursorDeliveryJobs.messageId, targetMessage.id))
      .run();
    const job = drizzleDb
      .select()
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.messageId, targetMessage.id))
      .get();
    expect(job).toBeTruthy();
    // Enqueue marks the prompt queued; confirm is what marks it reached.
    updateOpencodeDelivery(targetMessage.id, "sent", null, null);

    startForwardCompletionNotificationWatch({
      sourceMessageId: sourceMessage.id,
      sourceSessionId,
      targetMessageId: targetMessage.id,
      targetSessionId,
      seenWorking: true,
      autoPoll: false,
    });

    expect(await getSessionWorkStatus(targetSessionId)).toBe("pending");
    expect(await checkForwardCompletionNotification(sourceMessage.id)).toBe(false);
    expect(sourceIdleNotices(sourceSessionId)).toEqual([]);

    expect(await markCursorDeliveryJobCliTurnEndedFromWorker(job!)).toBe(true);
    expect(await getSessionWorkStatus(targetSessionId)).toBe("idle");
    // A durable turn marker can recover queue state, but cannot authorize a
    // notification without the worker's process-exit witness.
    expect(await checkForwardCompletionNotification(sourceMessage.id)).toBe(false);
    expect(
      await checkForwardCompletionNotification(sourceMessage.id, {
        externalCliProcessExited: true,
      }),
    ).toBe(true);
    expect(sourceIdleNotices(sourceSessionId)).toHaveLength(1);
  });

  it("does not notify the relay source while the target prompt is still queued", async () => {
    const targetSessionId = nextSessionId("cur_");
    const sourceSessionId = nextSessionId("cur_");
    const { sourceMessage, targetMessage } = relayToTarget(sourceSessionId, targetSessionId);

    // A restart-style watch: work was seen on an earlier attempt, but this
    // prompt is still sitting in the queue.
    startForwardCompletionNotificationWatch({
      sourceMessageId: sourceMessage.id,
      sourceSessionId,
      targetMessageId: targetMessage.id,
      targetSessionId,
      seenWorking: true,
      autoPoll: false,
    });

    expect(await checkForwardCompletionNotification(sourceMessage.id)).toBe(false);
    expect(sourceIdleNotices(sourceSessionId)).toEqual([]);
    // Still undelivered: a relay row only gets a delivery status once a worker takes it.
    expect(getMessage(targetMessage.id)?.opencodeDeliveryStatus).toBeNull();
  });

  it("still lists a leftover debouncing watch so a restart can resume it", () => {
    const targetSessionId = nextSessionId("cur_");
    const sourceSessionId = nextSessionId("cur_");
    const { sourceMessage, targetMessage } = relayToTarget(sourceSessionId, targetSessionId);
    updateOpencodeDelivery(targetMessage.id, "sent", null, null);
    markCompletionWorkSeen(targetMessage.id);
    setCompletionWatchStatus(targetMessage.id, "debouncing", Date.now() + 20_000);

    expect(listActiveCompletionWatches(targetSessionId).map((row) => row.id)).toContain(
      targetMessage.id,
    );
    expect(listWatchingMessagesBySourceMessageId(sourceMessage.id).map((row) => row.id)).toContain(
      targetMessage.id,
    );
  });

  it.each([
    {
      label: "cursor",
      prefix: "cur_",
      enqueue: enqueueCursorDeliveryJob,
      field: "cursorSessionId",
    },
    { label: "claude", prefix: "cc_", enqueue: enqueueClaudeDeliveryJob, field: "claudeSessionId" },
    { label: "codex", prefix: "cx_", enqueue: enqueueCodexDeliveryJob, field: "codexSessionId" },
    { label: "grok", prefix: "gr_", enqueue: enqueueGrokDeliveryJob, field: "grokSessionId" },
  ])("reports $label work as pending while a relay is queued but unclaimed", async (backend) => {
    const sessionId = nextSessionId(backend.prefix);
    const sourceSessionId = nextSessionId(backend.prefix);
    const { targetMessage } = relayToTarget(sourceSessionId, sessionId);

    expect(await getSessionWorkStatus(sessionId)).toBe("idle");
    backend.enqueue({
      messageId: targetMessage.id,
      messageSessionId: sessionId,
      [backend.field]: sessionId,
      kind: "forward_target_message",
    } as never);
    expect(await getSessionWorkStatus(sessionId)).toBe("pending");
  });
});
