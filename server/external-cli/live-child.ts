import { type as arktype } from "arktype";
import { formatArkErrors } from "@say-to-me/runtime-validation";
import { internalApiToken } from "../claude/internal-api-token.ts";
import { postInternalJson } from "./internal-http.ts";

/**
 * In-memory live provider-child registry. Busy/Stop stays true while a spawned
 * CLI child is registered here, not while `cli_turn_ended_at` is null.
 *
 * Request-scoped and never persisted. A server restart empties the map and the
 * busy predicate falls false-late — same policy as idle.
 */
const liveChildren = new Map<string, Set<number>>();

const LiveChildBody = arktype({
  sessionId: "string",
  entry: "number",
});

const OkResponse = arktype({ ok: "boolean" });

function addEntry(sessionId: string, entry: number): void {
  let entries = liveChildren.get(sessionId);
  if (!entries) {
    entries = new Set();
    liveChildren.set(sessionId, entries);
  }
  entries.add(entry);
}

function removeEntry(sessionId: string, entry: number): void {
  const entries = liveChildren.get(sessionId);
  if (!entries) return;
  entries.delete(entry);
  if (entries.size === 0) liveChildren.delete(sessionId);
}

function announceLiveChild(action: "register" | "clear", sessionId: string, entry: number): void {
  // Isolated/production workers set this. Skip when unset so unit tests never
  // call the live instance default (`say.local`). Vitest runs worker and server
  // in one process, so the local map is already the `isBusy` witness.
  if (!process.env.SAY_TO_ME_INTERNAL_URL) return;
  if (process.env.VITEST === "true") return;
  void postInternalJson(
    `/api/internal/cli-live-child/${action}`,
    { sessionId, entry },
    OkResponse,
  ).catch((error: unknown) => {
    console.error(`[live-child] ${action} announce failed for ${sessionId}:`, error);
  });
}

export function registerLiveChild(sessionId: string, entry: number): void {
  addEntry(sessionId, entry);
  announceLiveChild("register", sessionId, entry);
}

export function clearLiveChild(sessionId: string, entry: number): void {
  removeEntry(sessionId, entry);
  announceLiveChild("clear", sessionId, entry);
}

export function hasLiveChild(sessionId: string): boolean {
  return (liveChildren.get(sessionId)?.size ?? 0) > 0;
}

/** Test-only: drop every entry so sibling cases cannot leak busy. */
export function resetLiveChildrenForTests(): void {
  liveChildren.clear();
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * Worker processes announce spawn/exit here so the API server's in-memory map
 * (the one `isBusy` reads) stays in sync when the child lives in another PID.
 */
export async function dispatchLiveChildInternalRequest(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (
    pathname !== "/api/internal/cli-live-child/register" &&
    pathname !== "/api/internal/cli-live-child/clear"
  ) {
    return null;
  }
  const token = internalApiToken();
  if (!token || request.headers.get("x-say-to-me-internal-token") !== token) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Expected JSON object body." }, { status: 400 });
  }
  const body = LiveChildBody(raw);
  if (body instanceof arktype.errors) {
    return json({ error: formatArkErrors(body) }, { status: 400 });
  }
  if (pathname.endsWith("/register")) addEntry(body.sessionId, body.entry);
  else removeEntry(body.sessionId, body.entry);
  return json({ ok: true });
}
