import { useEffect, useState } from "react";

import {
  NOTIFICATIONS_EVENTS_URL,
  SHARED_NOTIFICATIONS_FLAG_KEY,
  type ClientToWorkerMessage,
  type NotificationsRealtimeStatus,
  type WorkerToClientMessage,
} from "./notifications-realtime-protocol.ts";

export {
  formatNotificationsRealtimeHint,
  MULTI_TAB_CAPACITY_NOTICE,
  NOTIFICATIONS_EVENTS_URL,
  SHARED_NOTIFICATIONS_FLAG_KEY,
  type NotificationsRealtimeMode,
  type NotificationsRealtimeStatus,
} from "./notifications-realtime-protocol.ts";

type NotificationsRealtimeHandlers = {
  onEvent: (eventType: string, data: string) => void;
  onError?: () => void;
};

let currentStatus: NotificationsRealtimeStatus = {
  mode: "connecting",
  clientCount: 0,
  error: null,
};
const statusListeners = new Set<(status: NotificationsRealtimeStatus) => void>();

function publishStatus(status: NotificationsRealtimeStatus): void {
  currentStatus = status;
  for (const listener of statusListeners) {
    listener(status);
  }
}

export function getNotificationsRealtimeStatus(): NotificationsRealtimeStatus {
  return currentStatus;
}

export function subscribeNotificationsRealtimeStatus(
  listener: (status: NotificationsRealtimeStatus) => void,
): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

export function useNotificationsRealtimeStatus(): NotificationsRealtimeStatus {
  const [status, setStatus] = useState(getNotificationsRealtimeStatus);
  useEffect(() => subscribeNotificationsRealtimeStatus(setStatus), []);
  return status;
}

export function isSharedNotificationsWorkerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(SHARED_NOTIFICATIONS_FLAG_KEY) === "0") return false;
  } catch {
    // ignore storage access failures
  }
  try {
    if (new URLSearchParams(window.location.search).get("sharedNotifications") === "0") {
      return false;
    }
  } catch {
    // ignore URL parse failures
  }
  return true;
}

function subscribeDirect(handlers: NotificationsRealtimeHandlers): () => void {
  publishStatus({ mode: "direct", clientCount: 1, error: null });
  if (typeof EventSource !== "function") {
    handlers.onError?.();
    return () => {};
  }

  const events = new EventSource(NOTIFICATIONS_EVENTS_URL);

  function onSnapshot(event: MessageEvent): void {
    handlers.onEvent("snapshot", typeof event.data === "string" ? event.data : "");
  }

  events.addEventListener("snapshot", onSnapshot);
  events.onmessage = (event) => {
    handlers.onEvent("message", typeof event.data === "string" ? event.data : "");
  };
  events.onerror = () => {
    handlers.onError?.();
  };

  return () => {
    // Some test doubles only stub addEventListener/close; real EventSource
    // always exposes removeEventListener via EventTarget.
    if (typeof events.removeEventListener === "function") {
      events.removeEventListener("snapshot", onSnapshot);
    }
    events.onmessage = null;
    events.onerror = null;
    events.close();
  };
}

function subscribeShared(handlers: NotificationsRealtimeHandlers): () => void {
  publishStatus({ mode: "connecting", clientCount: 0, error: null });

  const worker = new SharedWorker(new URL("./notifications-shared-worker.ts", import.meta.url), {
    type: "module",
    name: "say-to-me-notifications",
  });
  const port = worker.port;
  let closed = false;
  let directCleanup: (() => void) | null = null;

  function fallBackToDirect(reason: string): void {
    if (closed || directCleanup) return;
    publishStatus({ mode: "error", clientCount: 0, error: reason });
    try {
      port.postMessage({ type: "disconnect" } satisfies ClientToWorkerMessage);
    } catch {
      // ignore
    }
    try {
      port.close();
    } catch {
      // ignore
    }
    directCleanup = subscribeDirect(handlers);
  }

  port.onmessage = (messageEvent) => {
    // SAFETY: SharedWorker protocol messages are validated by `type` discriminant below.
    const message = messageEvent.data as WorkerToClientMessage | undefined;
    if (!message || typeof message !== "object") return;

    if (message.type === "status") {
      publishStatus({
        mode: message.mode,
        clientCount: message.clientCount,
        error: message.error ?? null,
      });
      if (message.mode === "error") {
        fallBackToDirect(message.error || "shared worker error");
        return;
      }
      if (message.error) handlers.onError?.();
      return;
    }

    if (message.type === "event") {
      handlers.onEvent(message.eventType, message.data);
    }
  };

  port.onmessageerror = () => {
    fallBackToDirect("shared worker message error");
  };
  worker.onerror = () => {
    fallBackToDirect("shared worker failed");
  };

  port.start();
  port.postMessage({ type: "ping" } satisfies ClientToWorkerMessage);

  return () => {
    closed = true;
    try {
      port.postMessage({ type: "disconnect" } satisfies ClientToWorkerMessage);
    } catch {
      // ignore
    }
    try {
      port.close();
    } catch {
      // ignore
    }
    directCleanup?.();
  };
}

/**
 * Subscribe to `/api/notifications/events`, preferring one SharedWorker-owned
 * EventSource shared across same-origin tabs. Falls back to a direct EventSource.
 */
export function subscribeNotificationsRealtime(
  handlers: NotificationsRealtimeHandlers,
): () => void {
  if (!isSharedNotificationsWorkerEnabled() || typeof SharedWorker === "undefined") {
    return subscribeDirect(handlers);
  }

  try {
    return subscribeShared(handlers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publishStatus({ mode: "error", clientCount: 0, error: message });
    return subscribeDirect(handlers);
  }
}
