import { Duration, Effect } from "effect";
import { broadcastDebounceMs, opencodeStatusTimeoutMs } from "./config.ts";
import { listMessages, listSessionsReferencingSession } from "./messages.ts";
import { latestNoteFirstLine } from "./notes.ts";
import { addOpenCodeStatus as addOpenCodeStatusReal } from "./opencode/client.ts";
import { getOrganizePathForSession } from "./session-folders.ts";
import type { DbSession } from "./db/schemas.ts";
import { getSession, listSessions, touchSessionRevision } from "./sessions.ts";
import { sseSnapshotFrame, type SseClient } from "./sse/client.ts";
import { recordSseBroadcast } from "./sse/diagnostics.ts";
import { getExternalCliActivitySnapshot } from "./external-cli/activity-snapshot.ts";
import { paseoUiUrlsForSession } from "./paseo/ui.ts";

let _refreshOpenCodeStatusImpl: ((session: DbSession) => Effect.Effect<void, unknown>) | undefined;

export function _setRefreshOpenCodeStatus(
  fn: ((session: DbSession) => Effect.Effect<void, unknown>) | undefined,
): void {
  _refreshOpenCodeStatusImpl = fn;
}

let _getSessionImpl: ((id: string) => DbSession | null) | undefined;

export function _setGetSession(fn: ((id: string) => DbSession | null) | undefined): void {
  _getSessionImpl = fn;
}

export type SessionListSseOptions = {
  includeCachedStatus: boolean;
  includeJarvisOverviewDetails: boolean;
};

const clientsBySessionId = new Map<string, Set<SseClient>>();
const sessionListClients = new Map<SseClient, SessionListSseOptions>();
const agentListenersBySessionId = new Map<string, number>();
const pendingQueueBroadcasts = new Set<string>();
let sessionListBroadcastPending = false;
let sessionListBroadcastGeneration = 0;
/** @deprecated Prefer SSE diagnostics snapshot; retained for tests that import the map. */
export { broadcastCounters } from "./sse/diagnostics.ts";

export function registerQueueSseClient(sessionId: string, client: SseClient): void {
  const clients = clientsBySessionId.get(sessionId) ?? new Set<SseClient>();
  clients.add(client);
  clientsBySessionId.set(sessionId, clients);
}

export function unregisterQueueSseClient(sessionId: string, client: SseClient): void {
  const clients = clientsBySessionId.get(sessionId);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) clientsBySessionId.delete(sessionId);
}

export function queueSseClientCount(sessionId: string): number {
  return clientsBySessionId.get(sessionId)?.size ?? 0;
}

export function registerSessionListSseClient(
  client: SseClient,
  options: SessionListSseOptions,
): void {
  sessionListClients.set(client, options);
}

export function unregisterSessionListSseClient(client: SseClient): void {
  sessionListClients.delete(client);
}

/** Reset process-local SSE state between tests without letting old timers write to new clients. */
export function resetBroadcastStateForTest(): void {
  sessionListBroadcastGeneration += 1;
  sessionListBroadcastPending = false;
  sessionListClients.clear();
  pendingQueueBroadcasts.clear();
}

export function listPresence() {
  return [...agentListenersBySessionId.entries()]
    .filter(([, count]) => count > 0)
    .map(([sessionId, count]) => ({ sessionId, agentListeners: count }));
}

export async function queuePayload(sessionId = "default", { forceRefresh = false } = {}) {
  const session = getSession(sessionId);
  if (!session) {
    return {
      revision: 0,
      messages: [],
      presence: listPresence(),
      session: null,
      sessions: listSessions(),
      lastNoteFirstLine: null,
    };
  }
  const externalCliActivity = await getExternalCliActivitySnapshot(sessionId, 8);
  const paseoUiUrls = paseoUiUrlsForSession(session);
  return {
    revision: session.revision,
    messages: listMessages(sessionId),
    presence: listPresence(),
    session: {
      ...(await addOpenCodeStatusReal(session, { forceRefresh })),
      organizePath: getOrganizePathForSession(sessionId),
      ...paseoUiUrls,
    },
    sessions: listSessions(),
    lastNoteFirstLine: latestNoteFirstLine(sessionId),
    ...(externalCliActivity ? { externalCliActivity } : {}),
  };
}

export { sseSnapshotFrame };

export async function writeQueueSnapshot(client: SseClient, sessionId = "default"): Promise<void> {
  await client.write(sseSnapshotFrame(await queuePayload(sessionId)));
}

export function sessionsPayload({
  includeCachedStatus = false,
  includeJarvisOverviewDetails = false,
} = {}) {
  return {
    sessions: listSessions({ includeCachedStatus, includeJarvisOverviewDetails }),
    presence: listPresence(),
  };
}

export function writeSessionsSnapshot(
  client: SseClient,
  { includeCachedStatus = false, includeJarvisOverviewDetails = false } = {},
): void {
  void client.write(
    sseSnapshotFrame(sessionsPayload({ includeCachedStatus, includeJarvisOverviewDetails })),
  );
}

function broadcastSessionsImmediate() {
  if (sessionListClients.size === 0) return;
  for (const [client, options] of sessionListClients) {
    try {
      writeSessionsSnapshot(client, options);
    } catch (error) {
      console.warn("[session-list-sync] removing failed SSE client", {
        error: error instanceof Error ? error.message : String(error),
      });
      sessionListClients.delete(client);
    }
  }
}

