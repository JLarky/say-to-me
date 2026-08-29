/// <reference lib="webworker" />

import {
  createNotificationsFanOut,
  NOTIFICATIONS_EVENTS_URL,
  type ClientToWorkerMessage,
  type PortLike,
} from "./notifications-realtime-protocol.ts";

declare const self: SharedWorkerGlobalScope;

const hub = createNotificationsFanOut();
let eventSource: EventSource | null = null;
let upstreamReady = false;

function ensureEventSource(): void {
  if (eventSource) return;

  try {
    eventSource = new EventSource(NOTIFICATIONS_EVENTS_URL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hub.broadcastStatus("error", hub.getClientCount(), message);
    return;
  }

  hub.broadcastStatus("connecting", hub.getClientCount());

  function onPayload(eventType: string, event: MessageEvent): void {
    const data = typeof event.data === "string" ? event.data : "";
    hub.fanEvent(eventType, data);
    if (!upstreamReady) {
      upstreamReady = true;
      hub.broadcastStatus("shared", hub.getClientCount());
    }
  }

  eventSource.addEventListener("snapshot", (event) => {
    onPayload("snapshot", event);
  });
  eventSource.onmessage = (event) => {
    onPayload("message", event);
  };
  eventSource.addEventListener("ping", (event) => {
    onPayload("ping", event);
  });
  eventSource.onopen = () => {
    hub.fanEvent("ping", "");
    if (!upstreamReady) {
      upstreamReady = true;
      hub.broadcastStatus("shared", hub.getClientCount());
    }
  };
  eventSource.onerror = () => {
    if (hub.getClientCount() === 0) return;
    if (eventSource?.readyState === EventSource.CLOSED) {
      hub.broadcastStatus("error", hub.getClientCount(), "upstream closed");
      return;
    }
    hub.broadcastStatus("connecting", hub.getClientCount(), "upstream reconnecting");
  };
}

function closeEventSourceIfIdle(): void {
  if (hub.getClientCount() > 0) return;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  upstreamReady = false;
}

self.onconnect = (event) => {
  const port = event.ports[0];
  if (!port) return;

  const portAdapter: PortLike = {
    postMessage(data) {
      port.postMessage(data);
    },
  };

  hub.addPort(portAdapter);
  ensureEventSource();

  const last = hub.getLastEvent();
  if (last) {
    port.postMessage({ type: "event", eventType: last.eventType, data: last.data });
  }
  port.postMessage({
    type: "status",
    mode: upstreamReady ? "shared" : eventSource ? "connecting" : "error",
    clientCount: hub.getClientCount(),
  });

  port.onmessage = (messageEvent) => {
    // SAFETY: client→worker messages are validated by `type` discriminant below.
    const message = messageEvent.data as ClientToWorkerMessage | undefined;
    if (!message || typeof message !== "object") return;
    if (message.type === "disconnect") {
      hub.removePort(portAdapter);
      closeEventSourceIfIdle();
      if (hub.getClientCount() > 0) {
        hub.broadcastStatus(upstreamReady ? "shared" : "connecting", hub.getClientCount());
      }
      return;
    }
    if (message.type === "ping") {
      port.postMessage({
        type: "status",
        mode: upstreamReady ? "shared" : eventSource ? "connecting" : "error",
        clientCount: hub.getClientCount(),
      });
    }
  };

  port.start();
};
