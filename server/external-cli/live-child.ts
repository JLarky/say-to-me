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
 *
 * Production workers are another PID. `isBusy` and Stop read the API process
 * map, so register must land over INTERNAL_URL. Failed or not-yet-landed
 * register hides Stop mid-turn (false early). Failed clear is fine (false late).
 */
const liveChildren = new Map<string, Set<number>>();

const LiveChildBody = arktype({
  sessionId: "string",
  entry: "number",
});

const OkResponse = arktype({ ok: "boolean" });

const REGISTER_BACKOFF_MS = [0, 50, 100, 200, 400] as const;
const REGISTER_ATTEMPT_TIMEOUT_MS = 1_000;

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

function canAnnounce(): boolean {
  // Isolated/production workers set this. Skip when unset so unit tests never
  // call the live instance default (`say.local`). Vitest still announces when
  // INTERNAL_URL is set so isolated gates prove the worker-to-API path.
  return Boolean(process.env.SAY_TO_ME_INTERNAL_URL);
}

function registerDidNotLandError(sessionId: string, cause: Error | undefined): Error {
  const detail = cause?.message ?? "unknown error";
  return new Error(`live child register did not land for ${sessionId}: ${detail}`);
}

async function postRegisterUntilLanded(sessionId: string, entry: number): Promise<void> {
  let lastError: Error | undefined;
  for (const delayMs of REGISTER_BACKOFF_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      await Promise.race([
        postInternalJson("/api/internal/cli-live-child/register", { sessionId, entry }, OkResponse),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`register timed out after ${REGISTER_ATTEMPT_TIMEOUT_MS}ms`)),
            REGISTER_ATTEMPT_TIMEOUT_MS,
          );
        }),
      ]);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw registerDidNotLandError(sessionId, lastError);
}

/**
 * Register a spawned child on the map `isBusy` reads. When INTERNAL_URL is set,
 * this awaits and retries HTTP until the API process map has the child. It does
 * not add locally first — that would hide a failed announce in-process.
 * When INTERNAL_URL is unset, the local map is the witness (unit tests).
 */
export async function registerLiveChild(sessionId: string, entry: number): Promise<void> {
  if (!canAnnounce()) {
    addEntry(sessionId, entry);
    return;
  }
  await postRegisterUntilLanded(sessionId, entry);
}

/** Best-effort: a failed clear leaves Stop on (false late). Never throws. */
export function clearLiveChild(sessionId: string, entry: number): void {
  removeEntry(sessionId, entry);
  if (!canAnnounce()) return;
  void postInternalJson(
    "/api/internal/cli-live-child/clear",
    { sessionId, entry },
    OkResponse,
  ).catch((failure: Error) => {
    console.error(`[live-child] clear announce failed for ${sessionId}:`, failure);
  });
}

export function hasLiveChild(sessionId: string): boolean {
  return (liveChildren.get(sessionId)?.size ?? 0) > 0;
}

/** Test-only: drop every entry so sibling cases cannot leak busy. */
export function resetLiveChildrenForTests(): void {
  liveChildren.clear();
}

type SpawnedChild = {
  readonly pid?: number;
  kill: (signal?: NodeJS.Signals | number) => boolean;
};

/**
 * After spawn: register until the API map has the child. If register never
 * lands, kill the child and fail the prompt (false early is worse than failing).
 * If the child exits while register is in flight, undo a late land with clear.
 */
export function bindSpawnedLiveChild(
  sessionId: string,
  child: SpawnedChild,
  fallbackEntry: number,
  onRegisterFailed: (failure: Error) => void,
) {
  const liveEntry = child.pid ?? fallbackEntry;
  let released = false;
  const releaseLiveChild = () => {
    released = true;
    clearLiveChild(sessionId, liveEntry);
  };
  void registerLiveChild(sessionId, liveEntry).then(
    () => {
      if (released) clearLiveChild(sessionId, liveEntry);
    },
    (failure: Error) => {
      if (released) return;
      try {
        child.kill();
      } catch {
        // ignore
      }
      releaseLiveChild();
      onRegisterFailed(failure);
    },
  );
  return { liveEntry, releaseLiveChild };
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
