export type JarvisBucketId = "active" | "unknown" | "idle";
export type JarvisWindowId =
  | "lastHour"
  | "lastDay"
  | "last3Days"
  | "lastWeek"
  | "last2Weeks"
  | "lastMonth"
  | "last6Months"
  | "allTime";

export type JarvisOrderingSession = {
  id: string;
  state?: string;
  opencodeStatus?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  jarvisOverviewDetails?: {
    latestMessageCreatedAt?: string | null;
    latestOpencodeDeliveryStatus?: string | null;
    latestForwardStatus?: string | null;
    latestCompletionWatchStatus?: string | null;
  } | null;
};

export type JarvisSection<T extends JarvisOrderingSession = JarvisOrderingSession> = {
  id: JarvisWindowId;
  title: string;
  sessions: T[];
  buckets: Array<{ id: JarvisBucketId; sessions: T[] }>;
};

const bucketOrder: Record<JarvisBucketId, number> = {
  active: 0,
  idle: 1,
  unknown: 2,
};

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const threeDaysMs = 3 * dayMs;
const weekMs = 7 * dayMs;
const twoWeeksMs = 14 * dayMs;
const monthMs = 30 * dayMs;
const sixMonthsMs = 183 * dayMs;

const windowOrder: JarvisWindowId[] = [
  "lastHour",
  "lastDay",
  "last3Days",
  "lastWeek",
  "last2Weeks",
  "lastMonth",
  "last6Months",
  "allTime",
];

const bucketIds: JarvisBucketId[] = ["active", "idle", "unknown"];

const windowTitles: Record<JarvisWindowId, string> = {
  lastHour: "Last Hour",
  lastDay: "Last Day",
  last3Days: "Last 3 Days",
  lastWeek: "Last Week",
  last2Weeks: "Last 2 Weeks",
  lastMonth: "Last Month",
  last6Months: "Last 6 Months",
  allTime: "All Time",
};

function isActiveStatus(value: string | null | undefined): boolean {
  return ["busy", "pending", "queued", "retrying", "speaking", "watching", "debouncing"].includes(
    value ?? "",
  );
}

function activityTime(session: JarvisOrderingSession): number {
  const value =
    session.jarvisOverviewDetails?.latestMessageCreatedAt ?? session.updatedAt ?? session.createdAt;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function jarvisBucketForSession(session: JarvisOrderingSession): JarvisBucketId {
  if (
    isActiveStatus(session.opencodeStatus) ||
    isActiveStatus(session.jarvisOverviewDetails?.latestOpencodeDeliveryStatus) ||
    isActiveStatus(session.jarvisOverviewDetails?.latestForwardStatus) ||
    isActiveStatus(session.jarvisOverviewDetails?.latestCompletionWatchStatus)
  ) {
    return "active";
  }
  if (session.opencodeStatus === "idle") return "idle";
  return "unknown";
}

export function jarvisWindowForSession(
  session: JarvisOrderingSession,
  now = Date.now(),
): JarvisWindowId {
  const time = activityTime(session);
  if (!time) return "allTime";
  const age = now - time;
  if (age <= hourMs) return "lastHour";
  if (age <= dayMs) return "lastDay";
  if (age <= threeDaysMs) return "last3Days";
  if (age <= weekMs) return "lastWeek";
  if (age <= twoWeeksMs) return "last2Weeks";
  if (age <= monthMs) return "lastMonth";
  if (age <= sixMonthsMs) return "last6Months";
  return "allTime";
}

export function jarvisStatusLabel(session: JarvisOrderingSession): string {
  const signals = [
    session.opencodeStatus && `OpenCode ${session.opencodeStatus}`,
    session.jarvisOverviewDetails?.latestOpencodeDeliveryStatus &&
      `delivery ${session.jarvisOverviewDetails.latestOpencodeDeliveryStatus}`,
    session.jarvisOverviewDetails?.latestForwardStatus &&
      `forward ${session.jarvisOverviewDetails.latestForwardStatus}`,
    session.jarvisOverviewDetails?.latestCompletionWatchStatus &&
      `watch ${session.jarvisOverviewDetails.latestCompletionWatchStatus}`,
  ].filter(Boolean);
  return signals.join(" / ") || "No cached status";
}

export function orderedJarvisSessions<T extends JarvisOrderingSession>(
  sessions: T[],
  now = Date.now(),
): T[] {
  return [...sessions].sort((left, right) => {
    const windowDelta =
      windowOrder.indexOf(jarvisWindowForSession(left, now)) -
      windowOrder.indexOf(jarvisWindowForSession(right, now));
    if (windowDelta !== 0) return windowDelta;
    const bucketDelta =
      bucketOrder[jarvisBucketForSession(left)] - bucketOrder[jarvisBucketForSession(right)];
    if (bucketDelta !== 0) return bucketDelta;
    return activityTime(right) - activityTime(left);
  });
}

export function jarvisSections<T extends JarvisOrderingSession>(
  sessions: T[],
  now = Date.now(),
): JarvisSection<T>[] {
  const ordered = orderedJarvisSessions(sessions, now);
  return windowOrder.flatMap((windowId) => {
    const windowSessions = ordered.filter(
      (session) => jarvisWindowForSession(session, now) === windowId,
    );
    if (windowSessions.length === 0) return [];
    return [
      {
        id: windowId,
        title: windowTitles[windowId],
        sessions: windowSessions,
        buckets: bucketIds.flatMap((bucketId) => {
          const bucketSessions = windowSessions.filter(
            (session) => jarvisBucketForSession(session) === bucketId,
          );
          return bucketSessions.length ? [{ id: bucketId, sessions: bucketSessions }] : [];
        }),
      },
    ];
  });
}

export function jarvisManagedSessions<T extends JarvisOrderingSession>(
  sessions: T[],
  now = Date.now(),
): T[] {
  return orderedJarvisSessions(
    sessions.filter((session) => session.state === "jarvis"),
    now,
  );
}

export function jarvisCandidateSessions<T extends JarvisOrderingSession>(
  sessions: T[],
  now = Date.now(),
): T[] {
  return orderedJarvisSessions(
    sessions.filter((session) => session.state !== "jarvis" && session.state !== "archived"),
    now,
  );
}
