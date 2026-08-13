import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type TestServer,
  clearQueue,
  createApiMiddleware,
  createTestSession,
  listen,
} from "./api.harness.ts";
import { dispatchEffectApiRequest } from "./api-routes/effect-api.ts";

describe("say API: notes", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  it("registers note routes in the Effect route table", async () => {
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_8ee7f80cb8d6W0olCqXcGHNFvg/notes"),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_8ee7f80cb8d6W0olCqXcGHNFvg/notes", {
          method: "POST",
        }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_8ee7f80cb8d6W0olCqXcGHNFvg/notes/1"),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_8ee7f80cb8d6W0olCqXcGHNFvg/notes/1", {
          method: "DELETE",
        }),
      ),
    ).not.toBeNull();
  });

  it("includes lastNoteFirstLine from the latest note in messages payload", async () => {
    try {
      const sessionId = "ses_1dd864100ffes6uqv2NbJatAKt";
      await createTestSession(sessionId);

      // No notes yet — field should be null
      const empty = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((r) =>
        r.json(),
      );
      expect(empty.lastNoteFirstLine).toBeNull();

      // Save a note with multiple lines
      await fetch(`${origin}/api/sessions/${sessionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "First line of note\nSecond line" }),
      });

      const withNote = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((r) =>
        r.json(),
      );
      expect(withNote.lastNoteFirstLine).toBe("First line of note");

      // Save a newer note — should show its first line
      await fetch(`${origin}/api/sessions/${sessionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Newer note first line\nMore content" }),
      });

      const withNewerNote = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((r) =>
        r.json(),
      );
      expect(withNewerNote.lastNoteFirstLine).toBe("Newer note first line");
    } finally {
      server.close();
    }
  });

  it("deletes saved notes", async () => {
    try {
      const sessionId = "ses_1dd864100ffes6uqv2NbJatAKu";
      const created = await fetch(`${origin}/api/sessions/${sessionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "temporary note" }),
      }).then((response) => response.json());
      const listed = await fetch(`${origin}/api/sessions/${sessionId}/notes`).then((response) =>
        response.json(),
      );

      const deleted = await fetch(`${origin}/api/sessions/${sessionId}/notes/${created.note.id}`, {
        method: "DELETE",
      });
      const notes = await fetch(`${origin}/api/sessions/${sessionId}/notes`).then((response) =>
        response.json(),
      );
      const deletedNote = await fetch(
        `${origin}/api/sessions/${sessionId}/notes/${created.note.id}`,
      );

      expect(listed.notes).toEqual([created.note]);
      expect(deleted.status).toBe(204);
      expect(notes.notes).toEqual([]);
      expect(deletedNote.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
