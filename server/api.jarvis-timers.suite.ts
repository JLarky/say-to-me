import { describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { Cause } from "effect";
import { closeTestServer, createApiMiddleware, listen } from "./api.harness.ts";
import { drizzleDb } from "./db/index.ts";
import { jarvisTimers } from "./db/drizzle-schema.ts";
import { ensureSession } from "./sessions.ts";
import type { JarvisTimer } from "../src/types.ts";
import { publicTimerErrorFromCause } from "./api-routes/jarvis-timers.ts";

async function json<T>(response: Response): Promise<T> {
  // SAFETY: T is supplied by each call site to match the response contract
  // of the specific endpoint under test.
  return (await response.json()) as T;
}

describe("say API: Jarvis timers", () => {
  it("preserves typed timer failures and maps defects to route fallbacks", () => {
    expect(
      publicTimerErrorFromCause(
        Cause.fail({ error: "Timer not found.", status: 404 }),
        "Unable to delete timer.",
      ),
    ).toEqual({ error: "Timer not found.", status: 404 });
    expect(
      publicTimerErrorFromCause(
        Cause.die(new Error("database unavailable")),
        "Unable to create timer.",
      ),
    ).toEqual({ error: "Unable to create timer.", status: 500 });
  });

  it("creates, lists, edits, pauses, resumes, cancels, and deletes timers", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      ensureSession("ses_dc1cff73f392NurK1ifX7oHzhG");
      const dueAt = Date.now() + 60 * 60 * 1000;
      const createdResponse = await fetch(`${origin}/api/jarvis-timers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "ses_dc1cff73f392NurK1ifX7oHzhG",
          title: "Initial timer",
          message: "Initial message",
          dueAt,
          intervalMs: null,
        }),
      });
      const created = await json<{ timer: JarvisTimer }>(createdResponse);

      expect(createdResponse.status).toBe(201);
      expect(created.timer).toMatchObject({
        sessionId: "ses_dc1cff73f392NurK1ifX7oHzhG",
        title: "Initial timer",
        status: "active",
      });

      const editedResponse = await fetch(`${origin}/api/jarvis-timers/${created.timer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Edited timer",
          message: "Edited message",
          dueAt: dueAt + 60_000,
          intervalMs: 120_000,
        }),
      });
      const edited = await json<{ timer: JarvisTimer }>(editedResponse);
      expect(editedResponse.status).toBe(200);
      expect(edited.timer).toMatchObject({
        title: "Edited timer",
        message: "Edited message",
        intervalMs: 120_000,
      });

      const otherResponse = await fetch(`${origin}/api/jarvis-timers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "ses_2eb027821afbn2e0X1Y4aajE33",
          title: "Other timer",
          message: "Other message",
          dueAt,
          intervalMs: null,
        }),
      });
      const other = await json<{ timer: JarvisTimer }>(otherResponse);
      expect(otherResponse.status).toBe(201);

      const pauseResponse = await fetch(`${origin}/api/jarvis-timers/${created.timer.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      expect((await json<{ timer: JarvisTimer }>(pauseResponse)).timer.status).toBe("paused");

      const resumeResponse = await fetch(
        `${origin}/api/jarvis-timers/${created.timer.id}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resume" }),
        },
      );
      expect((await json<{ timer: JarvisTimer }>(resumeResponse)).timer.status).toBe("active");

      const listResponse = await fetch(`${origin}/api/jarvis-timers`);
      const listed = await json<{ timers: JarvisTimer[] }>(listResponse);
      expect(listed.timers.map((timer) => timer.id)).toContain(created.timer.id);
      expect(listed.timers.map((timer) => timer.id)).toContain(other.timer.id);

      const scopedListResponse = await fetch(
        `${origin}/api/jarvis-timers?sessionId=ses_dc1cff73f392NurK1ifX7oHzhG`,
      );
      const scoped = await json<{ timers: JarvisTimer[] }>(scopedListResponse);
      expect(scoped.timers.map((timer) => timer.id)).toEqual([created.timer.id]);

      const cancelResponse = await fetch(
        `${origin}/api/jarvis-timers/${created.timer.id}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        },
      );
      expect((await json<{ timer: JarvisTimer }>(cancelResponse)).timer.status).toBe("cancelled");

      const deleteResponse = await fetch(`${origin}/api/jarvis-timers/${other.timer.id}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(200);
      expect(await json<{ ok: boolean }>(deleteResponse)).toEqual({ ok: true });

      const afterDeleteResponse = await fetch(`${origin}/api/jarvis-timers`);
      const afterDelete = await json<{ timers: JarvisTimer[] }>(afterDeleteResponse);
      expect(afterDelete.timers.map((timer) => timer.id)).not.toContain(other.timer.id);
    } finally {
      await closeTestServer(server);
    }
  });

  it("rejects invalid lifecycle transitions with visible errors", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      ensureSession("ses_f848a5f4ebb6gHsa3lmORFPiJS");
      const dueAt = Date.now() + 60 * 60 * 1000;
      const createdResponse = await fetch(`${origin}/api/jarvis-timers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "ses_f848a5f4ebb6gHsa3lmORFPiJS",
          title: "Lifecycle timer",
          message: "Lifecycle message",
          dueAt,
          intervalMs: null,
        }),
      });
      const created = await json<{ timer: JarvisTimer }>(createdResponse);
      drizzleDb
        .update(jarvisTimers)
        .set({ status: "completed", lastFiredAt: Date.now() })
        .where(eq(jarvisTimers.id, created.timer.id))
        .run();

      const editCompletedResponse = await fetch(`${origin}/api/jarvis-timers/${created.timer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Should fail" }),
      });
      expect(editCompletedResponse.status).toBe(409);
      expect(await json<{ error: string; status: number }>(editCompletedResponse)).toEqual({
        error: "Cannot edit a completed timer.",
        status: 409,
      });

      const triggerCompletedResponse = await fetch(
        `${origin}/api/jarvis-timers/${created.timer.id}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trigger" }),
        },
      );
      expect(triggerCompletedResponse.status).toBe(409);
      expect(await json<{ error: string; status: number }>(triggerCompletedResponse)).toEqual({
        error: "Cannot trigger a completed timer.",
        status: 409,
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("reactivates cancelled timers when editing them with a future next fire time", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      ensureSession("ses_f34ab41278b3Ez5Ki9EJ6eb54J");
      const dueAt = Date.now() + 60 * 60 * 1000;
      const createdResponse = await fetch(`${origin}/api/jarvis-timers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "ses_f34ab41278b3Ez5Ki9EJ6eb54J",
          title: "Cancelled timer",
          message: "Original message",
          dueAt,
          intervalMs: null,
        }),
      });
      const created = await json<{ timer: JarvisTimer }>(createdResponse);
      const cancelResponse = await fetch(
        `${origin}/api/jarvis-timers/${created.timer.id}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        },
      );
      expect((await json<{ timer: JarvisTimer }>(cancelResponse)).timer.status).toBe("cancelled");

      const staleEditResponse = await fetch(`${origin}/api/jarvis-timers/${created.timer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Still cancelled", dueAt: Date.now() - 60_000 }),
      });
      expect(staleEditResponse.status).toBe(409);
      expect(await json<{ error: string; status: number }>(staleEditResponse)).toEqual({
        error: "Choose a future next fire time to reactivate this cancelled timer.",
        status: 409,
      });

      const nextFireAt = Date.now() + 2 * 60 * 60 * 1000;
      const editResponse = await fetch(`${origin}/api/jarvis-timers/${created.timer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Reactivated timer",
          message: "Updated message",
          dueAt: nextFireAt,
          intervalMs: 30 * 60 * 1000,
        }),
      });
      const edited = await json<{ timer: JarvisTimer }>(editResponse);
      expect(editResponse.status).toBe(200);
      expect(edited.timer).toMatchObject({
        title: "Reactivated timer",
        message: "Updated message",
        status: "active",
        intervalMs: 30 * 60 * 1000,
        nextFireAt,
      });
    } finally {
      await closeTestServer(server);
    }
  });
});
