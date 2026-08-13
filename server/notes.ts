import { and, desc, eq, notInArray } from "drizzle-orm";
import { sessionNotes } from "./db/drizzle-schema.ts";
import { drizzleDb } from "./db/index.ts";
import { DbNote, validateDb } from "./db/schemas.ts";

const noteSelectColumns = {
  id: sessionNotes.id,
  sessionId: sessionNotes.sessionId,
  content: sessionNotes.content,
  createdAt: sessionNotes.createdAt,
};

export function listNotes(sessionId: string): DbNote[] {
  return drizzleDb
    .select(noteSelectColumns)
    .from(sessionNotes)
    .where(eq(sessionNotes.sessionId, sessionId))
    .orderBy(desc(sessionNotes.id))
    .limit(10)
    .all()
    .map((row) => validateDb(DbNote, row, "latestNotes"));
}

export function createNote(sessionId: string, content: string): DbNote {
  const note = validateDb(
    DbNote,
    drizzleDb
      .insert(sessionNotes)
      .values({ sessionId, content })
      .returning(noteSelectColumns)
      .get(),
    "insertNote",
  );
  pruneOldNotes(sessionId);
  return note;
}

export function getNote(noteId: number, sessionId: string): DbNote | null {
  const row = drizzleDb
    .select(noteSelectColumns)
    .from(sessionNotes)
    .where(and(eq(sessionNotes.id, noteId), eq(sessionNotes.sessionId, sessionId)))
    .limit(1)
    .get();
  if (!row) return null;
  return validateDb(DbNote, row, "getNote");
}

export function deleteNote(noteId: number, sessionId: string): void {
  drizzleDb
    .delete(sessionNotes)
    .where(and(eq(sessionNotes.id, noteId), eq(sessionNotes.sessionId, sessionId)))
    .run();
}

export function latestNoteFirstLine(sessionId: string): string | null {
  const noteRow = drizzleDb
    .select(noteSelectColumns)
    .from(sessionNotes)
    .where(eq(sessionNotes.sessionId, sessionId))
    .orderBy(desc(sessionNotes.id))
    .limit(1)
    .get();
  return noteRow
    ? (validateDb(DbNote, noteRow, "latestNoteContent").content.split("\n")[0] ?? "").trim() || null
    : null;
}

function pruneOldNotes(sessionId: string): void {
  const latestNoteIds = drizzleDb
    .select({ id: sessionNotes.id })
    .from(sessionNotes)
    .where(eq(sessionNotes.sessionId, sessionId))
    .orderBy(desc(sessionNotes.id))
    .limit(10)
    .all()
    .map((note) => note.id);

  if (latestNoteIds.length === 0) return;

  drizzleDb
    .delete(sessionNotes)
    .where(and(eq(sessionNotes.sessionId, sessionId), notInArray(sessionNotes.id, latestNoteIds)))
    .run();
}
