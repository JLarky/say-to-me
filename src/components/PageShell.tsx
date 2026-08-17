import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { card, hero, shell, text as textStyles } from "../styles/chrome.stylex.ts";
import { controls } from "../styles/controls.stylex.ts";
import { NotificationsPayload, type AppNotification } from "../types.ts";
import { parseJson, safeResponseJson } from "@say-to-me/runtime-validation";
import { formatMessageTime, projectThemeStyle } from "../utils.ts";

type Identity = { color: string; icon: string };

type PageShellProps = {
  /** Project identity. When provided the page is tinted and gets a nested shell.root. */
  identity?: Identity;
  /** Current session id, used to avoid alerting on notifications for the page already in view. */
  currentSessionId?: string;
  /** Eyebrow label above the title. Omit when breadcrumbs or title carry enough context. */
  eyebrow?: string;
  /** When set, renders the back icon-link + inline eyebrow row. */
  backTo?: string;
  backLabel?: string;
  /** Renders after the back icon and before the eyebrow label (e.g. organize breadcrumbs). */
  eyebrowLead?: ReactNode;
  /** Extra controls rendered inline in the eyebrow row (e.g. status controls). */
  eyebrowExtras?: ReactNode;
  /** Hero content below the eyebrow (title cluster, chips, lede). */
  hero?: ReactNode;
  /** Page body — rendered as a sibling of the hero section inside the shell. */
  children?: ReactNode;
};

