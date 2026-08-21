import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeTestServer, createApiMiddleware, createTestSession, listen } from "./api.harness.ts";
import type { Routine } from "../src/types.ts";
import { completeSessionIdleRoutine, findSessionIdleRoutineBySourceMessageId } from "./routines.ts";
import { listMessages } from "./messages.ts";
import { drizzleDb } from "./db/index.ts";
import { routines } from "./db/drizzle-schema.ts";
import { eq } from "drizzle-orm";
import {
  setCompletionWatchAutoPollingForTest,
  stopAllCompletionWatches,
} from "./opencode/completion-watch.ts";
import { clearForwardCompletionNotificationWatches } from "./notifications.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("say API: session_idle routines (phase 2)", () => {
  beforeEach(() => {
    setCompletionWatchAutoPollingForTest(false);
    stopAllCompletionWatches();
    clearForwardCompletionNotificationWatches();
    opencodeStatusCache.clear();
  });

  afterEach(() => {
    stopAllCompletionWatches();
    clearForwardCompletionNotificationWatches();
    opencodeStatusCache.clear();
    setCompletionWatchAutoPollingForTest(true);
  });

  it("creates a session_idle routine on relay notify and lists it for A and B", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_a1a1a1a1a1a1OwnerA1Wait001";
      const targetSessionId = "ses_b1b1b1b1b1b1TargetB1Wait01";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const forward = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          text: "please handle this",
          targetSessionId,
          notifyOnCompletion: true,
        }),
      });
      expect(forward.status).toBe(201);
      const body = await json<{ message: { id: number }; targetMessage: { id: number } }>(forward);

      const routine = findSessionIdleRoutineBySourceMessageId(body.message.id);
      expect(routine).toMatchObject({
        ownerSessionId: sourceSessionId,
        status: "active",
        trigger: {
          kind: "session_idle",
          targetSessionId,
          sourceMessageId: body.message.id,
          afterWorkSeen: true,
        },
        action: { kind: "notify_owner" },
      });

      const forA = await json<{ routines: Routine[] }>(
        await fetch(`${origin}/api/routines?sessionId=${encodeURIComponent(sourceSessionId)}`),
      );
      const forB = await json<{ routines: Routine[] }>(
        await fetch(`${origin}/api/routines?sessionId=${encodeURIComponent(targetSessionId)}`),
      );
      expect(forA.routines.some((item) => item.id === routine!.id)).toBe(true);
      expect(forB.routines.some((item) => item.id === routine!.id)).toBe(true);
    } finally {
      await closeTestServer(server);
    }
  });

  it("does not create a session_idle routine when notifyOnCompletion is false", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_a2a2a2a2a2a2OwnerA2Wait002";
      const targetSessionId = "ses_b2b2b2b2b2b2TargetB2Wait02";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const forward = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          text: "no wait please",
          targetSessionId,
          notifyOnCompletion: false,
        }),
      });
      expect(forward.status).toBe(201);
      const body = await json<{ message: { id: number } }>(forward);
      expect(findSessionIdleRoutineBySourceMessageId(body.message.id)).toBeNull();
    } finally {
      await closeTestServer(server);
    }
  });

  it("attaches routineEvent when a session_idle routine completes", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_a3a3a3a3a3a3OwnerA3Wait003";
      const targetSessionId = "ses_b3b3b3b3b3b3TargetB3Wait03";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const { createSessionIdleRoutine } = await import("./routines.ts");
      const routine = createSessionIdleRoutine({
        ownerSessionId: sourceSessionId,
        title: `Wait for ${targetSessionId}`,
        trigger: {
          kind: "session_idle",
          targetSessionId,
          sourceMessageId: 42,
          afterWorkSeen: true,
        },
        action: { kind: "notify_owner" },
      });

      const notice = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          text: `<say-to-me-system>${targetSessionId} is idle now</say-to-me-system>`,
        }),
      });
      expect(notice.status).toBe(201);
      const noticeBody = await json<{ message: { id: number } }>(notice);
      const completed = completeSessionIdleRoutine({
        routineId: routine.id,
        messageId: noticeBody.message.id,
        targetSessionId,
        targetMessageId: 99,
        sourceMessageId: 42,
        reason: "idle",
      });
      expect(completed?.status).toBe("fired");
      expect(completed?.lastMessageId).toBe(noticeBody.message.id);
      const row = drizzleDb.select().from(routines).where(eq(routines.id, routine.id)).get();
      expect(row?.lastMessageId).toBe(noticeBody.message.id);
      expect(row?.action).toContain("watcher_completed");

      const listed = listMessages(sourceSessionId);
      const withEvent = listed.find((message) => message.id === noticeBody.message.id);
      expect(withEvent?.routineEvent).toMatchObject({
        kind: "watcher_completed",
        routineId: routine.id,
        sourceMessageId: 42,
        targetSessionId,
        targetMessageId: 99,
        reason: "idle",
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("delete cancels the wait so the routine is gone", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_a4a4a4a4a4a4OwnerA4Wait004";
      const targetSessionId = "ses_b4b4b4b4b4b4TargetB4Wait04";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const forward = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          text: "cancel me",
          targetSessionId,
          notifyOnCompletion: true,
        }),
      });
      const body = await json<{ message: { id: number } }>(forward);
      const routine = findSessionIdleRoutineBySourceMessageId(body.message.id)!;

      const deleted = await fetch(`${origin}/api/routines/${routine.id}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(findSessionIdleRoutineBySourceMessageId(body.message.id)).toBeNull();
    } finally {
      await closeTestServer(server);
    }
  });

  it("fan-out creates one routine per target", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_a5a5a5a5a5a5OwnerA5Wait005";
      const targetB = "ses_b5b5b5b5b5b5TargetB5Wait05";
      const targetC = "ses_c5c5c5c5c5c5TargetC5Wait05";
      await createTestSession(sourceSessionId);
      await createTestSession(targetB);
      await createTestSession(targetC);

      const first = await json<{ message: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "to B",
            targetSessionId: targetB,
            notifyOnCompletion: true,
          }),
        }),
      );
      const second = await json<{ message: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "to C",
            targetSessionId: targetC,
            notifyOnCompletion: true,
          }),
        }),
      );

      const routineB = findSessionIdleRoutineBySourceMessageId(first.message.id);
      const routineC = findSessionIdleRoutineBySourceMessageId(second.message.id);
      expect(routineB?.id).not.toEqual(routineC?.id);
      expect(routineB?.trigger).toMatchObject({ targetSessionId: targetB });
      expect(routineC?.trigger).toMatchObject({ targetSessionId: targetC });
    } finally {
      await closeTestServer(server);
    }
  });

  it("failSessionIdleForWatchedMessage terminals the routine with reason failed", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_a6a6a6a6a6a6OwnerA6Wait006";
      const targetSessionId = "ses_b6b6b6b6b6b6TargetB6Wait06";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const forward = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          text: "will fail delivery path",
          targetSessionId,
          notifyOnCompletion: true,
        }),
      });
      const body = await json<{ message: { id: number }; targetMessage: { id: number } }>(forward);
      const { failSessionIdleForWatchedMessage } = await import("./session-idle-fail.ts");
      failSessionIdleForWatchedMessage(body.targetMessage.id);
      const routine = findSessionIdleRoutineBySourceMessageId(body.message.id);
      expect(routine?.status).toBe("failed");
      expect(routine?.action).toMatchObject({
        kind: "notify_owner",
        result: { kind: "watcher_completed", reason: "failed" },
      });
    } finally {
      await closeTestServer(server);
    }
  });
});
