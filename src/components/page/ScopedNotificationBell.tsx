import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router";

import { parseJson, safeResponseJson } from "@say-to-me/runtime-validation";
import { useOptionalDashboardLiveRefresh } from "../../dashboard-live-refresh.tsx";
import { NotificationsPayload, type AppNotification } from "../../types.ts";
import { formatMessageTime } from "../../utils.ts";
import { Icon } from "./chrome-icons.tsx";
import { bell } from "./ScopedNotificationBell.stylex.ts";
import { subscribeNotificationsRealtime } from "../../notifications-realtime.ts";

export type NotificationScope = "space" | "all";

const scopeStorageKey = "say-to-me:notification-bell-scope";

function initialScope(hasSpace: boolean): NotificationScope {
  if (!hasSpace) return "all";
  if (typeof window === "undefined") return "space";
  return window.sessionStorage.getItem(scopeStorageKey) === "all" ? "all" : "space";
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error);
}

export type ScopedNotificationBellProps = {
  /** Selected space id when viewing a space dashboard. */
  spaceId?: string | null;
  spaceName?: string | null;
  /** Session ids currently attached to the selected space (This space scope). */
  spaceSessionIds?: readonly string[];
  /** Real working-session count for the current scope, when known. */
  workingCount?: number;
  /** Panel anchor: sidebar (desktop nav) or topbar (compact header). */
  placement?: "sidebar" | "topbar";
  /** Shared notifications list when a parent owns the SSE connection. */
  notifications?: AppNotification[];
  notificationsLoaded?: boolean;
  notificationsError?: string;
  onDismiss?: (notificationId: number) => Promise<void> | void;
  /** Called when the bell needs a refresh (e.g. parent should refetch). */
  onRequestRefresh?: () => void;
};

