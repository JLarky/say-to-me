import { safeJsonParse, UnknownJson, safeResponseJson } from "@say-to-me/runtime-validation";
import {
  formatContextUsage,
  formatContextUsageDetails,
  formatContextUsageTitle,
} from "@say-to-me/session-utils/opencode-context-usage";
import {
  type ReactNode,
  type UIEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as stylex from "@stylexjs/stylex";

import { SafeHtml } from "./SafeHtml.tsx";
import { controls } from "../styles/controls.stylex.ts";
import {
  buildOpenCodeActivityCards,
  isOpenCodeStatusAlertCard,
  openCodeStatusAlertMessage,
} from "../opencode-activity-display.ts";
import { OpenCodeActivitySchema } from "../types.ts";
import type { OpenCodeActivity, OpenCodeStatus } from "../types.ts";

type OpenCodeActivityItem = NonNullable<OpenCodeActivity["recentItems"]>[number];

const reducedMotion = "@media (prefers-reduced-motion: reduce)" as const;
const mobile = "@media (max-width: 680px)" as const;

const activityCardPulse = stylex.keyframes({
  "0%": {
    backgroundColor: "rgba(255, 237, 213, 0.92)",
    boxShadow: "0 0 0 0 rgba(194, 95, 28, 0.24)",
  },
  "55%": {
    backgroundColor: "rgba(255, 247, 237, 0.86)",
    boxShadow: "0 0 0 9px rgba(194, 95, 28, 0)",
  },
  "100%": {
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    boxShadow: "0 8px 20px rgba(23, 32, 42, 0.05)",
  },
});

const activityPausedPulse = stylex.keyframes({
  "0%": {
    backgroundColor: "rgba(255, 237, 213, 0.55)",
    outlineWidth: "0",
    outlineStyle: "solid",
    outlineColor: "rgba(194, 95, 28, 0.3)",
  },
  "60%": {
    backgroundColor: "rgba(255, 247, 237, 0.28)",
    outlineWidth: "6px",
    outlineStyle: "solid",
    outlineColor: "rgba(194, 95, 28, 0)",
  },
  "100%": {
    backgroundColor: "transparent",
    outlineWidth: "0",
    outlineStyle: "solid",
    outlineColor: "rgba(194, 95, 28, 0)",
  },
});

// Exported so the Claude activity view can reuse the exact same cards/carousel.
export const activityStyles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
    width: "100%",
    marginTop: "0.65rem",
    paddingBlock: "0.55rem",
    paddingInline: "0.62rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(138, 75, 32, 0.18)",
    borderRadius: "18px",
    backgroundColor: "rgba(255, 253, 248, 0.78)",
    boxShadow: "0 10px 30px rgba(23, 32, 42, 0.07)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
  },
  headerSignals: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.4rem",
    columnGap: "0.4rem",
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    backgroundColor: "#17202a",
    color: "#fff",
    paddingBlock: "0.25rem",
    paddingInline: "0.55rem",
    fontSize: "0.72rem",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  statusAwaitingInput: {
    backgroundColor: "rgba(124, 58, 237, 0.9)",
  },
  statusRetrying: {
    backgroundColor: "rgba(194, 95, 28, 0.92)",
  },
  statusError: {
    backgroundColor: "rgba(180, 35, 24, 0.92)",
  },
  contextUsage: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(21, 94, 239, 0.28)",
    backgroundColor: "rgba(239, 246, 255, 0.9)",
    color: "#1a56db",
    paddingBlock: "0.22rem",
    paddingInline: "0.52rem",
    fontSize: "0.72rem",
    fontWeight: 800,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    cursor: "pointer",
  },
  snippet: {
    marginTop: 0,
    marginBottom: 0,
    maxHeight: {
      default: "250px",
      [mobile]: "8rem",
    },
    overflowY: "auto",
    color: "#24313f",
    fontSize: "0.92rem",
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  },
  carousel: {
    display: "grid",
    gridAutoColumns: "90%",
    gridAutoFlow: "column",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    overflowX: "auto",
    paddingTop: "0.05rem",
    paddingBottom: "0.38rem",
    scrollSnapType: "x mandatory",
    scrollbarWidth: "none",
  },
  pausedPulse: {
    animationName: {
      default: activityPausedPulse,
      [reducedMotion]: "none",
    },
    animationDuration: "1.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    backgroundColor: {
      default: null,
      [reducedMotion]: "rgba(255, 247, 237, 0.55)",
    },
  },
  card: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.32rem",
    columnGap: "0.32rem",
    minHeight: {
      default: "9rem",
      [mobile]: "6.25rem",
    },
    paddingBlock: "0.48rem",
    paddingInline: "0.52rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.11)",
    borderRadius: "14px",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    scrollSnapAlign: "start",
  },
  cardPulse: {
    animationName: {
      default: activityCardPulse,
      [reducedMotion]: "none",
    },
    animationDuration: "2.2s",
    animationTimingFunction: "ease-out",
    backgroundColor: {
      default: null,
      [reducedMotion]: "rgba(255, 247, 237, 0.9)",
    },
  },
  cardPartial: {
    opacity: 0.8,
  },
  cardMessage: {
    borderColor: "rgba(23, 32, 42, 0.11)",
  },
  cardTool: {
    borderColor: "rgba(21, 94, 239, 0.28)",
  },
  cardThinking: {
    borderColor: "rgba(138, 75, 32, 0.3)",
  },
  cardCompaction: {
    borderColor: "rgba(6, 118, 71, 0.26)",
  },
  cardQuestion: {
    borderColor: "rgba(124, 58, 237, 0.45)",
    backgroundColor: "rgba(245, 243, 255, 0.6)",
  },
  cardStatusAlert: {
    borderColor: "rgba(180, 35, 24, 0.45)",
    backgroundColor: "rgba(254, 242, 242, 0.92)",
  },
  details: {
    color: "#667085",
    fontSize: "0.78rem",
  },
  summary: {
    cursor: "pointer",
    color: "#8a4b20",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  meta: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: "0.55rem",
    rowGap: "0.2rem",
    marginTop: "0.45rem",
    marginBottom: "0",
    marginInline: 0,
    overflowWrap: "anywhere",
  },
});

