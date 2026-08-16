import { and, eq, inArray } from "drizzle-orm";
import { type as arktype } from "arktype";
import { formatRemaining, formatTimerTime } from "@say-to-me/session-utils/jarvis-timer-labels";
import { resolveListDisplayName } from "../src/session-display.ts";
import { drizzleDb, drizzleSqlite } from "./db/index.ts";
import { jarvisTimers, sessions, spaceSessions } from "./db/drizzle-schema.ts";
import { validateDb } from "./db/schemas.ts";
import {
  getCachedOpenCodeActivityStatus,
  getCachedOpenCodeStatus,
  getCachedOpenCodeStatusReason,
  opencodeSessionInfoCache,
} from "./opencode/cache.ts";
import { detectSessionBackend } from "./session-id.ts";
import { peekInMemoryProviderTitle } from "./session-enrich.ts";

/** Actionable → working → idle/unknown. Stable secondary sort by activity time, then id. */
export type SpaceRosterStatusTone = "error" | "attention" | "working" | "idle" | "unknown";

export type SpaceRosterSession = {
  id: string;
  t3InstanceId?: string | null;
  paseoInstanceId?: string | null;
  title: string;
  agent: string;
  provider: string;
  model: string;
  /** Coarse badge for existing dashboard cards (Jarvis / Attached). */
  status: "Jarvis" | "Attached";
  tone: string;
  /** Pin / Jarvis / archive session state — same values as home SessionList. */
  state?: "important" | "general" | "archived" | "jarvis";
  repoId?: string;
  worktree?: string;
  worktreeId?: string;
  archived?: boolean;
  /** Roster-derived attention tone from cached/delivery facts only. */
  rosterStatus: SpaceRosterStatusTone;
  rosterStatusLabel: string;
  workspacePath: string | null;
  workspaceLabel: string | null;
  importedAt: string | null;
  latestSayMessage: string | null;
  latestSayAuthor: "agent" | "user" | null;
  latestSayAt: string | null;
  latestDeliveryStatus: string | null;
  latestDeliveryError: string | null;
  /** Preview line for collapsed row — message, delivery error, or null when nothing real. */
  latestActivityText: string | null;
  activityAt: string | null;
  cachedOpenCodeStatus: string | null;
  cachedActivityStatus: string | null;
  timerSummary: string | null;
};

const rosterStatusOrder: Record<SpaceRosterStatusTone, number> = {
  error: 0,
  attention: 1,
  working: 2,
  idle: 3,
  unknown: 4,
};

function sessionProviderLabel(session: typeof sessions.$inferSelect): string {
  const backend = detectSessionBackend(session.id);
  if (backend === "opencode") return "OpenCode";
  if (backend === "claude") return "Claude";
  if (backend === "codex") return "Codex";
  if (backend === "cursor") return "Cursor";
  if (backend === "grok") return "Grok";
  if (backend === "t3") {
    return session.t3InstanceId ? `T3 (${session.t3InstanceId})` : "T3";
  }
  if (backend === "paseo") {
    return session.paseoInstanceId ? `Paseo (${session.paseoInstanceId})` : "Paseo";
  }
  if (backend === "paseo-chat") {
    return session.paseoInstanceId ? `Paseo Chat (${session.paseoInstanceId})` : "Paseo Chat";
  }
  if (backend === "voice") return "Voice";
  if (session.opencodeSelectedModelProvider?.trim()) {
    return session.opencodeSelectedModelProvider.trim();
  }
  return "Session";
}

