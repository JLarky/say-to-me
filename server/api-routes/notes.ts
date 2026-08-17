import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Context, Effect, Layer, Schema } from "effect";
import { broadcastQueue } from "../broadcast.ts";
import { createNote, deleteNote, getNote, listNotes } from "../notes.ts";
import { normalizeSessionId } from "../session-id.ts";
import { ensureSession } from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const NoteSessionPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const NotePath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
  noteId: Schema.String.annotations({ description: "Note identifier." }),
});

const NotePayload = Schema.Unknown;

const NotesListed = Schema.Struct({
  notes: Schema.Array(Schema.Unknown),
});

const NoteResult = Schema.Struct({
  note: Schema.Unknown,
});

const NoteDeleted = Schema.Void;

const NoteRouteError = Schema.Struct({
  _tag: Schema.Literal("NoteRouteError"),
  error: Schema.String,
  status: Schema.Number,
});

type NotesListed = Schema.Schema.Type<typeof NotesListed>;
type NoteResult = Schema.Schema.Type<typeof NoteResult>;
type NoteRouteError = Schema.Schema.Type<typeof NoteRouteError>;

export type NotesService = {
  ensureSession: (sessionId: string) => Effect.Effect<void>;
  list: (sessionId: string) => Effect.Effect<unknown[]>;
  create: (sessionId: string, content: string) => Effect.Effect<unknown>;
  get: (noteId: number, sessionId: string) => Effect.Effect<unknown>;
  delete: (noteId: number, sessionId: string) => Effect.Effect<void>;
  broadcast: (sessionId: string) => Effect.Effect<void>;
};

export const Notes = Context.GenericTag<NotesService>("say-to-me/Notes");

export const NotesLive = Layer.succeed(Notes, {
  ensureSession: (sessionId) =>
    Effect.sync(() => {
      ensureSession(sessionId);
    }),
  list: (sessionId) => Effect.sync(() => listNotes(sessionId)),
  create: (sessionId, content) => Effect.sync(() => createNote(sessionId, content)),
  get: (noteId, sessionId) => Effect.sync(() => getNote(noteId, sessionId)),
  delete: (noteId, sessionId) => Effect.sync(() => deleteNote(noteId, sessionId)),
  broadcast: (sessionId) => Effect.sync(() => broadcastQueue(sessionId)),
} satisfies NotesService);

function requireSessionId(rawSessionId: string): Effect.Effect<string, NoteRouteError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "NoteRouteError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    return sessionId;
  });
}

function requireNoteId(rawNoteId: string): Effect.Effect<number, NoteRouteError> {
  return Effect.gen(function* () {
    const noteId = Number(rawNoteId);
    if (!Number.isInteger(noteId)) {
      return yield* Effect.fail({
        _tag: "NoteRouteError" as const,
        error: "Invalid note id.",
        status: 400,
      });
    }
    return noteId;
  });
}

export function listNotesEffect(
  rawSessionId: string,
): Effect.Effect<NotesListed, NoteRouteError, NotesService> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionId(rawSessionId);
    const notes = yield* Effect.flatMap(Notes, (notesService) => notesService.list(sessionId));
    return { notes };
  });
}

export function createNoteEffect(
  rawSessionId: string,
  payload: unknown,
): Effect.Effect<NoteResult, NoteRouteError, NotesService> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionId(rawSessionId);
    const content =
      payload && typeof payload === "object" && "content" in payload
        ? typeof (payload as { content?: unknown }).content === "string"
          ? (payload as { content: string }).content
          : ""
        : "";
    if (!content.trim()) {
      return yield* Effect.fail({
        _tag: "NoteRouteError" as const,
        error: "Note content cannot be empty.",
        status: 400,
      });
    }
    const notesService = yield* Notes;
    yield* notesService.ensureSession(sessionId);
    const note = yield* notesService.create(sessionId, content);
    yield* notesService.broadcast(sessionId);
    return { note };
  });
}

export function getNoteEffect(
  rawSessionId: string,
  rawNoteId: string,
): Effect.Effect<NoteResult, NoteRouteError, NotesService> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionId(rawSessionId);
    const noteId = yield* requireNoteId(rawNoteId);
    const note = yield* Effect.flatMap(Notes, (notesService) =>
      notesService.get(noteId, sessionId),
    );
    if (!note) {
      return yield* Effect.fail({
        _tag: "NoteRouteError" as const,
        error: "Note not found.",
        status: 404,
      });
    }
    return { note };
  });
}

export function deleteNoteEffect(
  rawSessionId: string,
  rawNoteId: string,
): Effect.Effect<void, NoteRouteError, NotesService> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionId(rawSessionId);
    const noteId = yield* requireNoteId(rawNoteId);
    const notesService = yield* Notes;
    yield* notesService.delete(noteId, sessionId);
    yield* notesService.broadcast(sessionId);
  });
}

export const NotesGroup = HttpApiGroup.make("notes")
  .add(
    HttpApiEndpoint.get("listNotes", "/api/sessions/:sessionId/notes")
      .setPath(NoteSessionPath)
      .annotateContext(
        openApiDocs("List session notes", "Returns all notes attached to the given session."),
      )
      .addSuccess(NotesListed)
      .addError(NoteRouteError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("createNote", "/api/sessions/:sessionId/notes")
      .setPath(NoteSessionPath)
      .setPayload(NotePayload)
      .annotateContext(
        openApiDocs(
          "Create session note",
          "Creates a new note on the session and broadcasts the notes update.",
        ),
      )
      .addSuccess(NoteResult, { status: 201 })
      .addError(NoteRouteError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.get("getNote", "/api/sessions/:sessionId/notes/:noteId")
      .setPath(NotePath)
      .annotateContext(
        openApiDocs(
          "Get a session note",
          "Fetches a single note by id when it belongs to the session.",
        ),
      )
      .addSuccess(NoteResult)
      .addError(NoteRouteError, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.del("deleteNote", "/api/sessions/:sessionId/notes/:noteId")
      .setPath(NotePath)
      .annotateContext(
        openApiDocs(
          "Delete a session note",
          "Deletes a note from the session and broadcasts the notes update.",
        ),
      )
      .addSuccess(NoteDeleted, { status: 204 })
      .addError(NoteRouteError, { status: 400 }),
  );

export const NotesApi = HttpApi.make("notes").add(NotesGroup);

export function buildNotesHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing NotesGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof NotesGroup, E, R>,
    "notes",
    (handlers) =>
      handlers
        .handle("listNotes", ({ path }) =>
          listNotesEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("createNote", ({ path, payload }) =>
          createNoteEffect(path.sessionId, payload).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("getNote", ({ path }) =>
          getNoteEffect(path.sessionId, path.noteId).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("deleteNote", ({ path }) =>
          deleteNoteEffect(path.sessionId, path.noteId).pipe(
            Effect.matchEffect({
              onFailure: publicRouteErrorResponse,
              onSuccess: () => Effect.succeed(HttpServerResponse.empty({ status: 204 })),
            }),
          ),
        ),
  );
}
