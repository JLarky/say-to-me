import { type as arktype } from "arktype";
import { desc, eq, inArray } from "drizzle-orm";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { resolveListDisplayName } from "../src/session-display.ts";
import { drizzleDb } from "./db/index.ts";
import {
  messages,
  notifications,
  routines,
  sessions,
  spaceSessions,
  spaces,
} from "./db/drizzle-schema.ts";
import { maxStoredNotifications } from "./notification-history.ts";
import { peekInMemoryProviderTitle } from "./session-enrich.ts";
import { isInternalRosterNotice } from "./space-session-roster.ts";

/**
 * Persisted activity for sessions currently attached to a space.
 *
 * Sources (no synthetic working/idle/recovery audit):
 * - meaningful Say messages (excludes ui_only / idle system notices)
 * - delivery failures on those messages
 * - notifications for attached session ids (active + dismissed still in table;
 *   global prune keeps only the newest {@link maxStoredNotifications} rows)
 * - routines facts (created / last fired / current status snapshot)
 * - space_sessions.importedAt attachment events
 *
 * Scope: only sessions currently attached. Move/release changes the feed.
 */

export type SpaceActivityEventType =
  | "message"
  | "delivery"
  | "notification"
  | "timer"
  | "attachment";

export type SpaceActivityEvent = {
  id: string;
  type: SpaceActivityEventType;
  sessionId: string;
  sessionTitle: string;
  title: string;
  detail: string;
  createdAt: string;
  url: string | null;
  dismissedAt: string | null;
};

export type SpaceActivityRetention = {
  /** Newest message rows scanned across attached sessions. */
  messageScanLimit: number;
  /** True when the scan hit the limit (older messages may be omitted). */
  messageScanTruncated: boolean;
  /** Global notifications table prune limit. */
  notificationRetentionLimit: number;
  /** Max time-range hours clients may request. */
  maxRangeHours: number;
  /** Hours actually applied for this response. */
  appliedRangeHours: number;
  /** True when client requested more hours than maxRangeHours. */
  rangeClamped: boolean;
  timerFreshnessNote: string;
  scopeNote: string;
};

export type SpaceActivityPayload = {
  spaceId: string;
  spaceName: string;
  events: SpaceActivityEvent[];
  /** @deprecated Prefer retention.messageScanLimit */
  messageLimit: number;
  /** @deprecated Prefer retention.timerFreshnessNote */
  timerFreshnessNote: string;
  retention: SpaceActivityRetention;
};

export const DEFAULT_MESSAGE_LIMIT = 200;
/** Supported UI ranges: 24h / 7d / 30d. No year-long claim. */
export const MAX_ACTIVITY_RANGE_HOURS = 720;
export const DEFAULT_ACTIVITY_RANGE_HOURS = 168;

const TIMER_FRESHNESS_NOTE =
  "Routine remaining/next-fire values come from the live routines row at fetch time; only createdAt and lastFiredAt are historical.";
const SCOPE_NOTE =
  "Events cover sessions currently attached to this space. Moving or releasing a session changes this feed.";

const DeliverPromptActionDetail = arktype({
  "message?": "string",
});

function preview(text: string, max = 220): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3)}...`;
}

function sessionTitleFor(sessionId: string, alias: string | null, cwd: string | null): string {
  return resolveListDisplayName({
    id: sessionId,
    alias,
    opencodeTitle: peekInMemoryProviderTitle(sessionId),
    cwd,
  });
}

function routineTitle(title: string | null): string {
  return title?.trim() || "Routine";
}

function routineDetailMessage(actionJson: string, titleFallback: string): string {
  const parsed = safeJsonParse(DeliverPromptActionDetail, actionJson);
  if (parsed?.message?.trim()) return parsed.message;
  return titleFallback;
}

function routineRemainingLabel(status: string, nextFireAt: number | null, now: number): string {
  if (nextFireAt == null) return "no scheduled fire";
  if (status === "paused") return "paused";
  if (status === "firing") return "firing now";
  const remainingMs = nextFireAt - now;
  if (remainingMs <= 0) return "due now";
  return `next in ${Math.max(1, Math.round(remainingMs / 1000))}s`;
}

function toIsoFromMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function parseCreatedAtMs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  // Prefer native parse for ISO with T/Z; SQL "YYYY-MM-DD HH:MM:SS" treated as UTC.
  const asDate = Date.parse(trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`);
  return Number.isFinite(asDate) ? asDate : 0;
}