export function PageShell({
  identity,
  currentSessionId,
  eyebrow,
  backTo,
  backLabel,
  eyebrowLead,
  eyebrowExtras,
  hero: heroContent,
  children,
}: PageShellProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationRinging, setNotificationRinging] = useState(false);
  const newestNotificationIdRef = useRef<number | null>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeNotifications(event: PointerEvent) {
      const container = notificationsRef.current;
      if (!container) return;
      if (event.target instanceof Node && container.contains(event.target)) return;
      setNotificationsOpen(false);
    }

    document.addEventListener("pointerdown", closeNotifications);
    return () => document.removeEventListener("pointerdown", closeNotifications);
  }, []);

  useEffect(() => {
    if (typeof EventSource !== "function") {
      void loadNotifications();
      return;
    }

    const events = new EventSource("/api/notifications/events");

    function applyNotificationSnapshot(event: MessageEvent) {
      try {
        const payload = parseJson(NotificationsPayload, event.data);
        const newest = payload.notifications[0]?.id ?? null;
        if (
          newest != null &&
          newestNotificationIdRef.current != null &&
          newest > newestNotificationIdRef.current &&
          payload.notifications[0]?.sessionId !== currentSessionId
        ) {
          setNotificationRinging(false);
          requestAnimationFrame(() => setNotificationRinging(true));
        }
        newestNotificationIdRef.current = newest;
        setNotifications(payload.notifications);
        setNotificationsLoaded(true);
        setNotificationsError("");
      } catch (error) {
        console.error("[notifications] snapshot parse failed:", error);
        setNotificationsError(`Live notification payload was invalid: ${errorMessage(error)}`);
      }
    }

    events.addEventListener("snapshot", applyNotificationSnapshot);
    events.onmessage = applyNotificationSnapshot;
    events.onerror = () => {
      setNotificationsError("Live notifications disconnected.");
      void loadNotifications();
    };

    return () => events.close();
  }, [currentSessionId]);

  useEffect(() => {
    if (!notificationRinging) return;
    const timer = setTimeout(() => setNotificationRinging(false), 1200);
    return () => clearTimeout(timer);
  }, [notificationRinging]);

  async function loadNotifications() {
    setNotificationsError("");
    setNotificationsLoaded(false);
    try {
      const response = await fetch("/api/notifications");
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        setNotificationsError(
          `Unable to load notifications: HTTP ${response.status}${text ? ` - ${text.slice(0, 180)}` : ""}`,
        );
        setNotificationsLoaded(true);
        return;
      }
      const payload = await safeResponseJson(response, NotificationsPayload);
      setNotifications(payload.notifications);
      setNotificationsLoaded(true);
    } catch (error) {
      console.error("[notifications] fetch failed:", error);
      setNotificationsError(`Unable to load notifications: ${errorMessage(error)}`);
      setNotificationsLoaded(true);
      return;
    }
  }

  async function dismissNotification(notificationId: number) {
    setNotifications((items) => items.filter((notification) => notification.id !== notificationId));
    setNotificationsError("");
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, { method: "DELETE" });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        setNotificationsError(
          `Unable to dismiss notification: HTTP ${response.status}${text ? ` - ${text.slice(0, 180)}` : ""}`,
        );
        void loadNotifications();
        return;
      }
      const payload = await safeResponseJson(response, NotificationsPayload);
      setNotifications(payload.notifications);
      setNotificationsLoaded(true);
    } catch (error) {
      console.error("[notifications] dismiss failed:", error);
      setNotificationsError(`Unable to dismiss notification: ${errorMessage(error)}`);
      void loadNotifications();
    }
  }

  function toggleNotifications() {
    setNotificationsOpen((open) => {
      const nextOpen = !open;
      if (nextOpen && !notificationsLoaded) void loadNotifications();
      return nextOpen;
    });
  }

  const inner = (
    <>
      <section {...stylex.props(card.base, card.allowOverflow, hero.root)}>
        <div {...stylex.props(hero.copy)}>
          {backTo != null ? (
            <div {...stylex.props(hero.eyebrowRow)}>
              <Link aria-label={backLabel} {...stylex.props(controls.iconLink)} to={backTo}>
                <span aria-hidden="true">⌂</span>
              </Link>
              {eyebrowLead}
              {eyebrow ? (
                <p {...stylex.props(textStyles.eyebrow, textStyles.eyebrowInline)}>{eyebrow}</p>
              ) : null}
              {eyebrowExtras}
            </div>
          ) : eyebrow ? (
            <p {...stylex.props(textStyles.eyebrow)}>{eyebrow}</p>
          ) : null}
          {heroContent}
        </div>
        <div ref={notificationsRef} {...stylex.props(hero.notifications)}>
          <button
            {...stylex.props(
              controls.iconLink,
              hero.notificationButton,
              notificationRinging && hero.notificationButtonRinging,
            )}
            type="button"
            aria-expanded={notificationsOpen}
            aria-haspopup="menu"
            onClick={toggleNotifications}
          >
            <span aria-hidden="true">🔔</span>
            <span {...stylex.props(hero.notificationLabel)}>Notifications</span>
          </button>
          {notificationsOpen ? (
            <div {...stylex.props(hero.notificationMenu)} role="menu">
              <strong {...stylex.props(hero.notificationTitle)}>Notifications</strong>
              {notificationsError ? (
                <p {...stylex.props(hero.notificationEmpty)}>{notificationsError}</p>
              ) : notifications.length > 0 ? (
                <ol {...stylex.props(hero.notificationList)}>
                  {notifications.map((notification) => (
                    <li key={notification.id} {...stylex.props(hero.notificationItem)}>
                      <div {...stylex.props(hero.notificationItemHeader)}>
                        <span {...stylex.props(hero.notificationSession)}>
                          {notification.sessionTitle}
                        </span>
                        <button
                          type="button"
                          {...stylex.props(hero.notificationDismiss)}
                          aria-label={`Dismiss notification from ${notification.sessionTitle}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void dismissNotification(notification.id);
                          }}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </div>
                      <Link
                        to={notification.url}
                        {...stylex.props(hero.notificationLink)}
                        onClick={() => setNotificationsOpen(false)}
                      >
                        {notification.body}
                      </Link>
                      <time
                        {...stylex.props(hero.notificationTime)}
                        dateTime={notification.createdAt}
                      >
                        {formatNotificationTimestamp(notification.createdAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p {...stylex.props(hero.notificationEmpty)}>
                  {notificationsLoaded ? "No notifications yet." : "Loading..."}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>
      {children}
    </>
  );

  if (identity) {
    return (
      <main style={projectThemeStyle(identity)} {...stylex.props(shell.tinted)}>
        <div {...stylex.props(shell.root)}>{inner}</div>
      </main>
    );
  }

  return <main {...stylex.props(shell.root)}>{inner}</main>;
}

function formatNotificationTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const exact = date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const relative = formatMessageTime(value);
  return relative ? `${exact} (${relative})` : exact;
}

function errorMessage(cause: unknown) {
  const error = cause;
  return error instanceof Error && error.message ? error.message : String(error);
}
