import { redirect, type LoaderFunctionArgs } from "react-router";

import { MessagesPayload, NotesPayload } from "./types.ts";
import { safeResponseJson } from "@say-to-me/runtime-validation";
import { EXTERNAL_CLI_SESSION_ID } from "./external-cli/session-patterns.ts";

// Keep in sync with server/session-id.ts.
const OPENABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EXTERNAL_CLI_ID = new RegExp(`^${EXTERNAL_CLI_SESSION_ID}$`, "i");

function isOpenableSessionId(sessionId: string): boolean {
  return sessionId === "default" || OPENABLE_ID.test(sessionId);
}

// External CLI sessions only open once cwd has been set from the homepage.
function assertExternalCliSessionReady(
  sessionId: string,
  session: { cwd?: string | null } | null,
): void {
  if (EXTERNAL_CLI_ID.test(sessionId) && !session?.cwd) {
    throw new Response("Not Found", { status: 404 });
  }
}

export async function sessionLoader({ params }: LoaderFunctionArgs) {
  const sessionId = params.sessionId ?? "default";
  if (!isOpenableSessionId(sessionId)) {
    throw redirect("/");
  }
  const response = await fetch(`/api/sessions/${sessionId}/messages`);
  if (!response.ok) {
    // Option 3: no implicit import here — this session was never created
    // through this app. Go back to the homepage and open it by id there.
    throw new Response("Not Found", { status: 404 });
  }
  const payload = await safeResponseJson(response, MessagesPayload);
  assertExternalCliSessionReady(sessionId, payload.session ?? null);
  return {
    sessionId,
    initialSession: payload.session ?? null,
    initialMessages: payload.messages ?? [],
    initialSessions: payload.sessions ?? [],
    lastNoteFirstLine: payload.lastNoteFirstLine ?? null,
    initialExternalCliActivity: payload.externalCliActivity ?? null,
  };
}

export async function notesLoader({ params }: LoaderFunctionArgs) {
  const sessionId = params.sessionId ?? "default";
  if (!isOpenableSessionId(sessionId)) {
    throw redirect("/");
  }
  const [sessionRes, notesRes] = await Promise.all([
    fetch(`/api/sessions/${sessionId}/messages`),
    fetch(`/api/sessions/${sessionId}/notes`),
  ]);
  if (!sessionRes.ok) {
    throw new Response("Not Found", { status: 404 });
  }
  const sessionPayload = await safeResponseJson(sessionRes, MessagesPayload);
  const notesPayload = await safeResponseJson(notesRes, NotesPayload);
  assertExternalCliSessionReady(sessionId, sessionPayload.session ?? null);
  return {
    sessionId,
    initialSession: sessionPayload.session ?? null,
    initialNotes: notesPayload.notes ?? [],
  };
}