export function compareNewestFirst(a: SpaceActivityEvent, b: SpaceActivityEvent): number {
  const byTime = parseCreatedAtMs(b.createdAt) - parseCreatedAtMs(a.createdAt);
  if (byTime !== 0) return byTime;
  return b.id.localeCompare(a.id);
}

function emptyRetention(
  messageLimit: number,
  appliedRangeHours: number,
  rangeClamped: boolean,
): SpaceActivityRetention {
  return {
    messageScanLimit: messageLimit,
    messageScanTruncated: false,
    notificationRetentionLimit: maxStoredNotifications,
    maxRangeHours: MAX_ACTIVITY_RANGE_HOURS,
    appliedRangeHours,
    rangeClamped,
    timerFreshnessNote: TIMER_FRESHNESS_NOTE,
    scopeNote: SCOPE_NOTE,
  };
}

export function clampActivityRangeHours(requested: number | undefined): {
  appliedRangeHours: number;
  rangeClamped: boolean;
} {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) {
    return { appliedRangeHours: DEFAULT_ACTIVITY_RANGE_HOURS, rangeClamped: false };
  }
  if (requested > MAX_ACTIVITY_RANGE_HOURS) {
    return { appliedRangeHours: MAX_ACTIVITY_RANGE_HOURS, rangeClamped: true };
  }
  return { appliedRangeHours: Math.floor(requested), rangeClamped: false };
}

export function listAttachedSessionIds(spaceId: string): string[] {
  return drizzleDb
    .select({ sessionId: spaceSessions.sessionId })
    .from(spaceSessions)
    .where(eq(spaceSessions.spaceId, spaceId))
    .all()
    .map((row) => row.sessionId);
}

