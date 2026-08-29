import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  closeTestServer,
  createApiMiddleware,
  createTestSession,
  listen,
  mockOpenCode,
} from "./api.harness.ts";
import type { Routine } from "../src/types.ts";
import { completeSessionIdleRoutine, findSessionIdleRoutineBySourceMessageId } from "./routines.ts";
import {
  listMessages,
  markCompletionWorkSeen,
  setCompletionWatchStatus,
  updateOpencodeDelivery,
  listActiveCompletionWatches,
} from "./messages.ts";
import { drizzleDb } from "./db/index.ts";
import { routines } from "./db/drizzle-schema.ts";
import { eq } from "drizzle-orm";
import {
  resumeCompletionWatches,
  runCompletionWatchTick,
  setCompletionWatchAutoPollingForTest,
  stopAllCompletionWatches,
} from "./opencode/completion-watch.ts";
import {
  checkForwardCompletionNotification,
  clearForwardCompletionNotificationWatches,
  startForwardCompletionNotificationWatch,
} from "./notifications.ts";
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

  it("rebinds a stuck owner→target idle wait so a later relay is not permanently blocked", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_adadadadadadOwnerA1Dup0001";
      const targetSessionId = "ses_bdbdbdbdbdbdTargetB1Dup001";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const first = await json<{ message: { id: number }; targetMessage: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "first wait",
            targetSessionId,
            notifyOnCompletion: true,
          }),
        }),
      );
      expect(findSessionIdleRoutineBySourceMessageId(first.message.id)).toMatchObject({
        status: "active",
        trigger: { targetSessionId, sourceMessageId: first.message.id },
      });

      const secondResponse = await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          text: "later wait after stuck first",
          targetSessionId,
          notifyOnCompletion: true,
        }),
      });
      expect(secondResponse.status).toBe(201);
      const second = await json<{
        message: { id: number; text: string };
        targetMessage: { id: number; completionWatchStatus: string | null };
      }>(secondResponse);

      // Still one active wait, but rebound to the later source + armed on the new target.
      expect(findSessionIdleRoutineBySourceMessageId(first.message.id)).toBeNull();
      expect(findSessionIdleRoutineBySourceMessageId(second.message.id)).toMatchObject({
        status: "active",
        trigger: { targetSessionId, sourceMessageId: second.message.id },
      });
      expect(second.targetMessage.completionWatchStatus).toBe("watching");
      expect(second.message.text).toContain("You will be notified once the session is idle");

      const forA = await json<{ routines: Routine[] }>(
        await fetch(`${origin}/api/routines?sessionId=${encodeURIComponent(sourceSessionId)}`),
      );
      const idleWaits = forA.routines.filter(
        (routine) =>
          routine.trigger.kind === "session_idle" &&
          routine.trigger.targetSessionId === targetSessionId &&
          (routine.status === "active" ||
            routine.status === "paused" ||
            routine.status === "firing"),
      );
      expect(idleWaits).toHaveLength(1);
      expect(idleWaits[0]?.trigger).toMatchObject({ sourceMessageId: second.message.id });
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
          text: "Session is now idle.",
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

  it("delete cancels the wait so later idle does not notify", async () => {
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
      const body = await json<{ message: { id: number }; targetMessage: { id: number } }>(forward);
      const routine = findSessionIdleRoutineBySourceMessageId(body.message.id)!;

      const deleted = await fetch(`${origin}/api/routines/${routine.id}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(findSessionIdleRoutineBySourceMessageId(body.message.id)).toMatchObject({
        status: "cancelled",
      });

      startForwardCompletionNotificationWatch({
        sourceMessageId: body.message.id,
        sourceSessionId,
        targetMessageId: body.targetMessage.id,
        targetSessionId,
        seenWorking: true,
        autoPoll: false,
      });
      expect(await checkForwardCompletionNotification(body.message.id)).toBe(false);

      const before = listMessages(sourceSessionId).filter(
        (message) => message.text === "Session is now idle.",
      ).length;
      setCompletionWatchStatus(body.targetMessage.id, "watching");
      await runCompletionWatchTick(body.targetMessage.id);
      expect(
        listMessages(sourceSessionId).filter((message) => message.text === "Session is now idle."),
      ).toHaveLength(before);
    } finally {
      await closeTestServer(server);
    }
  });

  it("B can delete the same wait A created", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_a7a7a7a7a7a7OwnerA7Wait007";
      const targetSessionId = "ses_b7b7b7b7b7b7TargetB7Wait07";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const forward = await json<{ message: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "visible on B",
            targetSessionId,
            notifyOnCompletion: true,
          }),
        }),
      );
      const routine = findSessionIdleRoutineBySourceMessageId(forward.message.id)!;
      const forB = await json<{ routines: Routine[] }>(
        await fetch(`${origin}/api/routines?sessionId=${encodeURIComponent(targetSessionId)}`),
      );
      expect(forB.routines.some((item) => item.id === routine.id)).toBe(true);

      const deleted = await fetch(`${origin}/api/routines/${routine.id}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(findSessionIdleRoutineBySourceMessageId(forward.message.id)).toMatchObject({
        status: "cancelled",
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("resume after stop still completes an active session_idle wait", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_a8a8a8a8a8a8OwnerA8Wait008";
    const targetSessionId = "ses_b8b8b8b8b8b8TargetB8Wait08";
    let targetStatus: "idle" | "busy" = "busy";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_resume_target" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_resume_source" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/resume-idle-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/resume-idle-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);
      const forward = await json<{ message: { id: number }; targetMessage: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "resume me",
            targetSessionId,
            notifyOnCompletion: true,
          }),
        }),
      );
      expect(findSessionIdleRoutineBySourceMessageId(forward.message.id)?.status).toBe("active");

      stopAllCompletionWatches();
      resumeCompletionWatches(targetSessionId);
      // The relay reached the target before the stop; only then may an idle
      // read stand for "the forwarded work is done".
      markCompletionWorkSeen(forward.targetMessage.id);
      updateOpencodeDelivery(forward.targetMessage.id, "sent", null, null);
      targetStatus = "idle";
      opencodeStatusCache.clear();
      await runCompletionWatchTick(forward.targetMessage.id);

      const routine = findSessionIdleRoutineBySourceMessageId(forward.message.id);
      expect(routine?.status).toBe("fired");
      expect(
        listMessages(sourceSessionId).some((message) => message.text === "Session is now idle."),
      ).toBe(true);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      await closeTestServer(server);
    }
  });

  it("resumeCompletionWatches recovers watches after failed delivery confirmation", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sourceSessionId = "ses_aa1aa1aa1aa1OwnerAaWait011";
    const targetSessionId = "ses_bb1bb1bb1bb1TargetBbWait11";
    let targetStatus: "busy" | "idle" = "busy";
    const openCode = await mockOpenCode((req, res) => {
      const respond = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond({
          [sourceSessionId]: { type: "idle" },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        return respond({ info: { id: "msg_failed_confirm_target" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        return respond({ info: { id: "msg_failed_confirm_source" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond({ id: sourceSessionId, directory: "/tmp/failed-confirm-source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond({ id: targetSessionId, directory: "/tmp/failed-confirm-target" });
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);
      const forward = await json<{ message: { id: number }; targetMessage: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "confirm failed but work seen",
            targetSessionId,
            notifyOnCompletion: true,
          }),
        }),
      );
      expect(findSessionIdleRoutineBySourceMessageId(forward.message.id)?.status).toBe("active");

      // Simulate Cursor confirmation failure after claim already marked work seen.
      markCompletionWorkSeen(forward.targetMessage.id);
      updateOpencodeDelivery(
        forward.targetMessage.id,
        "failed",
        "Couldn't confirm this reached Cursor — check the session before retrying",
        null,
      );
      stopAllCompletionWatches();
      expect(
        listActiveCompletionWatches(targetSessionId).some(
          (message) => message.id === forward.targetMessage.id,
        ),
      ).toBe(true);

      resumeCompletionWatches(targetSessionId);
      targetStatus = "idle";
      opencodeStatusCache.clear();
      await runCompletionWatchTick(forward.targetMessage.id);

      expect(findSessionIdleRoutineBySourceMessageId(forward.message.id)?.status).toBe("fired");
      expect(
        listMessages(sourceSessionId).some((message) => message.text === "Session is now idle."),
      ).toBe(true);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
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

  it("soft-cancels the routine before disarm so cancelled status is durable first", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_a9a9a9a9a9a9OwnerA9Wait009";
      const targetSessionId = "ses_b9b9b9b9b9b9TargetB9Wait09";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const forward = await json<{ message: { id: number }; targetMessage: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "cancel order",
            targetSessionId,
            notifyOnCompletion: true,
          }),
        }),
      );
      const routine = findSessionIdleRoutineBySourceMessageId(forward.message.id)!;
      expect(routine.status).toBe("active");

      const deleted = await fetch(`${origin}/api/routines/${routine.id}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);

      const cancelled = findSessionIdleRoutineBySourceMessageId(forward.message.id);
      expect(cancelled).toMatchObject({ status: "cancelled" });
      const target = listMessages(targetSessionId).find(
        (message) => message.id === forward.targetMessage.id,
      );
      expect(target?.completionWatchStatus).toBe("cancelled");
    } finally {
      await closeTestServer(server);
    }
  });

  it("hard-deletes fired session_idle waits without 409 so target UI can clear them", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_c9c9c9c9c9c9OwnerA9Wait010";
      const targetSessionId = "ses_d9d9d9d9d9d9TargetB9Wait10";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const forward = await json<{ message: { id: number }; targetMessage: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "clear fired wait",
            targetSessionId,
            notifyOnCompletion: true,
          }),
        }),
      );
      const routine = findSessionIdleRoutineBySourceMessageId(forward.message.id)!;
      expect(routine.status).toBe("active");

      const completed = completeSessionIdleRoutine({
        routineId: routine.id,
        messageId: forward.message.id,
        sourceMessageId: forward.message.id,
        targetSessionId,
        targetMessageId: forward.targetMessage.id,
        reason: "idle",
      });
      expect(completed?.status).toBe("fired");

      const deleted = await fetch(`${origin}/api/routines/${routine.id}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ ok: true });

      expect(findSessionIdleRoutineBySourceMessageId(forward.message.id)).toBeNull();
      const listed = await json<{ routines: Routine[] }>(
        await fetch(`${origin}/api/routines?sessionId=${encodeURIComponent(targetSessionId)}`),
      );
      expect(listed.routines.some((row) => row.id === routine.id)).toBe(false);
    } finally {
      await closeTestServer(server);
    }
  });

  it("hard-deletes already-cancelled session_idle waits from the target list", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const sourceSessionId = "ses_e9e9e9e9e9e9OwnerA9Wait011";
      const targetSessionId = "ses_f9f9f9f9f9f9TargetB9Wait11";
      await createTestSession(sourceSessionId);
      await createTestSession(targetSessionId);

      const forward = await json<{ message: { id: number }; targetMessage: { id: number } }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "user",
            text: "clear cancelled wait",
            targetSessionId,
            notifyOnCompletion: true,
          }),
        }),
      );
      const routine = findSessionIdleRoutineBySourceMessageId(forward.message.id)!;

      const cancel = await fetch(`${origin}/api/routines/${routine.id}`, { method: "DELETE" });
      expect(cancel.status).toBe(200);
      expect(findSessionIdleRoutineBySourceMessageId(forward.message.id)?.status).toBe("cancelled");

      const purge = await fetch(`${origin}/api/routines/${routine.id}`, { method: "DELETE" });
      expect(purge.status).toBe(200);
      expect(findSessionIdleRoutineBySourceMessageId(forward.message.id)).toBeNull();
    } finally {
      await closeTestServer(server);
    }
  });
});
