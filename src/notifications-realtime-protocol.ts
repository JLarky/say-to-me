/** Shared protocol + fan-out helpers for the notifications SharedWorker tracer. */

export const NOTIFICATIONS_EVENTS_URL = "/api/notifications/events";

/** Set localStorage value to `"0"` (or `?sharedNotifications=0`) to force direct EventSource. */
export const SHARED_NOTIFICATIONS_FLAG_KEY = "say-to-me:shared-notifications-worker";

export type NotificationsRealtimeMode = "shared" | "direct" | "connecting" | "error";

export type NotificationsRealtimeStatus = {
  mode: NotificationsRealtimeMode;
  clientCount: number;
  error: string | null;
};

export type WorkerToClientMessage =
  | {
      type: "status";
      mode: NotificationsRealtimeMode;
      clientCount: number;
      error?: string;
    }
  | { type: "event"; eventType: string; data: string };

export type ClientToWorkerMessage = { type: "ping" } | { type: "disconnect" };

export type PortLike = {
  postMessage: (data: WorkerToClientMessage) => void;
};

export type NotificationsFanOut = {
  addPort: (port: PortLike) => number;
  removePort: (port: PortLike) => number;
  fanEvent: (eventType: string, data: string) => void;
  broadcastStatus: (mode: NotificationsRealtimeMode, clientCount: number, error?: string) => void;
  getLastEvent: () => { eventType: string; data: string } | null;
  getClientCount: () => number;
};

/** In-memory fan-out used by the SharedWorker (and unit tests). */
export function createNotificationsFanOut(): NotificationsFanOut {
  const ports = new Set<PortLike>();
  let lastEvent: { eventType: string; data: string } | null = null;

  function safePost(port: PortLike, message: WorkerToClientMessage): void {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }

  function broadcast(message: WorkerToClientMessage): void {
    // Snapshot: safePost may delete a dead port from `ports` while iterating.
    for (const port of [...ports]) {
      safePost(port, message);
    }
  }

  return {
    addPort(port) {
      ports.add(port);
      return ports.size;
    },
    removePort(port) {
      ports.delete(port);
      return ports.size;
    },
    fanEvent(eventType, data) {
      lastEvent = { eventType, data };
      broadcast({ type: "event", eventType, data });
    },
    broadcastStatus(mode, clientCount, error) {
      const message: WorkerToClientMessage =
        error != null && error !== ""
          ? { type: "status", mode, clientCount, error }
          : { type: "status", mode, clientCount };
      broadcast(message);
    },
    getLastEvent() {
      return lastEvent;
    },
    getClientCount() {
      return ports.size;
    },
  };
}

export const MULTI_TAB_CAPACITY_NOTICE =
  "Opening many live session tabs at once can delay new tabs while realtime connections are busy. If a new tab stays blank or Untitled, close an unused Say To Me tab to free capacity, then try again.";

export function formatNotificationsRealtimeHint(status: NotificationsRealtimeStatus): string {
  if (status.mode === "shared") {
    return status.clientCount > 1
      ? `Realtime notifications: shared across ${status.clientCount} clients.`
      : "Realtime notifications: shared worker connected.";
  }
  if (status.mode === "connecting") {
    return "Realtime notifications: connecting…";
  }
  if (status.mode === "error") {
    return status.error
      ? `Realtime notifications unavailable (${status.error}). Reloading the page retries; live updates may use a direct connection.`
      : "Realtime notifications unavailable. Reloading the page retries.";
  }
  return "Realtime notifications: direct connection (shared worker off or unavailable).";
}
