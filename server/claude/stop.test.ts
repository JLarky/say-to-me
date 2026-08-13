import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-claude-stop-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";

const { getMessage, insertMessageRow, updateOpencodeDelivery } = await import("../messages.ts");
const { drizzleSqlite } = await import("../db/index.ts");
const { ClaudeDeliveryQueueLive, ClaudeDeliveryQueue, enqueueClaudeDeliveryJob } =
  await import("./durable-delivery.ts");
const { stopClaudeSession } = await import("./stop.ts");
const { isClaudeSessionBusy } = await import("./delivery.ts");

describe("stopClaudeSession", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("cancels active delivery jobs and marks the message failed", async () => {
    const sessionId = "cc_5c708e22-807e-4579-807a-b56d8e4341e1";
    const message = insertMessageRow({
      sessionId,
      text: "stop me",
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

    await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* ClaudeDeliveryQueue;
        const claimed = yield* queue.claimNext("stop-test-worker", sessionId);
        expect(claimed).not.toBeNull();
      }).pipe(Effect.provide(ClaudeDeliveryQueueLive)),
    );

    expect(isClaudeSessionBusy(sessionId)).toBe(true);

    const result = await stopClaudeSession(sessionId);
    expect(result).toEqual({ ok: true });
    expect(isClaudeSessionBusy(sessionId)).toBe(false);
    expect(getMessage(message.id)).toMatchObject({
      opencodeDeliveryStatus: "failed",
      opencodeDeliveryError: "Stopped by user.",
    });
  });

  it("does not mark a message failed when delivery already completed", async () => {
    const sessionId = "cc_5c708e22-807e-4579-807a-b56d8e4341e2";
    const message = insertMessageRow({
      sessionId,
      text: "already done",
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

    await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* ClaudeDeliveryQueue;
        const claimed = yield* queue.claimNext("race-test-worker", sessionId);
        expect(claimed).not.toBeNull();
        if (!claimed) return;
        yield* queue.complete(claimed, "sent");
      }).pipe(Effect.provide(ClaudeDeliveryQueueLive)),
    );
    updateOpencodeDelivery(message.id, "sent", null, null);

    expect(getMessage(message.id)).toMatchObject({ opencodeDeliveryStatus: "sent" });

    const result = await stopClaudeSession(sessionId);
    expect(result).toEqual({ ok: true });
    expect(getMessage(message.id)).toMatchObject({ opencodeDeliveryStatus: "sent" });
  });

  it("rejects non-Claude session ids", async () => {
    await expect(stopClaudeSession("ses_fb760255b2cf9xIL7RC9dFosjA_claude")).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Invalid Claude session id.",
    });
  });
});
