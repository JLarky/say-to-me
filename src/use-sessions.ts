import { type } from "arktype";
import { useCallback, useEffect, useState } from "react";

import {
  ErrorPayload,
  Session,
  SessionPayload,
  type Session as SessionType,
  type SessionState,
} from "./types.ts";
import { safeJsonParse, safeResponseJson } from "@say-to-me/runtime-validation";
import { sessionListLabel } from "./session-label.ts";

const SessionsPayload = type({
  "sessions?": Session.array(),
});

function errorMessage(value: unknown, fallback: string): string {
  try {
    return ErrorPayload.assert(value).error || fallback;
  } catch {
    return fallback;
  }
}

export function useSessions({
  includeCachedStatus = false,
  includeJarvisOverviewDetails = false,
  live = false,
} = {}) {
  const [sessions, setSessions] = useState<SessionType[]>([]);
  const [error, setError] = useState("");

  const refreshSessions = useCallback(async () => {
    const params = new URLSearchParams();
    if (includeCachedStatus) params.set("includeCachedStatus", "1");
    if (includeJarvisOverviewDetails) params.set("jarvisOverviewDetails", "1");
    const query = params.toString();
    const response = await fetch(query ? `/api/sessions?${query}` : "/api/sessions");
    const payload = await safeResponseJson(response, SessionsPayload);
    setSessions(payload.sessions || []);
  }, [includeCachedStatus, includeJarvisOverviewDetails]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!live) return;
    let events: EventSource | null = null;
    let refreshTimer: number | null = null;

    function scheduleRefresh() {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshSessions();
      }, 1000);
    }

    function handleSnapshot(event: MessageEvent) {
      try {
        const payload = safeJsonParse(SessionsPayload, event.data);
        if (!payload) throw new Error("malformed sessions snapshot");
        setSessions(payload.sessions || []);
        setError("");
      } catch (err) {
        console.error("[sessions-sse] snapshot parse failed:", err);
        setError("Live session list update was malformed. Refreshing current state.");
        scheduleRefresh();
      }
    }

    const params = new URLSearchParams();
    if (includeCachedStatus) params.set("includeCachedStatus", "1");
    if (includeJarvisOverviewDetails) params.set("jarvisOverviewDetails", "1");
    const query = params.toString();
    events = new EventSource(query ? `/api/sessions/events?${query}` : "/api/sessions/events");
    events.addEventListener("snapshot", handleSnapshot);
    events.onmessage = handleSnapshot;
    events.onerror = () => {
      setError("Lost live session list updates. Reconnecting and refreshing periodically.");
      scheduleRefresh();
    };

    return () => {
      events?.close();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [includeCachedStatus, includeJarvisOverviewDetails, live, refreshSessions]);

  const deleteSession = useCallback(async (session: SessionType) => {
    if (session.id === "default") return;
    const label = sessionListLabel(session);
    if (
      !window.confirm(
        `Delete session ${label}? This won't delete OpenCode session, so you can open it later, but all Say to Me messages will be gone.`,
      )
    ) {
      return;
    }
    await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
    setSessions((current) => current.filter((s) => s.id !== session.id));
  }, []);

  const updateSessionState = useCallback(async (session: SessionType, state: SessionState) => {
    const response = await fetch(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    const payload = await safeResponseJson(response, SessionPayload);
    if (!response.ok) {
      setError(errorMessage(payload, "Unable to update session."));
      return;
    }
    setError("");
    const updated = SessionPayload.assert(payload).session;
    setSessions((current) =>
      current.some((item) => item.id === session.id)
        ? current.map((item) => (item.id === session.id ? updated : item))
        : [updated, ...current],
    );
    return updated;
  }, []);

  return { sessions, error, setError, refreshSessions, deleteSession, updateSessionState };
}
