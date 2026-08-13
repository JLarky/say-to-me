import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { Effect, Layer } from "effect";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-notify-external-cli-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";

const { claudeDeliveryJobs } = await import("./db/drizzle-schema.ts");
const { drizzleDb, drizzleSqlite } = await import("./db/index.ts");
const { getMessage, getMessageByClientId, insertForwardMessageRow, updateOpencodeDelivery } =
  await import("./messages.ts");
const {
  checkForwardCompletionNotification,
  clearForwardCompletionNotificationWatches,
  hasForwardCompletionNotificationWatch,
  startForwardCompletionNotificationWatch,
} = await import("./notifications.ts");
const {
  ClaudeDeliveryQueueLive,
  ClaudePromptClient,
  ClaudeWorkerIdentity,
  enqueueClaudeDeliveryJob,
  runClaudeDeliveryOnce,
} = await import("./claude/durable-delivery.ts");

describe("external CLI forward completion notifications", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("starts a forward completion watch after Claude target delivery", async () => {
    clearForwardCompletionNotificationWatches();
    const sourceSessionId = "cc_5c708e22-807e-4579-807a-b56d8e4341e1";
    const targetSessionId = "cc_84475021-9f3a-4b2c-8d1e-6a7b8c9d0e1f";

    const sourceMessage = insertForwardMessageRow({
      sessionId: sourceSessionId,
      text: `<say-to-me-system>${targetSessionId} received message: please check this. You will be notified once the session is idle.</say-to-me-system>`,
      author: "user",
      status: "received",
      sessionRefs: JSON.stringify([{ id: targetSessionId }]),
      clientMessageId: null,
      forwardRole: "source",
      forwardSourceSessionId: sourceSessionId,
      forwardSourceMessageId: null,
      forwardTargetSessionId: targetSessionId,
      forwardTargetMessageId: null,
      forwardStatus: "sent",
    });
    const targetMessage = insertForwardMessageRow({
      sessionId: targetSessionId,
      text: "please check this",
      author: "user",
      status: "received",
      sessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      forwardRole: "target",
      forwardSourceSessionId: sourceSessionId,
      forwardSourceMessageId: sourceMessage.id,
      forwardTargetSessionId: targetSessionId,
      forwardTargetMessageId: null,
      forwardStatus: "queued",
      completionWatchStatus: "watching",
      completionSourceSessionId: sourceSessionId,
      completionSourceMessageId: sourceMessage.id,
    });
    updateOpencodeDelivery(targetMessage.id, "queued", null, null);
    enqueueClaudeDeliveryJob({
      messageId: targetMessage.id,
      messageSessionId: targetSessionId,
      claudeSessionId: targetSessionId,
      kind: "forward_target_message",
    });

    const prompt = Layer.succeed(ClaudePromptClient, {
      sendPrompt: (_job, msg) => Effect.succeed(`echo: ${msg.text}`),
    });
    const worker = Layer.succeed(ClaudeWorkerIdentity, { id: "test-claude-worker" });

    await Effect.runPromise(
      runClaudeDeliveryOnce(targetSessionId).pipe(
        Effect.provide(Layer.mergeAll(ClaudeDeliveryQueueLive, prompt, worker)),
      ),
    );

    expect(hasForwardCompletionNotificationWatch(sourceMessage.id)).toBe(true);
    expect(getMessage(targetMessage.id)).toMatchObject({ forwardStatus: "sent" });

    const busyMessage = insertForwardMessageRow({
      sessionId: targetSessionId,
      text: "busy placeholder",
      author: "user",
      status: "received",
      sessionRefs: null,
      clientMessageId: null,
      forwardRole: "target",
      forwardSourceSessionId: sourceSessionId,
      forwardSourceMessageId: sourceMessage.id,
      forwardTargetSessionId: targetSessionId,
      forwardTargetMessageId: null,
      forwardStatus: "sent",
    });
    const runningJob = drizzleDb
      .insert(claudeDeliveryJobs)
      .values({
        messageId: busyMessage.id,
        messageSessionId: targetSessionId,
        claudeSessionId: targetSessionId,
        kind: "direct_user_message",
        status: "running",
        nextAttemptAt: Date.now(),
      })
      .returning()
      .get();
    expect(runningJob).toBeTruthy();
    expect(await checkForwardCompletionNotification(sourceMessage.id)).toBe(false);

    drizzleDb
      .update(claudeDeliveryJobs)
      .set({ status: "succeeded" })
      .where(eq(claudeDeliveryJobs.id, runningJob!.id))
      .run();

    expect(await checkForwardCompletionNotification(sourceMessage.id)).toBe(true);

    const sourceNoticeJob = drizzleDb
      .select()
      .from(claudeDeliveryJobs)
      .where(
        and(
          eq(claudeDeliveryJobs.claudeSessionId, sourceSessionId),
          eq(claudeDeliveryJobs.kind, "direct_user_message"),
        ),
      )
      .all()
      .find((job) => job.messageId !== targetMessage.id);
    expect(sourceNoticeJob).toBeTruthy();
    expect(getMessage(sourceNoticeJob!.messageId)).toMatchObject({
      author: "user",
      forwardRole: "target",
      opencodeDeliveryStatus: "queued",
      text: expect.stringContaining(`${targetSessionId} is idle now`),
    });
  });

  it("creates a fresh parent notice after a prior idle notice was delivered", async () => {
    clearForwardCompletionNotificationWatches();
    const sourceSessionId = "cc_a1a1a1a1-1111-4111-8111-111111111111";
    const targetSessionId = "cc_b2b2b2b2-2222-4222-8222-222222222222";

    const firstSource = insertForwardMessageRow({
      sessionId: sourceSessionId,
      text: "first forward",
      author: "user",
      status: "received",
      sessionRefs: JSON.stringify([{ id: targetSessionId }]),
      clientMessageId: null,
      forwardRole: "source",
      forwardSourceSessionId: sourceSessionId,
      forwardSourceMessageId: null,
      forwardTargetSessionId: targetSessionId,
      forwardTargetMessageId: null,
      forwardStatus: "sent",
    });
    const firstTarget = insertForwardMessageRow({
      sessionId: targetSessionId,
      text: "first task",
      author: "user",
      status: "received",
      sessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      forwardRole: "target",
      forwardSourceSessionId: sourceSessionId,
      forwardSourceMessageId: firstSource.id,
      forwardTargetSessionId: targetSessionId,
      forwardTargetMessageId: null,
      forwardStatus: "sent",
      completionWatchStatus: "watching",
      completionSourceSessionId: sourceSessionId,
      completionSourceMessageId: firstSource.id,
    });
    updateOpencodeDelivery(firstTarget.id, "sent", null, null);
    startForwardCompletionNotificationWatch({
      sourceMessageId: firstSource.id,
      sourceSessionId,
      targetMessageId: firstTarget.id,
      targetSessionId,
      seenWorking: true,
    });
    expect(await checkForwardCompletionNotification(firstSource.id)).toBe(true);
    const firstNotice = getMessageByClientId(
      sourceSessionId,
      "user",
      `forward-idle-${firstSource.id}`,
    );
    expect(firstNotice).toBeTruthy();
    updateOpencodeDelivery(firstNotice!.id, "sent", null, null);

    const secondSource = insertForwardMessageRow({
      sessionId: sourceSessionId,
      text: "second forward",
      author: "user",
      status: "received",
      sessionRefs: JSON.stringify([{ id: targetSessionId }]),
      clientMessageId: null,
      forwardRole: "source",
      forwardSourceSessionId: sourceSessionId,
      forwardSourceMessageId: null,
      forwardTargetSessionId: targetSessionId,
      forwardTargetMessageId: null,
      forwardStatus: "sent",
    });
    const secondTarget = insertForwardMessageRow({
      sessionId: targetSessionId,
      text: "second task",
      author: "user",
      status: "received",
      sessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      forwardRole: "target",
      forwardSourceSessionId: sourceSessionId,
      forwardSourceMessageId: secondSource.id,
      forwardTargetSessionId: targetSessionId,
      forwardTargetMessageId: null,
      forwardStatus: "sent",
      completionWatchStatus: "watching",
      completionSourceSessionId: sourceSessionId,
      completionSourceMessageId: secondSource.id,
    });
    updateOpencodeDelivery(secondTarget.id, "sent", null, null);
    startForwardCompletionNotificationWatch({
      sourceMessageId: secondSource.id,
      sourceSessionId,
      targetMessageId: secondTarget.id,
      targetSessionId,
      seenWorking: true,
    });
    expect(await checkForwardCompletionNotification(secondSource.id)).toBe(true);

    const secondNotice = getMessageByClientId(
      sourceSessionId,
      "user",
      `forward-idle-${secondSource.id}`,
    );
    expect(secondNotice).toBeTruthy();
    expect(secondNotice!.id).not.toBe(firstNotice!.id);
    expect(secondNotice).toMatchObject({
      opencodeDeliveryStatus: "queued",
      text: expect.stringContaining("second task"),
    });
  });
});
