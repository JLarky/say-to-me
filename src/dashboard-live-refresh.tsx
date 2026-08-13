import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { parseJson, safeResponseJson } from "@say-to-me/runtime-validation";
import { NotificationsPayload, type AppNotification } from "./types.ts";

type LiveRefreshContextValue = {
  notifications: AppNotification[];
  notificationsLoaded: boolean;
  notificationsError: string;
  /** Increments on debounced session/notification SSE signals. */
  refreshToken: number;
  dismissNotification: (notificationId: number) => Promise<void>;
  reloadNotifications: () => Promise<void>;
};

const LiveRefreshContext = createContext<LiveRefreshContextValue | null>(null);

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * Owns one notifications EventSource and exposes a debounced refreshToken that
 * also advances on the sessions SSE stream. Consumers (roster, bell, history)
 * should refetch from APIs when refreshToken changes instead of opening more
 * EventSources or polling per row.
 */
export function DashboardLiveRefreshProvider({
  children,
  onSessionSignal,
}: {
  children: ReactNode;
  /** Optional side-effect when session SSE fires (e.g. refetch spaces). */
  onSessionSignal?: () => void;
}) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const sessionRefreshTimer = useRef<number | null>(null);
  const onSessionSignalRef = useRef(onSessionSignal);
  onSessionSignalRef.current = onSessionSignal;

  const scheduleRefreshBump = useCallback(() => {
    if (sessionRefreshTimer.current !== null) return;
    sessionRefreshTimer.current = window.setTimeout(() => {
      sessionRefreshTimer.current = null;
      setRefreshToken((value) => value + 1);
      onSessionSignalRef.current?.();
    }, 1000);
  }, []);

  const reloadNotifications = useCallback(async () => {
    setNotificationsError("");
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
      setNotificationsError(`Unable to load notifications: ${errorMessage(error)}`);
      setNotificationsLoaded(true);
    }
  }, []);

  const dismissNotification = useCallback(
    async (notificationId: number) => {
      setNotifications((items) => items.filter((item) => item.id !== notificationId));
      setNotificationsError("");
      try {
        const response = await fetch(`/api/notifications/${notificationId}`, { method: "DELETE" });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          setNotificationsError(
            `Unable to dismiss notification: HTTP ${response.status}${text ? ` - ${text.slice(0, 180)}` : ""}`,
          );
          void reloadNotifications();
          return;
        }
        const payload = await safeResponseJson(response, NotificationsPayload);
        setNotifications(payload.notifications);
        setNotificationsLoaded(true);
        scheduleRefreshBump();
      } catch (error) {
        setNotificationsError(`Unable to dismiss notification: ${errorMessage(error)}`);
        void reloadNotifications();
      }
    },
    [reloadNotifications, scheduleRefreshBump],
  );

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      void reloadNotifications();
      return;
    }

    const notificationEvents = new EventSource("/api/notifications/events");
    // Signal-only: snapshot bodies are ignored (we bump refreshToken and refetch
    // /api/spaces). Omit includeCachedStatus / jarvisOverviewDetails so list
    // broadcasts stay cheap.
    const sessionEvents = new EventSource("/api/sessions/events");

    function applyNotificationSnapshot(event: MessageEvent) {
      try {
        const payload = parseJson(NotificationsPayload, event.data);
        setNotifications(payload.notifications);
        setNotificationsLoaded(true);
        setNotificationsError("");
        scheduleRefreshBump();
      } catch (error) {
        setNotificationsError(`Live notification payload was invalid: ${errorMessage(error)}`);
      }
    }

    notificationEvents.addEventListener("snapshot", applyNotificationSnapshot);
    notificationEvents.onmessage = applyNotificationSnapshot;
    notificationEvents.onerror = () => {
      setNotificationsError("Live notifications disconnected.");
      void reloadNotifications();
    };

    sessionEvents.addEventListener("snapshot", () => scheduleRefreshBump());
    sessionEvents.onmessage = () => scheduleRefreshBump();
    sessionEvents.onerror = () => scheduleRefreshBump();

    return () => {
      notificationEvents.close();
      sessionEvents.close();
      if (sessionRefreshTimer.current !== null) {
        window.clearTimeout(sessionRefreshTimer.current);
      }
    };
  }, [reloadNotifications, scheduleRefreshBump]);

  const value = useMemo(
    () => ({
      notifications,
      notificationsLoaded,
      notificationsError,
      refreshToken,
      dismissNotification,
      reloadNotifications,
    }),
    [
      notifications,
      notificationsLoaded,
      notificationsError,
      refreshToken,
      dismissNotification,
      reloadNotifications,
    ],
  );

  return <LiveRefreshContext.Provider value={value}>{children}</LiveRefreshContext.Provider>;
}

export function useDashboardLiveRefresh(): LiveRefreshContextValue {
  const value = useContext(LiveRefreshContext);
  if (!value) {
    throw new Error("useDashboardLiveRefresh requires DashboardLiveRefreshProvider");
  }
  return value;
}

export function useOptionalDashboardLiveRefresh(): LiveRefreshContextValue | null {
  return useContext(LiveRefreshContext);
}
