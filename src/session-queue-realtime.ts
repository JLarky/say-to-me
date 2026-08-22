import {
  SESSION_QUEUE_MULTIPLEX_FLAG_KEY,
  type SessionQueuePortMessage,
  type SessionQueueWorkerMessage,
} from "./session-queue-realtime-protocol.ts";

export { SESSION_QUEUE_MULTIPLEX_FLAG_KEY } from "./session-queue-realtime-protocol.ts";

type Handlers = {
  onEvent: (eventType: string, data: string) => void;
  onError?: () => void;
};

export function isSessionQueueMultiplexEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(SESSION_QUEUE_MULTIPLEX_FLAG_KEY) === "0") return false;
  } catch {
    // ignore
  }
  try {
    if (new URLSearchParams(window.location.search).get("sessionQueueMultiplex") === "0") {
      return false;
    }
  } catch {
    // ignore
  }
  return true;
}

function subscribeDirect(sessionId: string, handlers: Handlers): () => void {
  if (typeof EventSource !== "function") {
    handlers.onError?.();
    return () => {};
  }
  const events = new EventSource(`/api/sessions/${sessionId}/events`);
  const onSnapshot = (event: MessageEvent) => {
    handlers.onEvent("snapshot", typeof event.data === "string" ? event.data : "");
  };
  events.addEventListener("snapshot", onSnapshot);
  events.onmessage = onSnapshot;
  events.addEventListener("ping", () => {});
  events.onerror = () => handlers.onError?.();
  return () => {
    events.removeEventListener("snapshot", onSnapshot);
    events.onmessage = null;
    events.onerror = null;
    events.close();
  };
}

function subscribeShared(sessionId: string, handlers: Handlers): () => void {
  const worker = new SharedWorker(new URL("./session-queue-shared-worker.ts", import.meta.url), {
    type: "module",
    name: "say-to-me-session-queues",
  });
  const port = worker.port;
  let closed = false;
  let directCleanup: (() => void) | null = null;

  function fallBack(reason: string): void {
    if (closed || directCleanup) return;
    void reason;
    try {
      port.postMessage({ type: "disconnect" } satisfies SessionQueuePortMessage);
    } catch {
      // ignore
    }
    try {
      port.close();
    } catch {
      // ignore
    }
    directCleanup = subscribeDirect(sessionId, handlers);
  }

  port.onmessage = (messageEvent) => {
    // SAFETY: worker protocol validated by discriminant.
    const message = messageEvent.data as SessionQueueWorkerMessage | undefined;
    if (!message || typeof message !== "object") return;
    if (message.type === "status") {
      if (message.mode === "error") fallBack(message.error || "shared queue worker error");
      return;
    }
    if (message.type === "event" && message.sessionId === sessionId) {
      handlers.onEvent(message.eventType, message.data);
    }
  };
  port.onmessageerror = () => fallBack("shared queue message error");
  worker.onerror = () => fallBack("shared queue worker failed");
  port.start();
  port.postMessage({ type: "subscribe", sessionId } satisfies SessionQueuePortMessage);

  return () => {
    closed = true;
    try {
      port.postMessage({ type: "disconnect" } satisfies SessionQueuePortMessage);
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

export function subscribeSessionQueueRealtime(sessionId: string, handlers: Handlers): () => void {
  if (!isSessionQueueMultiplexEnabled() || typeof SharedWorker === "undefined") {
    return subscribeDirect(sessionId, handlers);
  }
  try {
    return subscribeShared(sessionId, handlers);
  } catch {
    return subscribeDirect(sessionId, handlers);
  }
}
