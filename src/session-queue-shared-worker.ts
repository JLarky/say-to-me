/// <reference lib="webworker" />

import { type } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";

import {
  SESSION_QUEUE_MULTIPLEX_URL,
  type SessionQueuePortMessage,
  type SessionQueueWorkerMessage,
} from "./session-queue-realtime-protocol.ts";

const QueueRouteHint = type({
  "targetSessionId?": "string",
  "session?": type({ "id?": "string" }).or("null"),
});

declare const self: SharedWorkerGlobalScope;

type PortState = {
  port: MessagePort;
  sessionId: string | null;
};

const ports = new Set<PortState>();
let eventSource: EventSource | null = null;
let connectedIds: string[] = [];

function post(port: MessagePort, message: SessionQueueWorkerMessage): void {
  try {
    port.postMessage(message);
  } catch {
    // ignore
  }
}

function broadcastStatus(mode: "shared" | "connecting" | "error", error?: string): void {
  const message: SessionQueueWorkerMessage = error
    ? { type: "status", mode, sessionIds: connectedIds, error }
    : { type: "status", mode, sessionIds: connectedIds };
  for (const state of ports) post(state.port, message);
}

function desiredSessionIds(): string[] {
  const ids = new Set<string>();
  for (const state of ports) {
    if (state.sessionId) ids.add(state.sessionId);
  }
  return [...ids].sort();
}

function idsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function ensureEventSource(): void {
  const nextIds = desiredSessionIds();
  if (nextIds.length === 0) {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    connectedIds = [];
    return;
  }
  if (eventSource && idsEqual(connectedIds, nextIds)) return;

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  connectedIds = nextIds;
  const url = `${SESSION_QUEUE_MULTIPLEX_URL}?ids=${encodeURIComponent(nextIds.join(","))}`;
  broadcastStatus("connecting");
  try {
    eventSource = new EventSource(url);
  } catch (error) {
    broadcastStatus("error", error instanceof Error ? error.message : String(error));
    return;
  }

  function handlePayload(eventType: string, raw: string): void {
    const parsed = safeJsonParse(QueueRouteHint, raw);
    if (!parsed) return;
    const sessionId = parsed.targetSessionId || parsed.session?.id || "";
    if (!sessionId) return;
    const message: SessionQueueWorkerMessage = {
      type: "event",
      sessionId,
      eventType,
      data: raw,
    };
    for (const state of ports) {
      if (state.sessionId === sessionId) post(state.port, message);
    }
    broadcastStatus("shared");
  }

  eventSource.addEventListener("snapshot", (event) => {
    handlePayload("snapshot", typeof event.data === "string" ? event.data : "");
  });
  eventSource.onmessage = (event) => {
    handlePayload("message", typeof event.data === "string" ? event.data : "");
  };
  eventSource.addEventListener("ping", () => {
    broadcastStatus("shared");
  });
  eventSource.onerror = () => {
    broadcastStatus("connecting", "upstream reconnecting");
  };
}

self.onconnect = (event) => {
  const port = event.ports[0];
  if (!port) return;
  const state: PortState = { port, sessionId: null };
  ports.add(state);
  post(port, { type: "status", mode: "connecting", sessionIds: connectedIds });

  port.onmessage = (messageEvent) => {
    // SAFETY: messages are validated by discriminant below.
    const message = messageEvent.data as SessionQueuePortMessage | undefined;
    if (!message || typeof message !== "object") return;
    if (message.type === "subscribe") {
      state.sessionId = message.sessionId;
      ensureEventSource();
      return;
    }
    if (message.type === "unsubscribe") {
      state.sessionId = null;
      ensureEventSource();
      return;
    }
    if (message.type === "disconnect") {
      ports.delete(state);
      ensureEventSource();
    }
  };
  port.start();
};
