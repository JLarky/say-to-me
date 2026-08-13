import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-cursor-stop-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";

const { getMessage, insertMessageRow, updateOpencodeDelivery } = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { drizzleSqlite } = await import("../db/index.ts");
const { CursorDeliveryQueueLive, CursorDeliveryQueue, enqueueCursorDeliveryJob } =
  await import("./durable-delivery.ts");
const { stopCursorSession } = await import("./stop.ts");
const { isCursorSessionBusy } = await import("./delivery.ts");

describe("stopCursorSession", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("cancels active delivery jobs and marks the message failed", async () => {
    const sessionId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";
    setSessionCwd(sessionId, "/tmp/cursor-stop-test");
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
    enqueueCursorDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* CursorDeliveryQueue;
        const claimed = yield* queue.claimNext("stop-test-worker", sessionId);
        expect(claimed).not.toBeNull();
      }).pipe(Effect.provide(CursorDeliveryQueueLive)),
    );

    expect(isCursorSessionBusy(sessionId)).toBe(true);

    const result = await stopCursorSession(sessionId);
    expect(result).toEqual({ ok: true });
    expect(isCursorSessionBusy(sessionId)).toBe(false);
    expect(getMessage(message.id)).toMatchObject({
      opencodeDeliveryStatus: "failed",
      opencodeDeliveryError: "Stopped by user.",
    });
  });

  it("does not mark a message failed when delivery already completed", async () => {
    const sessionId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";
    setSessionCwd(sessionId, "/tmp/cursor-stop-race-test");
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
    enqueueCursorDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* CursorDeliveryQueue;
        const claimed = yield* queue.claimNext("race-test-worker", sessionId);
        expect(claimed).not.toBeNull();
        if (!claimed) return;
        yield* queue.complete(claimed, "sent");
      }).pipe(Effect.provide(CursorDeliveryQueueLive)),
    );
    updateOpencodeDelivery(message.id, "sent", null, null);

    expect(getMessage(message.id)).toMatchObject({ opencodeDeliveryStatus: "sent" });

    const result = await stopCursorSession(sessionId);
    expect(result).toEqual({ ok: true });
    expect(getMessage(message.id)).toMatchObject({ opencodeDeliveryStatus: "sent" });
  });

  it("rejects non-Cursor session ids", async () => {
    await expect(stopCursorSession("ses_fb760255b2cf9xIL7RC9dFosjA_cursor")).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Invalid Cursor session id.",
    });
  });
});
