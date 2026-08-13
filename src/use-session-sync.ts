import { type } from "arktype";
import { useEffect, useRef, useState } from "react";

import {
  ExternalCliActivitySnapshot,
  Message,
  Session,
  type ExternalCliActivitySnapshot as ExternalCliActivitySnapshotType,
  type Message as MessageType,
  type Session as SessionType,
} from "./types.ts";
import { safeJsonParse, safeResponseJson } from "@say-to-me/runtime-validation";
import { mergeMessagesWithPending } from "./utils.ts";

export type LiveStatus = "connecting" | "connected" | "quiet" | "reconnecting";

export const SessionSyncPayloadSchema = type({
  "revision?": "number",
  "messages?": Message.array(),
  "session?": Session.or("null"),
  "sessions?": Session.array(),
  "lastNoteFirstLine?": "string | null",
  "externalCliActivity?": ExternalCliActivitySnapshot.or("null"),
});

export type SessionSyncPayload = typeof SessionSyncPayloadSchema.infer;

export function payloadRevision(payload: SessionSyncPayload): number {
  if (Number.isInteger(payload.revision)) return payload.revision!;
  const sessionRevision = payload.session?.revision;
  if (Number.isInteger(sessionRevision)) return sessionRevision!;

  const messageIds = (payload.messages || [])
    .map((message) => (typeof message.id === "number" ? message.id : 0))
    .filter((id) => id > 0);
  return messageIds.length > 0 ? Math.max(...messageIds) : 0;
}

export function shouldApplyPayload(currentRevision: number, payload: SessionSyncPayload): boolean {
  void currentRevision;
  void payload;
  return true;
}

export function useSessionSync({
  initialExternalCliActivity,
  initialLastNoteFirstLine,
  initialMessages,
  initialSession,
  initialSessions,
  onError,
  sessionId,
}: {
  initialExternalCliActivity: ExternalCliActivitySnapshotType | null;
  initialLastNoteFirstLine: string | null;
  initialMessages: MessageType[];
  initialSession: SessionType | null;
  initialSessions: SessionType[];
  onError: (message: string) => void;
  sessionId: string | undefined;
}) {
  const [lastNoteFirstLine, setLastNoteFirstLine] = useState<string | null>(
    initialLastNoteFirstLine,
  );
  const [externalCliActivity, setExternalCliActivity] =
    useState<ExternalCliActivitySnapshotType | null>(initialExternalCliActivity);
  const [messages, setMessages] = useState<MessageType[]>(initialMessages);
  const [session, setSession] = useState<SessionType | null>(initialSession);
  const [sessions, setSessions] = useState<SessionType[]>(initialSessions);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const revisionRef = useRef(
    payloadRevision({
      externalCliActivity: initialExternalCliActivity,
      lastNoteFirstLine: initialLastNoteFirstLine,
      messages: initialMessages,
      session: initialSession,
      sessions: initialSessions,
    }),
  );

  function applyPayload(payload: SessionSyncPayload): boolean {
    if (!shouldApplyPayload(revisionRef.current, payload)) return false;
    revisionRef.current = Math.max(revisionRef.current, payloadRevision(payload));
    if ("messages" in payload) {
      setMessages((current) => mergeMessagesWithPending(payload.messages || [], current));
    }
    if ("session" in payload) setSession(payload.session || null);
    if ("sessions" in payload) setSessions(payload.sessions || []);
    if ("lastNoteFirstLine" in payload) setLastNoteFirstLine(payload.lastNoteFirstLine ?? null);
    if ("externalCliActivity" in payload) {
      setExternalCliActivity(payload.externalCliActivity ?? null);
    }
    return true;
  }

  useEffect(() => {
    revisionRef.current = payloadRevision({
      externalCliActivity: initialExternalCliActivity,
      lastNoteFirstLine: initialLastNoteFirstLine,
      messages: initialMessages,
      session: initialSession,
      sessions: initialSessions,
    });
    setExternalCliActivity(initialExternalCliActivity);
    setLastNoteFirstLine(initialLastNoteFirstLine);
    setMessages(initialMessages);
    setSession(initialSession);
    setSessions(initialSessions);
  }, [
    initialExternalCliActivity,
    initialLastNoteFirstLine,
    initialMessages,
    initialSession,
    initialSessions,
    sessionId,
  ]);

  useEffect(() => {
    if (!sessionId) return;
    let events: EventSource | null = null;
    let closed = false;
    let lastSeenAt = Date.now();
    let sseCount = 0;

    async function refreshSessionMessages() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/messages`);
        if (!response.ok) return;
        applyPayload(await safeResponseJson(response, SessionSyncPayloadSchema));
      } catch (err) {
        console.error("[sse] fallback refresh failed:", err);
      }
    }

    function handleSnapshot(event: MessageEvent) {
      try {
        lastSeenAt = Date.now();
        sseCount += 1;
        const payload = safeJsonParse(SessionSyncPayloadSchema, event.data);
        if (!payload) throw new Error("malformed session sync payload");
        applyPayload(payload);
        setLiveStatus("connected");
        onError("");
      } catch (err) {
        console.error("[sse] snapshot parse failed:", err);
        setLiveStatus("reconnecting");
        onError("Live session update was malformed. Refreshing current state.");
        void refreshSessionMessages();
      }
    }

    function connect() {
      events?.close();
      events = new EventSource(`/api/sessions/${sessionId}/events`);
      setLiveStatus("connecting");
      events.onopen = () => {
        lastSeenAt = Date.now();
        setLiveStatus("connected");
      };
      events.addEventListener("ping", () => {
        lastSeenAt = Date.now();
        setLiveStatus("connected");
      });
      events.addEventListener("snapshot", handleSnapshot);
      events.onmessage = handleSnapshot;
      events.onerror = () => {
        setLiveStatus("reconnecting");
        onError("Lost live session updates. Reconnecting and refreshing periodically.");
        void refreshSessionMessages();
      };
    }

    connect();
    const sseTimer = setInterval(() => {
      if (sseCount > 0) {
        console.log(
          `[sse] ${sessionId}: ${sseCount} events in last 5s (${(sseCount / 5).toFixed(1)}/s)`,
        );
        sseCount = 0;
      }
      const quietMs = Date.now() - lastSeenAt;
      if (!closed && quietMs > 15_000) {
        setLiveStatus("quiet");
      }
      if (!closed && quietMs > 45_000) {
        setLiveStatus("reconnecting");
        onError("Live session updates stalled. Reconnecting and refreshing.");
        void refreshSessionMessages();
        connect();
      }
    }, 5000);
    return () => {
      closed = true;
      events?.close();
      clearInterval(sseTimer);
    };
  }, [onError, sessionId]);

  return {
    applyPayload,
    externalCliActivity,
    lastNoteFirstLine,
    liveStatus,
    messages,
    session,
    sessions,
    setMessages,
    setSession,
    setSessions,
  };
}