// Debounced session-list broadcast as an Effect, so the delay runs on Effect's
// Clock (controllable with TestClock) instead of a raw setTimeout.
export function debouncedBroadcastSessions(): Effect.Effect<void> {
  const generation = sessionListBroadcastGeneration;
  return Effect.sleep(Duration.millis(broadcastDebounceMs)).pipe(
    Effect.zipRight(
      Effect.sync(() => {
        if (generation === sessionListBroadcastGeneration) broadcastSessionsImmediate();
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        sessionListBroadcastPending = false;
      }),
    ),
  );
}

export function broadcastSessions() {
  if (sessionListBroadcastPending) return;
  sessionListBroadcastPending = true;
  Effect.runFork(debouncedBroadcastSessions());
}

/** Effect-owned variant for use inside Effect.gen (supports TestClock). */
export function broadcastSessionsEffect(): Effect.Effect<void> {
  return Effect.sync(() => {
    if (sessionListBroadcastPending) return false;
    sessionListBroadcastPending = true;
    return true;
  }).pipe(
    Effect.flatMap((shouldBroadcast) =>
      shouldBroadcast ? debouncedBroadcastSessions() : Effect.void,
    ),
  );
}

async function broadcastQueueImmediate(sessionId = "default") {
  const clients = clientsBySessionId.get(sessionId);
  if (!clients || clients.size === 0) return;
  recordSseBroadcast(sessionId);
  for (const client of clients) {
    try {
      await writeQueueSnapshot(client, sessionId);
    } catch (error) {
      console.warn("[session-sync] removing failed SSE client", {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      clients.delete(client);
    }
  }
  if (clients.size === 0) clientsBySessionId.delete(sessionId);
}

// Debounced per-session queue broadcast as an Effect, so the delay runs on
// Effect's Clock (controllable with TestClock) instead of a raw setTimeout.
export function debouncedBroadcastQueue(sessionId = "default"): Effect.Effect<void> {
  return Effect.sleep(Duration.millis(broadcastDebounceMs)).pipe(
    Effect.zipRight(Effect.promise(() => broadcastQueueImmediate(sessionId))),
    Effect.ensuring(Effect.sync(() => pendingQueueBroadcasts.delete(sessionId))),
  );
}

// Walk the changed session plus every session that references it, bumping
// revisions and reserving each in pendingQueueBroadcasts; pushes the sessions
// that still need a debounced broadcast (those not already pending) onto `acc`.
// The `visited` set guards against reference cycles; the pending check keeps the
// reference scan to once per debounce window per session.
function collectQueueBroadcastTargets(
  sessionId: string,
  visited: Set<string>,
  acc: string[],
): void {
  if (visited.has(sessionId)) return;
  visited.add(sessionId);
  touchSessionRevision(sessionId);
  if (pendingQueueBroadcasts.has(sessionId)) return;
  pendingQueueBroadcasts.add(sessionId);
  acc.push(sessionId);
  for (const referencingSessionId of listSessionsReferencingSession(sessionId)) {
    collectQueueBroadcastTargets(referencingSessionId, visited, acc);
  }
}

// The full broadcastQueue as an Effect: fan out to referencing sessions and run
// each session's debounced broadcast on Effect's Clock. Exposed so tests can
// drive the debounce deterministically with TestClock; production calls the
// sync broadcastQueue wrapper below.
export function broadcastQueueEffect(sessionId = "default"): Effect.Effect<void> {
  return Effect.gen(function* () {
    const targets: string[] = [];
    collectQueueBroadcastTargets(sessionId, new Set<string>(), targets);
    // Refresh OpenCode status for the queue session and any referencing sessions
    // so session-list SSE (listSessions + cached status) is not stale. Await each
    // refresh before broadcastSessions so the snapshot sees a warm cache. Bound with
    // Effect.timeout (Clock) so TestClock can advance past hung OpenCode HTTP, and
    // catch so a failed lookup never blocks queue / session-list fan-out.
    yield* Effect.forEach(
      targets,
      (id) =>
        Effect.try(() => {
          const lookup = _getSessionImpl ?? getSession;
          return lookup(id);
        }).pipe(
          Effect.flatMap((session) => {
            if (!session) return Effect.void;
            const refresh =
              _refreshOpenCodeStatusImpl ??
              ((s: DbSession) =>
                Effect.promise(() => addOpenCodeStatusReal(s)).pipe(
                  Effect.catchAll(() => Effect.void),
                ));
            return refresh(session).pipe(Effect.timeout(Duration.millis(opencodeStatusTimeoutMs)));
          }),
          Effect.catchAll(() => Effect.void),
        ),
      { concurrency: "unbounded", discard: true },
    );
    yield* broadcastSessionsEffect();
    yield* Effect.forEach(targets, debouncedBroadcastQueue, {
      concurrency: "unbounded",
      discard: true,
    });
  });
}

export function broadcastQueue(sessionId = "default"): void {
  Effect.runFork(broadcastQueueEffect(sessionId));
}

export function addAgentListener(sessionId: string): void {
  agentListenersBySessionId.set(sessionId, (agentListenersBySessionId.get(sessionId) || 0) + 1);
  broadcastQueue(sessionId);
}

export function removeAgentListener(sessionId: string): void {
  const nextCount = (agentListenersBySessionId.get(sessionId) || 0) - 1;
  if (nextCount > 0) {
    agentListenersBySessionId.set(sessionId, nextCount);
  } else {
    agentListenersBySessionId.delete(sessionId);
  }
  broadcastQueue(sessionId);
}

export { ensureSseDiagnosticsLogging as ensureBroadcastCounterLogging } from "./sse/diagnostics.ts";
