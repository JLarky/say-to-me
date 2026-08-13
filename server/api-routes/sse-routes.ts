import {
  addAgentListener,
  registerQueueSseClient,
  registerSessionListSseClient,
  removeAgentListener,
  unregisterQueueSseClient,
  unregisterSessionListSseClient,
  writeQueueSnapshot,
  writeSessionsSnapshot,
} from "../broadcast.ts";
import { enableOpenCodeActivityPreview } from "../config.ts";
import { subscribeExternalCliActivity } from "../external-cli/activity-snapshot.ts";
import { getMessage } from "../messages.ts";
import { addNotificationClient, removeNotificationClient } from "../notification-history.ts";
import { createOpenCodeActivityEventsResponse } from "../opencode/activity-routes.ts";
import { normalizeSessionId } from "../session-id.ts";
import { ensureSession } from "../sessions.ts";
import { formatSseEvent, sseSnapshotFrame, startSseHeartbeat } from "../sse/client.ts";
import { createSseWebResponse } from "../sse/stream.ts";
import type { SseClient } from "../sse/client.ts";

type QueueSnapshotWriter = (client: SseClient, sessionId?: string) => Promise<void>;

function writeSessionSseFrame(client: SseClient, chunk: string): void {
  void Promise.resolve(client.write(chunk)).catch(() => {});
}

export function startQueueSseClient(
  client: SseClient,
  sessionId: string,
  {
    heartbeat = true,
    writeSnapshot = writeQueueSnapshot,
  }: { heartbeat?: boolean; writeSnapshot?: QueueSnapshotWriter } = {},
): () => void {
  let closed = false;
  let stopHeartbeat: (() => void) | undefined;
  const unsubscribeActivity = subscribeExternalCliActivity(sessionId, 8, {
    onSnapshot: (externalCliActivity) => {
      if (!closed) writeSessionSseFrame(client, sseSnapshotFrame({ externalCliActivity }));
    },
    onError: () => {
      if (!closed) writeSessionSseFrame(client, sseSnapshotFrame({ externalCliActivity: null }));
    },
  });
  void writeSnapshot(client, sessionId)
    .then(() => {
      if (closed) return;
      if (heartbeat) stopHeartbeat = startSseHeartbeat(client);
      registerQueueSseClient(sessionId, client);
    })
    .catch(() => {});
  return () => {
    closed = true;
    stopHeartbeat?.();
    unsubscribeActivity();
    unregisterQueueSseClient(sessionId, client);
  };
}

function sessionListEventsResponse(url: URL): Response {
  const includeCachedStatus = url.searchParams.get("includeCachedStatus") === "1";
  const includeJarvisOverviewDetails = url.searchParams.get("jarvisOverviewDetails") === "1";

  return createSseWebResponse(
    (client) => {
      writeSessionsSnapshot(client, { includeCachedStatus, includeJarvisOverviewDetails });
      const stopHeartbeat = startSseHeartbeat(client);
      registerSessionListSseClient(client, { includeCachedStatus, includeJarvisOverviewDetails });
      return () => {
        stopHeartbeat();
        unregisterSessionListSseClient(client);
      };
    },
    { kind: "session-list" },
  );
}

function notificationEventsResponse(): Response {
  return createSseWebResponse(
    (client) => {
      const stopHeartbeat = startSseHeartbeat(client);
      addNotificationClient(client);
      return () => {
        stopHeartbeat();
        removeNotificationClient(client);
      };
    },
    { kind: "notifications" },
  );
}

function sessionQueueEventsResponse(sessionId: string): Response {
  return createSseWebResponse((client) => startQueueSseClient(client, sessionId), {
    kind: "queue",
  });
}

function agentEventsResponse(sessionId: string): Response {
  ensureSession(sessionId);
  return createSseWebResponse(
    (client) => {
      void client.write(formatSseEvent({ ok: true, sessionId }));
      addAgentListener(sessionId);
      return () => removeAgentListener(sessionId);
    },
    { retry: false, accelBuffering: false, kind: "agent" },
  );
}

function messageAgentEventsResponse(messageId: number): Response | null {
  const message = getMessage(messageId);
  if (!message || message.author !== "agent" || message.parentId !== null) return null;

  return createSseWebResponse(
    (client) => {
      void client.write(formatSseEvent({ ok: true, sessionId: message.sessionId, messageId }));
      addAgentListener(message.sessionId);
      return () => removeAgentListener(message.sessionId);
    },
    { retry: false, accelBuffering: false, kind: "message-agent" },
  );
}

export async function dispatchSseApiRequest(request: Request): Promise<Response | null> {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/sessions/events") return sessionListEventsResponse(url);
  if (pathname === "/api/notifications/events") return notificationEventsResponse();
  if (pathname === "/api/events") {
    return createSseWebResponse(
      (client) => startQueueSseClient(client, "default", { heartbeat: false }),
      { retry: false, accelBuffering: false, kind: "default-events" },
    );
  }

  const sessionEventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (sessionEventsMatch) {
    const sessionId = normalizeSessionId(sessionEventsMatch[1]);
    if (!sessionId) {
      return Response.json({ error: "Invalid session id." }, { status: 400 });
    }
    return sessionQueueEventsResponse(sessionId);
  }

  const sessionAgentEventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/agent-events$/);
  if (sessionAgentEventsMatch) {
    const sessionId = normalizeSessionId(sessionAgentEventsMatch[1]);
    if (!sessionId) {
      return Response.json({ error: "Invalid session id." }, { status: 400 });
    }
    return agentEventsResponse(sessionId);
  }

  const messageAgentEventsMatch = pathname.match(/^\/api\/messages\/(\d+)\/agent-events$/);
  if (messageAgentEventsMatch) {
    const response = messageAgentEventsResponse(Number(messageAgentEventsMatch[1]));
    return response ?? Response.json({ error: "Agent message not found." }, { status: 404 });
  }

  if (enableOpenCodeActivityPreview) {
    const activityEventsMatch = pathname.match(
      /^\/api\/sessions\/([^/]+)\/opencode-activity\/events$/,
    );
    if (activityEventsMatch) {
      const sessionId = normalizeSessionId(activityEventsMatch[1]);
      if (!sessionId) {
        return Response.json({ error: "Invalid session id." }, { status: 400 });
      }
      return createOpenCodeActivityEventsResponse(sessionId);
    }
  }

  return null;
}