export function OpenCodeActivityPreview({
  onActivityStatusChange,
  onRequestCompact,
  onRefreshSessionPage,
  sessionId,
}: {
  onActivityStatusChange?: (status: OpenCodeStatus) => void;
  onRequestCompact?: () => void | Promise<void>;
  onRefreshSessionPage?: () => Promise<OpenCodeActivity | null>;
  sessionId?: string;
}) {
  const [activity, setActivity] = useState<OpenCodeActivity | null>(null);
  const [displayActivity, setDisplayActivity] = useState<OpenCodeActivity | null>(null);
  const [pulsingCardKey, setPulsingCardKey] = useState<string | null>(null);
  const [pausedUpdatePulse, setPausedUpdatePulse] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const displayActivityRef = useRef<OpenCodeActivity | null>(null);
  const latestActivityRef = useRef<OpenCodeActivity | null>(null);
  const onActivityStatusChangeRef = useRef(onActivityStatusChange);
  const displayedFirstCardKeyRef = useRef<string | null>(null);
  const isAtFirstCardRef = useRef(true);
  const shouldScrollToLatestRef = useRef(false);
  const displayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canShow = Boolean(sessionId && sessionId !== "default" && sessionId.startsWith("ses_"));
  const snippetStyleProps = useMemo(() => stylex.props(activityStyles.snippet), []);

  useEffect(() => {
    onActivityStatusChangeRef.current = onActivityStatusChange;
  }, [onActivityStatusChange]);

  function applyActivity(nextActivity: OpenCodeActivity, options: { debounce?: boolean } = {}) {
    latestActivityRef.current = nextActivity;
    setActivity(nextActivity);
    if (!displayActivityRef.current) {
      shouldScrollToLatestRef.current = true;
      displayNextActivity(nextActivity);
    } else if (isAtFirstCardRef.current) {
      shouldScrollToLatestRef.current = true;
      if (options.debounce) {
        scheduleDisplayActivity(nextActivity);
      } else {
        displayNextActivity(nextActivity);
      }
    } else if (
      activityFirstItemKey(nextActivity) &&
      activityFirstItemKey(nextActivity) !== displayedFirstCardKeyRef.current
    ) {
      pulsePausedUpdates();
    }
  }

  function scheduleDisplayActivity(nextActivity: OpenCodeActivity) {
    if (displayTimerRef.current) clearTimeout(displayTimerRef.current);
    displayTimerRef.current = setTimeout(() => {
      displayTimerRef.current = null;
      if (isAtFirstCardRef.current) displayNextActivity(nextActivity);
    }, 300);
  }

  function displayNextActivity(nextActivity: OpenCodeActivity) {
    const nextFirstKey = activityFirstItemKey(nextActivity);
    if (nextFirstKey && nextFirstKey !== displayedFirstCardKeyRef.current) {
      setPulsingCardKey(nextFirstKey);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => setPulsingCardKey(null), 2200);
    }
    displayedFirstCardKeyRef.current = nextFirstKey;
    displayActivityRef.current = nextActivity;
    setDisplayActivity(nextActivity);
  }

  function pulsePausedUpdates() {
    setPausedUpdatePulse(true);
  }

  function handleCarouselScroll(event: UIEvent<HTMLDivElement>) {
    const atFirstCard = isAtFirstCard(event.currentTarget);
    isAtFirstCardRef.current = atFirstCard;
    if (atFirstCard && latestActivityRef.current) {
      if (displayTimerRef.current) {
        clearTimeout(displayTimerRef.current);
        displayTimerRef.current = null;
      }
      setPausedUpdatePulse(false);
      displayNextActivity(latestActivityRef.current);
    }
  }

  async function refreshActivity(showBusy = true) {
    if (!sessionId || !canShow) return;
    if (showBusy) setIsRefreshing(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      if (onRefreshSessionPage) {
        const refreshedActivity = await onRefreshSessionPage();
        if (refreshedActivity) applyActivity(refreshedActivity);
      } else {
        const response = await fetch(`/api/debug/opencode-activity/${sessionId}?limit=8`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Activity fetch failed: ${response.status}`);
        applyActivity(await safeResponseJson(response, OpenCodeActivitySchema));
      }
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      clearTimeout(timer);
      if (showBusy) setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (!sessionId || !canShow) return;
    let eventFetchCount = 0;
    // The server-side hub pushes canonical snapshots (one shared upstream + one
    // refetch loop across all tabs), so the client just renders what it receives.
    const events = new EventSource(`/api/sessions/${sessionId}/opencode-activity/events`);
    events.addEventListener("open", () => {
      eventFetchCount += 1;
      console.log(`[opencode-activity] ${sessionId}: event stream opened`);
    });
    events.addEventListener("snapshot", (event) => {
      const parsed = safeJsonParse(UnknownJson, (event as MessageEvent).data);
      if (!parsed || typeof parsed !== "object") {
        setError("OpenCode activity update was malformed.");
        return;
      }
      const nextActivity = parsed as OpenCodeActivity;
      applyActivity(nextActivity, { debounce: true });
      const nextStatus = activityStatusToSessionStatus(nextActivity);
      if (nextStatus) onActivityStatusChangeRef.current?.(nextStatus);
      setError(null);
    });
    events.addEventListener("activity-error", (event) => {
      const parsed = safeJsonParse(UnknownJson, (event as MessageEvent).data);
      const payload = (parsed && typeof parsed === "object" ? parsed : {}) as OpenCodeActivity;
      setError(payload.message || "OpenCode activity stream failed.");
    });
    events.onerror = () => {
      setError("OpenCode activity stream disconnected; reconnecting…");
      void refreshActivity(false);
    };
    const eventFetchTimer = setInterval(() => {
      if (eventFetchCount > 0) {
        console.log(
          `[opencode-activity] ${sessionId}: ${eventFetchCount} event fetches in last 5s`,
        );
        eventFetchCount = 0;
      }
    }, 5000);
    return () => {
      clearInterval(eventFetchTimer);
      events.close();
    };
  }, [sessionId, canShow]);

  useEffect(() => {
    return () => {
      if (displayTimerRef.current) clearTimeout(displayTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!shouldScrollToLatestRef.current) return;
    shouldScrollToLatestRef.current = false;
    carouselRef.current?.scrollTo?.({ left: 0 });
  }, [displayActivity]);

  const label = useMemo(() => activityLabel(activity), [activity]);
  const contextUsageLabel = useMemo(() => formatContextUsage(activity), [activity]);
  const contextUsageTitle = useMemo(() => formatContextUsageTitle(activity), [activity]);
  const recentItems =
    displayActivity?.recentItems?.filter((item) => item.snippet).slice(0, 5) ?? [];
  const activityCards = buildOpenCodeActivityCards({
    activity: displayActivity,
    recentItems,
    streamError: error,
  });
  const statusAlert = openCodeStatusAlertMessage(displayActivity);

  if (!canShow) return null;

  const carouselProps = stylex.props(
    activityStyles.carousel,
    pausedUpdatePulse && activityStyles.pausedPulse,
  );

  function requestCompact() {
    if (!window.confirm("Compact this OpenCode session?")) return;
    void onRequestCompact?.();
  }

  return (
    <section {...stylex.props(activityStyles.panel)} aria-label="OpenCode activity">
      <div {...stylex.props(activityStyles.header)}>
        <div {...stylex.props(activityStyles.headerSignals)}>
          <StatusPill
            awaitingInput={activity?.status === "awaiting-input"}
            retrying={activity?.status === "retrying"}
            error={activity?.status === "error"}
            title={statusAlert ?? undefined}
          >
            {label}
          </StatusPill>
          {contextUsageLabel ? (
            <button
              aria-label="Run OpenCode compact"
              {...stylex.props(activityStyles.contextUsage)}
              onClick={requestCompact}
              title={contextUsageTitle ?? undefined}
              type="button"
            >
              {contextUsageLabel}
            </button>
          ) : null}
        </div>
        <button
          {...stylex.props(
            controls.button,
            controls.secondary,
            controls.compact,
            controls.autoMobileWidth,
          )}
          disabled={isRefreshing}
          onClick={() => refreshActivity()}
          type="button"
        >
          Refresh
        </button>
      </div>
      {activityCards.length > 0 ? (
        <div
          {...carouselProps}
          aria-label="Recent OpenCode activity"
          onScroll={handleCarouselScroll}
          ref={carouselRef}
        >
          {activityCards.map((item, index) => {
            const itemKey = activityItemKey(item, index);
            const cardProps = stylex.props(
              activityStyles.card,
              isOpenCodeStatusAlertCard(item, displayActivity)
                ? activityStyles.cardStatusAlert
                : activityCardKindStyle(item),
              itemKey === pulsingCardKey && activityStyles.cardPulse,
              item.partial && activityStyles.cardPartial,
            );
            return (
              <article {...cardProps} aria-label={`OpenCode activity ${index + 1}`} key={itemKey}>
                {item.snippetHtml ? (
                  <SafeHtml
                    className="opencode-activity-markdown"
                    html={item.snippetHtml}
                    styleProps={snippetStyleProps}
                  />
                ) : (
                  <pre {...snippetStyleProps} className="opencode-activity-markdown">
                    {item.snippet || ""}
                  </pre>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
      <details {...stylex.props(activityStyles.details)}>
        <summary {...stylex.props(activityStyles.summary)}>Details</summary>
        <dl {...stylex.props(activityStyles.meta)}>
          <Meta label="status" value={statusAlert} />
          <Meta label="source" value={activity?.previewSource || null} />
          <Meta label="context" value={formatContextUsageDetails(activity)} />
          <Meta label="context source" value={activity?.contextUsage?.source || null} />
          <Meta label="message" value={activity?.identifiers?.messageId || null} />
          <Meta label="part" value={activity?.identifiers?.partId || null} />
          <Meta
            label="event"
            value={activity?.identifiers?.eventId || activity?.eventType || null}
          />
          <Meta
            label="checked"
            value={formatTime(activity?.freshness?.checkedAt || activity?.checkedAt)}
          />
          <Meta label="freshness" value={formatFreshness(activity)} />
        </dl>
      </details>
    </section>
  );
}

function isAtFirstCard(node: HTMLDivElement | null) {
  return !node || node.scrollLeft <= 1;
}

function StatusPill({
  children,
  awaitingInput,
  retrying,
  error,
  title,
}: {
  children: ReactNode;
  awaitingInput?: boolean;
  retrying?: boolean;
  error?: boolean;
  title?: string;
}) {
  return (
    <span
      {...stylex.props(
        activityStyles.status,
        awaitingInput && activityStyles.statusAwaitingInput,
        retrying && activityStyles.statusRetrying,
        error && activityStyles.statusError,
      )}
      title={title}
    >
      {children}
    </span>
  );
}

function activityItemKey(item: OpenCodeActivityItem | undefined, index: number) {
  if (!item) return `empty-${index}`;
  return `${item.messageId || "message"}-${item.partId || item.timestamp || index}`;
}

function activityFirstItemKey(activity: OpenCodeActivity) {
  return activity.recentItems?.[0] ? activityItemKey(activity.recentItems[0], 0) : null;
}

function activityCardKindStyle(item: OpenCodeActivityItem) {
  if (item.kind === "tool") return activityStyles.cardTool;
  if (item.kind === "thinking") return activityStyles.cardThinking;
  if (item.kind === "compaction") return activityStyles.cardCompaction;
  if (item.kind === "question") return activityStyles.cardQuestion;
  return activityStyles.cardMessage;
}

function activityStatusToSessionStatus(activity: OpenCodeActivity): OpenCodeStatus | null {
  if (activity.status === "retrying") return "retrying";
  if (activity.status === "error")
    return openCodeStatusAlertMessage(activity) ? "unavailable" : "pending";
  if (
    activity.status === "busy" ||
    activity.status === "awaiting-input" ||
    activity.status === "pending"
  ) {
    return "pending";
  }
  if (activity.status === "idle") return "idle";
  return null;
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return value ? (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  ) : null;
}

function activityLabel(activity: OpenCodeActivity | null) {
  if (!activity) return "no new updates";
  if (activity.status === "retrying") return "retrying";
  if (activity.status === "error") return "error";
  if (activity.status === "awaiting-input") return "needs your input";
  if (activity.status === "busy" || activity.status === "pending") return "busy";
  if (activity.eventType && activity.checkedAt && Date.now() - activity.checkedAt < 15_000) {
    return "done";
  }
  const timestamp = activity.latestActivityTimestamp || activity.checkedAt || 0;
  if (activity.freshness?.stale || (timestamp && Date.now() - timestamp > 30_000)) {
    return "no new updates";
  }
  if (activity.status === "idle") return "idle";
  return "no new updates";
}

function formatTime(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : null;
}

function formatFreshness(activity: OpenCodeActivity | null) {
  const age = activity?.freshness?.ageMs;
  if (typeof age !== "number") return null;
  return activity?.freshness?.stale
    ? `stale, ${Math.round(age / 1000)}s old`
    : `fresh, ${Math.round(age / 1000)}s old`;
}
