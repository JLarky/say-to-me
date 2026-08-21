import { describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { Cause } from "effect";
import { closeTestServer, createApiMiddleware, listen } from "./api.harness.ts";
import { drizzleDb } from "./db/index.ts";
import { routines } from "./db/drizzle-schema.ts";
import { ensureSession } from "./sessions.ts";
import type { Routine } from "../src/types.ts";
import { publicRoutineErrorFromCause } from "./api-routes/routines.ts";

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("say API: routines", () => {
  it("preserves typed routine failures and maps defects to route fallbacks", () => {
    expect(
      publicRoutineErrorFromCause(
        Cause.fail({ error: "Routine not found.", status: 404 }),
        "Unable to delete routine.",
      ),
    ).toEqual({ error: "Routine not found.", status: 404 });
    expect(
      publicRoutineErrorFromCause(
        Cause.die(new Error("database unavailable")),
        "Unable to create routine.",
      ),
    ).toEqual({ error: "Unable to create routine.", status: 500 });
  });

  it("returns 404 for removed jarvis-timers routes", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      const getResponse = await fetch(`${origin}/api/jarvis-timers`);
      expect(getResponse.status).toBe(404);
      expect(await json<{ error: string; status: number }>(getResponse)).toEqual({
        error: "Not found.",
        status: 404,
      });

      const postResponse = await fetch(`${origin}/api/jarvis-timers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(postResponse.status).toBe(404);
      expect(await json<{ error: string; status: number }>(postResponse)).toEqual({
        error: "Not found.",
        status: 404,
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("creates, lists, edits, pauses, resumes, cancels, and deletes routines", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      ensureSession("ses_dc1cff73f392NurK1ifX7oHzhG");
      const dueAt = Date.now() + 60 * 60 * 1000;
      const createdResponse = await fetch(`${origin}/api/routines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerSessionId: "ses_dc1cff73f392NurK1ifX7oHzhG",
          title: "Initial routine",
          trigger: { kind: "schedule", dueAt, intervalMs: null },
          action: {
            kind: "deliver_prompt",
            title: "Initial routine",
            message: "Initial message",
          },
        }),
      });
      const created = await json<{ routine: Routine }>(createdResponse);

      expect(createdResponse.status).toBe(201);
      expect(created.routine).toMatchObject({
        ownerSessionId: "ses_dc1cff73f392NurK1ifX7oHzhG",
        title: "Initial routine",
        status: "active",
        trigger: { kind: "schedule", dueAt, intervalMs: null, nextFireAt: dueAt },
        action: {
          kind: "deliver_prompt",
          title: "Initial routine",
          message: "Initial message",
        },
      });

      const editedDueAt = dueAt + 60_000;
      const editedResponse = await fetch(`${origin}/api/routines/${created.routine.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Edited routine",
          trigger: { kind: "schedule", dueAt: editedDueAt, intervalMs: 120_000 },
          action: {
            kind: "deliver_prompt",
            title: "Edited routine",
            message: "Edited message",
          },
        }),
      });
      const edited = await json<{ routine: Routine }>(editedResponse);
      expect(editedResponse.status).toBe(200);
      expect(edited.routine).toMatchObject({
        title: "Edited routine",
        trigger: {
          kind: "schedule",
          dueAt: editedDueAt,
          intervalMs: 120_000,
          nextFireAt: editedDueAt,
        },
        action: {
          kind: "deliver_prompt",
          title: "Edited routine",
          message: "Edited message",
        },
      });

      const otherResponse = await fetch(`${origin}/api/routines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerSessionId: "ses_2eb027821afbn2e0X1Y4aajE33",
          title: "Other routine",
          trigger: { kind: "schedule", dueAt, intervalMs: null },
          action: {
            kind: "deliver_prompt",
            title: "Other routine",
            message: "Other message",
          },
        }),
      });
      const other = await json<{ routine: Routine }>(otherResponse);
      expect(otherResponse.status).toBe(201);

      const pauseResponse = await fetch(`${origin}/api/routines/${created.routine.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      expect((await json<{ routine: Routine }>(pauseResponse)).routine.status).toBe("paused");

      const resumeResponse = await fetch(`${origin}/api/routines/${created.routine.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      expect((await json<{ routine: Routine }>(resumeResponse)).routine.status).toBe("active");

      const listResponse = await fetch(`${origin}/api/routines`);
      const listed = await json<{ routines: Routine[] }>(listResponse);
      expect(listed.routines.map((routine) => routine.id)).toContain(created.routine.id);
      expect(listed.routines.map((routine) => routine.id)).toContain(other.routine.id);

      const scopedListResponse = await fetch(
        `${origin}/api/routines?sessionId=ses_dc1cff73f392NurK1ifX7oHzhG`,
      );
      const scoped = await json<{ routines: Routine[] }>(scopedListResponse);
      expect(scoped.routines.map((routine) => routine.id)).toEqual([created.routine.id]);

      const cancelResponse = await fetch(`${origin}/api/routines/${created.routine.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      expect((await json<{ routine: Routine }>(cancelResponse)).routine.status).toBe("cancelled");

      const deleteResponse = await fetch(`${origin}/api/routines/${other.routine.id}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(200);
      expect(await json<{ ok: boolean }>(deleteResponse)).toEqual({ ok: true });

      const afterDeleteResponse = await fetch(`${origin}/api/routines`);
      const afterDelete = await json<{ routines: Routine[] }>(afterDeleteResponse);
      expect(afterDelete.routines.map((routine) => routine.id)).not.toContain(other.routine.id);
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
      const createdResponse = await fetch(`${origin}/api/routines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerSessionId: "ses_f848a5f4ebb6gHsa3lmORFPiJS",
          title: "Lifecycle routine",
          trigger: { kind: "schedule", dueAt, intervalMs: null },
          action: {
            kind: "deliver_prompt",
            title: "Lifecycle routine",
            message: "Lifecycle message",
          },
        }),
      });
      const created = await json<{ routine: Routine }>(createdResponse);
      drizzleDb
        .update(routines)
        .set({ status: "fired", lastFiredAt: Date.now() })
        .where(eq(routines.id, created.routine.id))
        .run();

      const editFiredResponse = await fetch(`${origin}/api/routines/${created.routine.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Should fail" }),
      });
      expect(editFiredResponse.status).toBe(409);
      expect(await json<{ error: string; status: number }>(editFiredResponse)).toEqual({
        error: "Cannot edit a fired routine.",
        status: 409,
      });

      const triggerFiredResponse = await fetch(
        `${origin}/api/routines/${created.routine.id}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trigger" }),
        },
      );
      expect(triggerFiredResponse.status).toBe(409);
      expect(await json<{ error: string; status: number }>(triggerFiredResponse)).toEqual({
        error: "Cannot trigger a fired routine.",
        status: 409,
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("reactivates cancelled routines when editing them with a future next fire time", async () => {
    const app = createApiMiddleware();
    const { origin, server } = await listen(app);
    try {
      ensureSession("ses_f34ab41278b3Ez5Ki9EJ6eb54J");
      const dueAt = Date.now() + 60 * 60 * 1000;
      const createdResponse = await fetch(`${origin}/api/routines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerSessionId: "ses_f34ab41278b3Ez5Ki9EJ6eb54J",
          title: "Cancelled routine",
          trigger: { kind: "schedule", dueAt, intervalMs: null },
          action: {
            kind: "deliver_prompt",
            title: "Cancelled routine",
            message: "Original message",
          },
        }),
      });
      const created = await json<{ routine: Routine }>(createdResponse);
      const cancelResponse = await fetch(`${origin}/api/routines/${created.routine.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      expect((await json<{ routine: Routine }>(cancelResponse)).routine.status).toBe("cancelled");

      const staleEditResponse = await fetch(`${origin}/api/routines/${created.routine.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Still cancelled",
          trigger: { kind: "schedule", dueAt: Date.now() - 60_000 },
        }),
      });
      expect(staleEditResponse.status).toBe(409);
      expect(await json<{ error: string; status: number }>(staleEditResponse)).toEqual({
        error: "Choose a future next fire time to reactivate this cancelled routine.",
        status: 409,
      });

      const nextFireAt = Date.now() + 2 * 60 * 60 * 1000;
      const editResponse = await fetch(`${origin}/api/routines/${created.routine.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Reactivated routine",
          trigger: { kind: "schedule", dueAt: nextFireAt, intervalMs: 30 * 60 * 1000 },
          action: {
            kind: "deliver_prompt",
            title: "Reactivated routine",
            message: "Updated message",
          },
        }),
      });
      const edited = await json<{ routine: Routine }>(editResponse);
      expect(editResponse.status).toBe(200);
      expect(edited.routine).toMatchObject({
        title: "Reactivated routine",
        status: "active",
        trigger: {
          kind: "schedule",
          dueAt: nextFireAt,
          intervalMs: 30 * 60 * 1000,
          nextFireAt,
        },
        action: {
          kind: "deliver_prompt",
          title: "Reactivated routine",
          message: "Updated message",
        },
      });
    } finally {
      await closeTestServer(server);
    }
  });
});