export function ScopedNotificationBell({
  spaceId = null,
  spaceName = null,
  spaceSessionIds = [],
  workingCount,
  placement = "sidebar",
  notifications: controlledNotifications,
  notificationsLoaded: controlledLoaded,
  notificationsError: controlledError,
  onDismiss,
  onRequestRefresh,
}: ScopedNotificationBellProps) {
  const panelId = useId();
  const live = useOptionalDashboardLiveRefresh();
  const hasSpace = Boolean(spaceId);
  const spaceIdSet = useMemo(() => new Set(spaceSessionIds), [spaceSessionIds]);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<NotificationScope>(() => initialScope(hasSpace));
  const [localNotifications, setLocalNotifications] = useState<AppNotification[]>([]);
  const [localLoaded, setLocalLoaded] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localStreamArmed, setLocalStreamArmed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasControlledProps = controlledNotifications !== undefined;
  const usesProvider = !hasControlledProps && live != null;
  const ownsLocalStream = !hasControlledProps && !usesProvider;

  const notifications = hasControlledProps
    ? controlledNotifications
    : usesProvider
      ? live.notifications
      : localNotifications;
  const notificationsLoaded = hasControlledProps
    ? (controlledLoaded ?? true)
    : usesProvider
      ? live.notificationsLoaded
      : localLoaded;
  const notificationsError = hasControlledProps
    ? (controlledError ?? "")
    : usesProvider
      ? live.notificationsError
      : localError;

  useEffect(() => {
    if (!hasSpace && scope === "space") setScope("all");
  }, [hasSpace, scope]);

  // Uncontrolled fallback: connect SSE only after the panel is opened once so
  // pages that mount multiple bells (or tests that never open them) do not spawn
  // duplicate background EventSources / act warnings.
  useEffect(() => {
    if (!ownsLocalStream || !localStreamArmed) return;
    if (typeof EventSource !== "function") {
      void loadNotifications();
      return;
    }

    function applySnapshot(data: string) {
      try {
        const payload = parseJson(NotificationsPayload, data);
        setLocalNotifications(payload.notifications);
        setLocalLoaded(true);
        setLocalError("");
      } catch (error) {
        setLocalError(`Live notification payload was invalid: ${errorMessage(error)}`);
      }
    }

    return subscribeNotificationsRealtime({
      onEvent: (_eventType, data) => {
        applySnapshot(data);
      },
      onError: () => {
        setLocalError("Live notifications disconnected.");
        void loadNotifications();
      },
    });
  }, [ownsLocalStream, localStreamArmed]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  async function loadNotifications() {
    setLocalError("");
    try {
      const response = await fetch("/api/notifications");
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        setLocalError(
          `Unable to load notifications: HTTP ${response.status}${text ? ` - ${text.slice(0, 180)}` : ""}`,
        );
        setLocalLoaded(true);
        return;
      }
      const payload = await safeResponseJson(response, NotificationsPayload);
      setLocalNotifications(payload.notifications);
      setLocalLoaded(true);
    } catch (error) {
      setLocalError(`Unable to load notifications: ${errorMessage(error)}`);
      setLocalLoaded(true);
    }
  }

  async function dismissNotification(notificationId: number) {
    if (onDismiss) {
      await onDismiss(notificationId);
      return;
    }
    if (usesProvider) {
      await live.dismissNotification(notificationId);
      return;
    }
    setLocalNotifications((items) => items.filter((item) => item.id !== notificationId));
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, { method: "DELETE" });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        setLocalError(
          `Unable to dismiss notification: HTTP ${response.status}${text ? ` - ${text.slice(0, 180)}` : ""}`,
        );
        void loadNotifications();
        return;
      }
      const payload = await safeResponseJson(response, NotificationsPayload);
      setLocalNotifications(payload.notifications);
      setLocalLoaded(true);
      onRequestRefresh?.();
    } catch (error) {
      setLocalError(`Unable to dismiss notification: ${errorMessage(error)}`);
      void loadNotifications();
    }
  }

  function selectScope(next: NotificationScope) {
    if (next === "space" && !hasSpace) return;
    setScope(next);
    try {
      window.sessionStorage.setItem(scopeStorageKey, next);
    } catch {
      // sessionStorage may be unavailable
    }
  }

  const scoped = useMemo(() => {
    if (scope === "all" || !hasSpace) return notifications;
    return notifications.filter((item) => spaceIdSet.has(item.sessionId));
  }, [notifications, scope, hasSpace, spaceIdSet]);

  const allCount = notifications.length;
  const spaceCount = notifications.filter((item) => spaceIdSet.has(item.sessionId)).length;
  const activeCount = scope === "space" && hasSpace ? spaceCount : allCount;

  return (
    <div {...stylex.props(bell.wrap)} ref={containerRef}>
      <button
        {...stylex.props(bell.trigger, open && bell.triggerOpen)}
        type="button"
        aria-label={`Notifications, ${activeCount} active`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (next && ownsLocalStream) {
              setLocalStreamArmed(true);
              if (!localLoaded) void loadNotifications();
            }
            return next;
          });
        }}
      >
        <Icon name="bell" />
        {activeCount > 0 ? <span {...stylex.props(bell.badge)}>{activeCount}</span> : null}
      </button>
      {open ? (
        <section
          {...stylex.props(bell.panel, placement === "topbar" && bell.panelTopbar)}
          id={panelId}
          aria-label="Notifications"
        >
          <header {...stylex.props(bell.header)}>
            <div>
              <span {...stylex.props(bell.eyebrow)}>NOTIFICATIONS</span>
              <strong {...stylex.props(bell.title)}>What needs your attention</strong>
            </div>
            <button
              {...stylex.props(bell.close)}
              type="button"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div {...stylex.props(bell.scroll)}>
            {typeof workingCount === "number" ? (
              <article {...stylex.props(bell.liveCard)}>
                <span {...stylex.props(bell.stateDot)} />
                <span {...stylex.props(bell.cardText)}>
                  <strong {...stylex.props(bell.cardTitle)}>
                    {workingCount} working session{workingCount === 1 ? "" : "s"}
                  </strong>
                  <span {...stylex.props(bell.cardDetail)}>
                    {scope === "all" || !hasSpace
                      ? "From the current dashboard roster"
                      : `In ${spaceName ?? "this space"}`}
                  </span>
                </span>
              </article>
            ) : null}

            <div {...stylex.props(bell.sectionHeader)}>
              <span {...stylex.props(bell.sectionLabel)}>ACTIVE NOTIFICATIONS</span>
            </div>

            {notificationsError ? (
              <p {...stylex.props(bell.error)}>{notificationsError}</p>
            ) : scoped.length > 0 ? (
              scoped.map((notification) => (
                <article {...stylex.props(bell.inboxCard)} key={notification.id}>
                  <span {...stylex.props(bell.eventGlyph)} aria-hidden="true">
                    !
                  </span>
                  <span {...stylex.props(bell.cardText)}>
                    <Link
                      to={notification.url}
                      {...stylex.props(bell.eventLink)}
                      onClick={() => setOpen(false)}
                    >
                      <strong {...stylex.props(bell.cardTitle)}>{notification.sessionTitle}</strong>
                      <span {...stylex.props(bell.cardDetail)}>{notification.body}</span>
                    </Link>
                    <span {...stylex.props(bell.eventMeta)}>
                      <span>notification</span>
                      <span>{notification.title}</span>
                    </span>
                  </span>
                  <time {...stylex.props(bell.eventTime)} dateTime={notification.createdAt}>
                    {formatMessageTime(notification.createdAt) || notification.createdAt}
                  </time>
                  <button
                    {...stylex.props(bell.dismiss)}
                    type="button"
                    aria-label={`Dismiss notification from ${notification.sessionTitle}`}
                    onClick={() => void dismissNotification(notification.id)}
                  >
                    ×
                  </button>
                </article>
              ))
            ) : (
              <p {...stylex.props(bell.empty)}>
                {notificationsLoaded
                  ? scope === "space" && hasSpace
                    ? `No active notifications for sessions in ${spaceName ?? "this space"}.`
                    : "No active notifications."
                  : "Loading…"}
              </p>
            )}
          </div>

          <footer {...stylex.props(bell.footer)}>
            <div {...stylex.props(bell.tabs)} role="tablist" aria-label="Notification scope">
              <button
                {...stylex.props(
                  bell.tab,
                  scope === "space" && bell.tabActive,
                  !hasSpace && bell.tabDisabled,
                )}
                type="button"
                role="tab"
                aria-selected={scope === "space"}
                disabled={!hasSpace}
                onClick={() => selectScope("space")}
              >
                This space
                <span {...stylex.props(bell.tabCount, scope === "space" && bell.tabCountActive)}>
                  {hasSpace ? spaceCount : "—"}
                </span>
              </button>
              <button
                {...stylex.props(bell.tab, scope === "all" && bell.tabActive)}
                type="button"
                role="tab"
                aria-selected={scope === "all"}
                onClick={() => selectScope("all")}
              >
                All Say To Me
                <span {...stylex.props(bell.tabCount, scope === "all" && bell.tabCountActive)}>
                  {allCount}
                </span>
              </button>
            </div>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
