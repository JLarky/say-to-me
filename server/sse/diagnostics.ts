/** Stream kind labels for SSE diagnostics (no session ids). */
export type SseStreamKind =
  | "queue"
  | "session-list"
  | "notifications"
  | "agent"
  | "message-agent"
  | "opencode-activity"
  | "default-events"
  | "unknown";

export type SseKindWindowStats = {
  active: number;
  opened: number;
  closed: number;
  writes: number;
  writeFailures: number;
};

export type SseDiagnosticsSnapshot = {
  kinds: Record<string, SseKindWindowStats>;
  /** Queue broadcasts in the current window (session-aggregated, no session ids). */
  broadcasts: number;
  /** Optional per-session breakdown when verbose logging is enabled. */
  broadcastsBySession: Map<string, number>;
};

type KindState = {
  active: number;
  openedWindow: number;
  closedWindow: number;
  writesWindow: number;
  writeFailuresWindow: number;
};

const kinds = new Map<string, KindState>();
const broadcastCounters = new Map<string, number>();
let broadcastTotalWindow = 0;

let logInterval: ReturnType<typeof setInterval> | null = null;
let logImpl: (line: string) => void = (line) => console.log(line);

function ensureKind(kind: string): KindState {
  let state = kinds.get(kind);
  if (!state) {
    state = {
      active: 0,
      openedWindow: 0,
      closedWindow: 0,
      writesWindow: 0,
      writeFailuresWindow: 0,
    };
    kinds.set(kind, state);
  }
  return state;
}

export function recordSseOpen(kind: string = "unknown"): void {
  const state = ensureKind(kind);
  state.active += 1;
  state.openedWindow += 1;
}

/** Record a single close/cleanup. Callers must invoke at most once per connection. */
export function recordSseClose(kind: string = "unknown"): void {
  const state = ensureKind(kind);
  if (state.active > 0) state.active -= 1;
  state.closedWindow += 1;
}

export function recordSseWrite(kind: string = "unknown"): void {
  ensureKind(kind).writesWindow += 1;
}

export function recordSseWriteFailure(kind: string = "unknown"): void {
  ensureKind(kind).writeFailuresWindow += 1;
}

/** Count a queue broadcast fan-out for a session (session id stored only for optional verbose logs). */
export function recordSseBroadcast(sessionId: string): void {
  broadcastTotalWindow += 1;
  broadcastCounters.set(sessionId, (broadcastCounters.get(sessionId) || 0) + 1);
}

/** @deprecated Prefer recordSseBroadcast; kept for call-site clarity during migration. */
export { broadcastCounters };

export function getSseDiagnosticsSnapshot(): SseDiagnosticsSnapshot {
  const kindsOut: Record<string, SseKindWindowStats> = {};
  for (const [kind, state] of kinds) {
    kindsOut[kind] = {
      active: state.active,
      opened: state.openedWindow,
      closed: state.closedWindow,
      writes: state.writesWindow,
      writeFailures: state.writeFailuresWindow,
    };
  }
  return {
    kinds: kindsOut,
    broadcasts: broadcastTotalWindow,
    broadcastsBySession: new Map(broadcastCounters),
  };
}

export function formatSseDiagnosticsLog(
  snapshot: SseDiagnosticsSnapshot = getSseDiagnosticsSnapshot(),
  { verboseSessionBroadcasts = false }: { verboseSessionBroadcasts?: boolean } = {},
): string {
  const kindEntries = Object.entries(snapshot.kinds).sort(([a], [b]) => a.localeCompare(b));
  const activeTotal = kindEntries.reduce((sum, [, s]) => sum + s.active, 0);
  const openedTotal = kindEntries.reduce((sum, [, s]) => sum + s.opened, 0);
  const closedTotal = kindEntries.reduce((sum, [, s]) => sum + s.closed, 0);
  const writesTotal = kindEntries.reduce((sum, [, s]) => sum + s.writes, 0);
  const failTotal = kindEntries.reduce((sum, [, s]) => sum + s.writeFailures, 0);

  const lines: string[] = [
    // Keep the historical prefix for greppability in astro/dev logs.
    `[sse] broadcasts in last 5s: ${snapshot.broadcasts}`,
    `[sse] last 5s: active=${activeTotal} opened=${openedTotal} closed=${closedTotal} writes=${writesTotal} writeFail=${failTotal} broadcasts=${snapshot.broadcasts}`,
  ];

  for (const [kind, s] of kindEntries) {
    if (
      s.active === 0 &&
      s.opened === 0 &&
      s.closed === 0 &&
      s.writes === 0 &&
      s.writeFailures === 0
    ) {
      continue;
    }
    lines.push(
      `  ${kind}: active=${s.active} opened=${s.opened} closed=${s.closed} writes=${s.writes} writeFail=${s.writeFailures}`,
    );
  }

  if (verboseSessionBroadcasts && snapshot.broadcastsBySession.size > 0) {
    lines.push("[sse] broadcasts by session (verbose):");
    for (const [sid, n] of snapshot.broadcastsBySession) {
      lines.push(`  ${sid}: ${n} broadcasts (${(n / 5).toFixed(1)}/s)`);
    }
  }

  return lines.join("\n");
}

export function flushSseDiagnosticsWindow(): SseDiagnosticsSnapshot {
  const snapshot = getSseDiagnosticsSnapshot();
  for (const state of kinds.values()) {
    state.openedWindow = 0;
    state.closedWindow = 0;
    state.writesWindow = 0;
    state.writeFailuresWindow = 0;
  }
  broadcastTotalWindow = 0;
  broadcastCounters.clear();
  return snapshot;
}

export function resetSseDiagnostics(): void {
  kinds.clear();
  broadcastCounters.clear();
  broadcastTotalWindow = 0;
}

export function setSseDiagnosticsLogger(fn: ((line: string) => void) | null): void {
  logImpl = fn ?? ((line) => console.log(line));
}

export function ensureSseDiagnosticsLogging(): void {
  if (process.env.SAY_TO_ME_SSE_DIAGNOSTICS !== "1") return;
  if (logInterval) return;
  logInterval = setInterval(() => {
    const snapshot = getSseDiagnosticsSnapshot();
    const hasActivity =
      snapshot.broadcasts > 0 ||
      Object.values(snapshot.kinds).some(
        (s) => s.active > 0 || s.opened > 0 || s.closed > 0 || s.writes > 0 || s.writeFailures > 0,
      );
    if (!hasActivity) return;
    const verbose = process.env.SAY_TO_ME_SSE_DIAG_VERBOSE === "1";
    logImpl(formatSseDiagnosticsLog(snapshot, { verboseSessionBroadcasts: verbose }));
    flushSseDiagnosticsWindow();
  }, 5000);
  logInterval.unref?.();
}

/** Test helper: stop the interval so tests do not leak timers. */
export function stopSseDiagnosticsLogging(): void {
  if (logInterval) {
    clearInterval(logInterval);
    logInterval = null;
  }
}