function previewLine(text: string | null | undefined, max = 160): string | null {
  if (!text) return null;
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3)}...`;
}

function workspaceForSession(session: typeof sessions.$inferSelect): {
  path: string | null;
  label: string | null;
} {
  const pathValue =
    session.cwd?.trim() ||
    session.opencodeDirectory?.trim() ||
    session.opencodeWorktree?.trim() ||
    null;
  if (!pathValue) return { path: null, label: null };
  const parts = pathValue.split(/[/\\]/).filter(Boolean);
  const label = parts.at(-1) || pathValue;
  return { path: pathValue, label };
}

export function deriveSpaceRosterStatus(input: {
  cachedOpenCodeStatus: string | null;
  cachedOpenCodeStatusReason?: string | null;
  cachedActivityStatus: string | null;
  latestDeliveryStatus: string | null;
  latestDeliveryError: string | null;
  latestSayAuthor?: "agent" | "user" | null;
  activityAt?: string | null;
  /** Clock snapshot from the Effect roster boundary — required, never Date.now(). */
  nowMs: number;
}): { rosterStatus: SpaceRosterStatusTone; rosterStatusLabel: string } {
  const delivery = input.latestDeliveryStatus?.toLowerCase() ?? "";
  if (delivery === "failed" || input.latestDeliveryError?.trim()) {
    return { rosterStatus: "error", rosterStatusLabel: "ERROR" };
  }
  const activity = input.cachedActivityStatus?.toLowerCase() ?? "";
  if (activity === "awaiting-input" || activity === "error") {
    return {
      rosterStatus: activity === "error" ? "error" : "attention",
      rosterStatusLabel: activity === "error" ? "ERROR" : "NEEDS INPUT",
    };
  }
  const status = input.cachedOpenCodeStatus?.toLowerCase() ?? "";
  // Prefer explicit OpenCode error over idle/working inference (stale activity).
  if (status === "error") {
    return { rosterStatus: "error", rosterStatusLabel: "ERROR" };
  }
  if (
    status === "pending" ||
    status === "retrying" ||
    activity === "busy" ||
    activity === "pending" ||
    activity === "retrying"
  ) {
    const retrying = status === "retrying" || activity === "retrying";
    if (retrying) {
      const reason = input.cachedOpenCodeStatusReason?.trim();
      return {
        // Amber attention tone — not green working (quota/retry is not healthy).
        rosterStatus: "attention",
        rosterStatusLabel: reason ? `retrying (${reason})` : "retrying",
      };
    }
    return { rosterStatus: "working", rosterStatusLabel: "WORKING" };
  }
  if (status === "idle" || activity === "idle") {
    return { rosterStatus: "idle", rosterStatusLabel: "IDLE" };
  }
  if (status === "unavailable") {
    return { rosterStatus: "unknown", rosterStatusLabel: "UNAVAILABLE" };
  }

  // Cache miss / unknown OpenCode status — infer from latest Say message context.
  // Dashboard live refresh only signals `/api/spaces` refetches; it does not warm
  // the OpenCode status cache, so Cursor/CLI (and cold OpenCode) rely on this path.
  const author = input.latestSayAuthor;
  if (!author) {
    return { rosterStatus: "unknown", rosterStatusLabel: "UNKNOWN" };
  }
  if (author === "user") {
    // Delivery already OK (failed handled above); user is waiting on the agent.
    return { rosterStatus: "working", rosterStatusLabel: "WORKING" };
  }
  const at = activityTimestampMs(input.activityAt);
  if (at <= 0) {
    return { rosterStatus: "unknown", rosterStatusLabel: "UNKNOWN" };
  }
  const recentWindowMs = 5 * 60 * 1000;
  if (input.nowMs - at < recentWindowMs) {
    return { rosterStatus: "working", rosterStatusLabel: "WORKING" };
  }
  return { rosterStatus: "idle", rosterStatusLabel: "IDLE" };
}

function activityTimestampMs(value: string | null | undefined): number {
  if (!value) return 0;
  const withZ = value.endsWith("Z") ? value : `${value}Z`;
  const parsed = Date.parse(withZ);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareSpaceRosterSessions(a: SpaceRosterSession, b: SpaceRosterSession): number {
  const byStatus = rosterStatusOrder[a.rosterStatus] - rosterStatusOrder[b.rosterStatus];
  if (byStatus !== 0) return byStatus;
  const byTime = activityTimestampMs(b.activityAt) - activityTimestampMs(a.activityAt);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

export function sortSpaceRosterSessions<T extends SpaceRosterSession>(sessions: T[]): T[] {
  return [...sessions].sort(compareSpaceRosterSessions);
}

function timerSummaryForSession(sessionId: string, now: number): string | null {
  const timer = drizzleDb
    .select()
    .from(jarvisTimers)
    .where(
      and(
        eq(jarvisTimers.sessionId, sessionId),
        inArray(jarvisTimers.status, ["active", "firing", "paused"]),
      ),
    )
    .orderBy(jarvisTimers.nextFireAt)
    .limit(1)
    .get();
  if (!timer) return null;
  return formatTimerRow(timer, now);
}

function formatTimerRow(
  timer: {
    title: string;
    status: string;
    nextFireAt: number;
  },
  now: number,
): string {
  if (timer.status === "firing") return `${timer.title} · firing now`;
  if (timer.status === "paused") {
    return `${timer.title} · paused · next ${formatTimerTime(timer.nextFireAt)}`;
  }
  const remaining = timer.nextFireAt - now;
  if (remaining <= 0) return `${timer.title} · due now`;
  return `${timer.title} · in ${formatRemaining(remaining)}`;
}

/** One batched timer query for the attached session set (active/firing/paused only). */
export function loadTimerSummariesBatch(
  sessionIds: string[],
  now: number,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const id of sessionIds) map.set(id, null);
  if (sessionIds.length === 0) return map;

  const rows = drizzleDb
    .select({
      sessionId: jarvisTimers.sessionId,
      title: jarvisTimers.title,
      status: jarvisTimers.status,
      nextFireAt: jarvisTimers.nextFireAt,
    })
    .from(jarvisTimers)
    .where(
      and(
        inArray(jarvisTimers.sessionId, sessionIds),
        inArray(jarvisTimers.status, ["active", "firing", "paused"]),
      ),
    )
    .orderBy(jarvisTimers.nextFireAt)
    .all();

  for (const row of rows) {
    if (map.get(row.sessionId) != null) continue;
    map.set(row.sessionId, formatTimerRow(row, now));
  }
  return map;
}

type LatestMessageFacts = {
  text: string | null;
  author: "agent" | "user" | null;
  createdAt: string | null;
  deliveryStatus: string | null;
  deliveryError: string | null;
};

/** Newest N message candidates scanned per session when resolving roster latest. */
export const ROSTER_MESSAGE_CANDIDATES_PER_SESSION = 40;

const RosterMessageCandidate = arktype({
  sessionId: "string",
  text: "string",
  author: "string",
  createdAt: "string",
  "deliveryStatus?": "string | null",
  "deliveryError?": "string | null",
  rn: "number",
});

/**
 * Internal/UI-only notices must not replace meaningful Say activity on the roster.
 * Matches jarvis-status idle-system semantics plus `ui_only` delivery (completion watches).
 */
export function isInternalRosterNotice(
  text: string,
  deliveryStatus: string | null | undefined,
): boolean {
  if (deliveryStatus === "ui_only") return true;
  return /^<say-to-me-system>[^<]+ is idle now(?: after [^<]+)?<\/say-to-me-system>$/.test(
    text.trim(),
  );
}

export function pickLatestMeaningfulMessageFacts(
  rows: Array<{
    text: string;
    author: string;
    createdAt: string;
    deliveryStatus: string | null;
    deliveryError: string | null;
  }>,
): LatestMessageFacts {
  for (const row of rows) {
    if (isInternalRosterNotice(row.text, row.deliveryStatus)) continue;
    return {
      text: row.text,
      author: (row.author as "agent" | "user" | null) ?? null,
      createdAt: row.createdAt,
      deliveryStatus: row.deliveryStatus,
      deliveryError: row.deliveryError,
    };
  }
  return {
    text: null,
    author: null,
    createdAt: null,
    deliveryStatus: null,
    deliveryError: null,
  };
}

/**
 * Batch-friendly load of latest *meaningful* message facts for many sessions.
 * Skips ui_only / idle system notices so they do not hide real agent/user replies.
 *
 * Bounded: at most `candidatesPerSession` newest rows per session via SQL window
 * (default {@link ROSTER_MESSAGE_CANDIDATES_PER_SESSION}), not the full messages table.
 */
export function loadLatestMessageFactsBatch(
  sessionIds: string[],
  options: { candidatesPerSession?: number } = {},
): Map<string, LatestMessageFacts> {
  const map = new Map<string, LatestMessageFacts>();
  if (sessionIds.length === 0) return map;

  const empty: LatestMessageFacts = {
    text: null,
    author: null,
    createdAt: null,
    deliveryStatus: null,
    deliveryError: null,
  };
  for (const id of sessionIds) map.set(id, empty);

  const candidatesPerSession = Math.max(
    1,
    options.candidatesPerSession ?? ROSTER_MESSAGE_CANDIDATES_PER_SESSION,
  );
  const placeholders = sessionIds.map(() => "?").join(", ");
  const rawRows = drizzleSqlite
    .prepare(
      `WITH ranked AS (
         SELECT
           session_id AS sessionId,
           text,
           author,
           created_at AS createdAt,
           opencode_delivery_status AS deliveryStatus,
           opencode_delivery_error AS deliveryError,
           ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY id DESC) AS rn
         FROM messages
         WHERE session_id IN (${placeholders})
       )
       SELECT sessionId, text, author, createdAt, deliveryStatus, deliveryError, rn
       FROM ranked
       WHERE rn <= ?
       ORDER BY sessionId ASC, rn ASC`,
    )
    .all(...sessionIds, candidatesPerSession);

  const remaining = new Set(sessionIds);
  for (const raw of rawRows) {
    const row = validateDb(RosterMessageCandidate, raw, "roster message candidate");
    if (!remaining.has(row.sessionId)) continue;
    if (isInternalRosterNotice(row.text, row.deliveryStatus ?? null)) continue;
    map.set(row.sessionId, {
      text: row.text,
      author: (row.author as "agent" | "user" | null) ?? null,
      createdAt: row.createdAt,
      deliveryStatus: row.deliveryStatus ?? null,
      deliveryError: row.deliveryError ?? null,
    });
    remaining.delete(row.sessionId);
    if (remaining.size === 0) break;
  }
  return map;
}

/** Test/helper: count candidate rows the bounded window would return. */
export function countRosterMessageCandidates(
  sessionIds: string[],
  candidatesPerSession = ROSTER_MESSAGE_CANDIDATES_PER_SESSION,
): number {
  if (sessionIds.length === 0) return 0;
  const placeholders = sessionIds.map(() => "?").join(", ");
  const row = drizzleSqlite
    .prepare(
      `WITH ranked AS (
         SELECT session_id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY id DESC) AS rn
         FROM messages
         WHERE session_id IN (${placeholders})
       )
       SELECT COUNT(*) AS count FROM ranked WHERE rn <= ?`,
    )
    .get(...sessionIds, candidatesPerSession) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function buildSpaceRosterSession(
  session: typeof sessions.$inferSelect,
  options: {
    importedAt?: string | null;
    context?: { repoId: string; worktree: string; worktreeId: string };
    latest?: LatestMessageFacts;
    /** When set (including null), skips per-session timer SQL. */
    timerSummary?: string | null;
    /** Clock snapshot from the Effect roster boundary. */
    now: number;
  },
): SpaceRosterSession {
  // Durable DB fields + OpenCode in-memory Map only — never SessionTitle disk readers.
  const cachedInfo = opencodeSessionInfoCache.get(session.id);
  const cachedTitle = peekInMemoryProviderTitle(session.id);
  const title = resolveListDisplayName({
    id: session.id,
    alias: session.alias,
    opencodeTitle: cachedTitle ?? session.opencodeProjectName,
    cwd: session.cwd,
  });
  const backendProvider = sessionProviderLabel(session);
  const model =
    cachedInfo?.model?.trim() ||
    session.opencodeSelectedModel?.trim() ||
    (session.state === "jarvis" ? "Jarvis session" : title);
  const isJarvis = session.state === "jarvis";
  const workspace = workspaceForSession(session);
  const latest = options.latest ?? {
    text: null,
    author: null,
    createdAt: null,
    deliveryStatus: null,
    deliveryError: null,
  };
  const cachedOpenCodeStatus = getCachedOpenCodeStatus(session.id);
  const cachedOpenCodeStatusReason = getCachedOpenCodeStatusReason(session.id);
  const cachedActivityStatus = getCachedOpenCodeActivityStatus(session.id);
  const activityAt = latest.createdAt || session.updatedAt || session.createdAt || null;
  const derived = deriveSpaceRosterStatus({
    cachedOpenCodeStatus,
    cachedOpenCodeStatusReason,
    cachedActivityStatus,
    latestDeliveryStatus: latest.deliveryStatus,
    latestDeliveryError: latest.deliveryError,
    latestSayAuthor: latest.author,
    activityAt,
    nowMs: options.now,
  });
  const latestSayMessage = previewLine(latest.text);
  const latestActivityText =
    previewLine(latest.deliveryError) ||
    latestSayMessage ||
    (latest.deliveryStatus === "failed" ? "Latest Say delivery failed" : null);

  const instanceIds: Pick<SpaceRosterSession, "id" | "t3InstanceId" | "paseoInstanceId"> = {
    id: session.id,
  };
  if (session.t3InstanceId) instanceIds.t3InstanceId = session.t3InstanceId;
  if (session.paseoInstanceId) instanceIds.paseoInstanceId = session.paseoInstanceId;
  const context: Pick<SpaceRosterSession, "repoId" | "worktree" | "worktreeId"> = {};
  if (options.context) {
    context.repoId = options.context.repoId;
    context.worktree = options.context.worktree;
    context.worktreeId = options.context.worktreeId;
  }

  return {
    ...instanceIds,
    title,
    agent: isJarvis ? "Jarvis" : cachedInfo?.agent?.trim() || backendProvider,
    provider: backendProvider,
    model,
    status: isJarvis ? "Jarvis" : "Attached",
    tone: isJarvis ? "lime" : "blue",
    state:
      session.state === "important" ||
      session.state === "general" ||
      session.state === "archived" ||
      session.state === "jarvis"
        ? session.state
        : undefined,
    ...context,
    archived: session.state === "archived",
    rosterStatus: derived.rosterStatus,
    rosterStatusLabel: derived.rosterStatusLabel,
    workspacePath: workspace.path,
    workspaceLabel: workspace.label,
    importedAt: options.importedAt ?? null,
    latestSayMessage,
    latestSayAuthor: latest.author,
    latestSayAt: latest.createdAt,
    latestDeliveryStatus: latest.deliveryStatus,
    latestDeliveryError: previewLine(latest.deliveryError, 240),
    latestActivityText,
    activityAt,
    cachedOpenCodeStatus,
    cachedActivityStatus,
    timerSummary:
      options.timerSummary !== undefined
        ? options.timerSummary
        : timerSummaryForSession(session.id, options.now),
  };
}

export function buildSpaceRosterSessionsForOwners(
  owned: Array<{ sessionId: string; spaceId: string; importedAt: string }>,
  sessionRows: Array<typeof sessions.$inferSelect>,
  contextForSession: (
    session: typeof sessions.$inferSelect,
  ) => { repoId: string; worktree: string; worktreeId: string } | undefined,
  now: number,
): SpaceRosterSession[] {
  const byId = new Map(sessionRows.map((session) => [session.id, session]));
  const ownedSessions = owned
    .map((owner) => {
      const session = byId.get(owner.sessionId);
      if (!session) return null;
      return { owner, session };
    })
    .filter(
      (item): item is { owner: (typeof owned)[number]; session: typeof sessions.$inferSelect } =>
        Boolean(item),
    );

  const sessionIds = ownedSessions.map((item) => item.session.id);
  const latestBySession = loadLatestMessageFactsBatch(sessionIds);
  const timerBySession = loadTimerSummariesBatch(sessionIds, now);

  return sortSpaceRosterSessions(
    ownedSessions.map(({ owner, session }) =>
      buildSpaceRosterSession(session, {
        importedAt: owner.importedAt,
        context: contextForSession(session),
        latest: latestBySession.get(session.id),
        timerSummary: timerBySession.get(session.id) ?? null,
        now,
      }),
    ),
  );
}

/** Keep importable list lightweight — same shape as before, plus unknown roster defaults. */
export function buildImportableSpaceSession(
  session: typeof sessions.$inferSelect,
  now: number,
  context?: { repoId: string; worktree: string; worktreeId: string },
): SpaceRosterSession {
  return buildSpaceRosterSession(session, {
    context,
    importedAt: null,
    timerSummary: null,
    now,
  });
}

/** Test helper: load ownership rows for a space. */
export function listSpaceSessionOwners(spaceId: string) {
  return drizzleDb.select().from(spaceSessions).where(eq(spaceSessions.spaceId, spaceId)).all();
}