export function buildSpaceActivity(
  spaceId: string,
  options: { messageLimit?: number; now?: number; rangeHours?: number } = {},
): SpaceActivityPayload | null {
  const space = drizzleDb.select().from(spaces).where(eq(spaces.id, spaceId)).get();
  if (!space) return null;

  const messageLimit = options.messageLimit ?? DEFAULT_MESSAGE_LIMIT;
  const now = options.now ?? Date.now();
  const { appliedRangeHours, rangeClamped } = clampActivityRangeHours(options.rangeHours);
  const cutoffMs = now - appliedRangeHours * 60 * 60 * 1000;

  const owned = drizzleDb
    .select({
      sessionId: spaceSessions.sessionId,
      importedAt: spaceSessions.importedAt,
    })
    .from(spaceSessions)
    .where(eq(spaceSessions.spaceId, spaceId))
    .all();

  const sessionIds = owned.map((row) => row.sessionId);
  const events: SpaceActivityEvent[] = [];
  const retentionBase = emptyRetention(messageLimit, appliedRangeHours, rangeClamped);

  if (sessionIds.length === 0) {
    return {
      spaceId,
      spaceName: space.name,
      events: [],
      messageLimit,
      timerFreshnessNote: TIMER_FRESHNESS_NOTE,
      retention: retentionBase,
    };
  }

  const sessionRows = drizzleDb
    .select({
      id: sessions.id,
      alias: sessions.alias,
      cwd: sessions.cwd,
    })
    .from(sessions)
    .where(inArray(sessions.id, sessionIds))
    .all();
  const titleById = new Map(
    sessionRows.map((row) => [row.id, sessionTitleFor(row.id, row.alias, row.cwd)] as const),
  );
  const titleOf = (sessionId: string) => titleById.get(sessionId) ?? sessionId;

  for (const row of owned) {
    events.push({
      id: `attachment:${row.sessionId}`,
      type: "attachment",
      sessionId: row.sessionId,
      sessionTitle: titleOf(row.sessionId),
      title: "Attached to space",
      detail: `${titleOf(row.sessionId)} was attached to ${space.name}`,
      createdAt: row.importedAt,
      url: `/ses/${encodeURIComponent(row.sessionId)}`,
      dismissedAt: null,
    });
  }

  const messageRows = drizzleDb
    .select({
      id: messages.id,
      sessionId: messages.sessionId,
      text: messages.text,
      author: messages.author,
      createdAt: messages.createdAt,
      deliveryStatus: messages.opencodeDeliveryStatus,
      deliveryError: messages.opencodeDeliveryError,
    })
    .from(messages)
    .where(inArray(messages.sessionId, sessionIds))
    .orderBy(desc(messages.id))
    .limit(messageLimit)
    .all();
  const messageScanTruncated = messageRows.length >= messageLimit;

  for (const row of messageRows) {
    if (isInternalRosterNotice(row.text, row.deliveryStatus)) continue;
    const sessionTitle = titleOf(row.sessionId);
    const author = row.author === "user" ? "user" : "agent";
    events.push({
      id: `message:${row.id}`,
      type: "message",
      sessionId: row.sessionId,
      sessionTitle,
      title: `${author === "user" ? "User" : "Agent"} message`,
      detail: preview(row.text),
      createdAt: row.createdAt,
      url: `/ses/${encodeURIComponent(row.sessionId)}`,
      dismissedAt: null,
    });

    const delivery = row.deliveryStatus?.toLowerCase() ?? "";
    if (delivery === "failed" || row.deliveryError?.trim()) {
      events.push({
        id: `delivery:${row.id}`,
        type: "delivery",
        sessionId: row.sessionId,
        sessionTitle,
        title: "Delivery failed",
        detail: preview(row.deliveryError?.trim() || `Delivery status: ${row.deliveryStatus}`),
        createdAt: row.createdAt,
        url: `/ses/${encodeURIComponent(row.sessionId)}`,
        dismissedAt: null,
      });
    }
  }

  const notificationRows = drizzleDb
    .select()
    .from(notifications)
    .where(inArray(notifications.sessionId, sessionIds))
    .orderBy(desc(notifications.id))
    .all();

  for (const row of notificationRows) {
    events.push({
      id: `notification:${row.id}`,
      type: "notification",
      sessionId: row.sessionId,
      sessionTitle: row.sessionTitle || titleOf(row.sessionId),
      title: row.title || "Notification",
      detail: preview(row.body),
      createdAt: row.createdAt,
      url: row.url || `/ses/${encodeURIComponent(row.sessionId)}`,
      dismissedAt: row.dismissedAt,
    });
  }

  const routineRows = drizzleDb
    .select()
    .from(routines)
    .where(inArray(routines.ownerSessionId, sessionIds))
    .all();

  for (const routine of routineRows) {
    const sessionTitle = titleOf(routine.ownerSessionId);
    const title = routineTitle(routine.title);
    const detail = preview(routineDetailMessage(routine.action, title));
    events.push({
      id: `timer-created:${routine.id}`,
      type: "timer",
      sessionId: routine.ownerSessionId,
      sessionTitle,
      title: `Routine created · ${title}`,
      detail,
      createdAt: routine.createdAt,
      url: `/ses/${encodeURIComponent(routine.ownerSessionId)}`,
      dismissedAt: null,
    });

    const firedAt = toIsoFromMs(routine.lastFiredAt);
    if (firedAt) {
      events.push({
        id: `timer-fired:${routine.id}:${routine.lastFiredAt}`,
        type: "timer",
        sessionId: routine.ownerSessionId,
        sessionTitle,
        title: `Routine fired · ${title}`,
        detail,
        createdAt: firedAt,
        url: `/ses/${encodeURIComponent(routine.ownerSessionId)}`,
        dismissedAt: null,
      });
    }

    events.push({
      id: `timer-status:${routine.id}:${routine.updatedAt}`,
      type: "timer",
      sessionId: routine.ownerSessionId,
      sessionTitle,
      title: `Routine ${routine.status} · ${title}`,
      detail: `${routineRemainingLabel(routine.status, routine.nextFireAt, now)} · live snapshot from routines`,
      createdAt: routine.updatedAt,
      url: `/ses/${encodeURIComponent(routine.ownerSessionId)}`,
      dismissedAt: null,
    });
  }

  const inRange = events.filter((event) => parseCreatedAtMs(event.createdAt) >= cutoffMs);
  inRange.sort(compareNewestFirst);

  return {
    spaceId,
    spaceName: space.name,
    events: inRange,
    messageLimit,
    timerFreshnessNote: TIMER_FRESHNESS_NOTE,
    retention: {
      ...retentionBase,
      messageScanTruncated,
    },
  };
}

/** Test helper: space exists check without building events. */
export function spaceExists(spaceId: string): boolean {
  return Boolean(
    drizzleDb.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, spaceId)).get(),
  );
}
