import { type as arktype } from "arktype";
import { isIdleNoticeText } from "@say-to-me/session-utils/idle-notices";
import { formatArkErrors } from "@say-to-me/runtime-validation";
import { createExternalCliDeliveryInternalDispatcher } from "../external-cli/delivery-internal.ts";
import { workerVersion } from "../external-cli/worker-env.ts";
import {
  cancelCursorDeliveryJobFromWorker,
  claimCursorDeliveryJobForWorker,
  completeCursorDeliveryJobFromWorker,
  failCursorDeliveryJobFromWorker,
  markCursorDeliveryJobDispatchedFromWorker,
  markCursorDeliveryJobCliTurnEndedFromWorker,
  markCursorDeliveryJobUnconfirmedFromWorker,
  renewCursorDeliveryJobFromWorker,
  retryCursorDeliveryJobFromWorker,
  type CursorDeliveryLease,
} from "../cursor/durable-delivery.ts";
import { scheduleCursorBooWorkerReplacement } from "../external-cli/providers.ts";
import { internalApiToken } from "../claude/internal-api-token.ts";
import { insertMessageRow } from "../messages.ts";
import { broadcastQueue } from "../broadcast.ts";
import { isCursorSessionId } from "../session-id.ts";
import { ensureSession } from "../sessions.ts";

export type { CursorDeliveryLease };

const ProgressBody = arktype({
  cursorSessionId: "string",
  text: "string",
});

const dispatchCursorDeliveryInternal =
  createExternalCliDeliveryInternalDispatcher<CursorDeliveryLease>({
    backendLabel: "Cursor",
    basePath: "/api/internal/cursor-delivery",
    sessionIdField: "cursorSessionId",
    sessionIdLeaseField: "cursorSessionId",
    workerVersion: workerVersion("CURSOR"),
    scheduleWorkerReplacement: scheduleCursorBooWorkerReplacement,
    claimDeliveryJobForWorker: claimCursorDeliveryJobForWorker,
    completeDeliveryJobFromWorker: completeCursorDeliveryJobFromWorker,
    retryDeliveryJobFromWorker: retryCursorDeliveryJobFromWorker,
    failDeliveryJobFromWorker: failCursorDeliveryJobFromWorker,
    markDeliveryJobDispatchedFromWorker: markCursorDeliveryJobDispatchedFromWorker,
    markDeliveryJobCliTurnEndedFromWorker: markCursorDeliveryJobCliTurnEndedFromWorker,
    markDeliveryJobUnconfirmedFromWorker: markCursorDeliveryJobUnconfirmedFromWorker,
    cancelDeliveryJobFromWorker: cancelCursorDeliveryJobFromWorker,
    renewDeliveryJobFromWorker: renewCursorDeliveryJobFromWorker,
  });

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * Mid-turn stream-json assistant text. Does not end the CLI turn, reopen a
 * prompt, or count as idle — idle is still `cursor-agent -p` process-end.
 */
async function dispatchCursorStreamProgress(request: Request): Promise<Response> {
  const token = internalApiToken();
  if (!token || request.headers.get("x-say-to-me-internal-token") !== token) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Expected JSON object body." }, { status: 400 });
  }
  const body = ProgressBody(raw);
  if (body instanceof arktype.errors) {
    return json({ error: formatArkErrors(body) }, { status: 400 });
  }
  if (!isCursorSessionId(body.cursorSessionId)) {
    return json({ error: "Invalid Cursor session id." }, { status: 400 });
  }
  const text = body.text.trim();
  if (!text || isIdleNoticeText(text)) {
    return json({ ok: true });
  }
  ensureSession(body.cursorSessionId);
  insertMessageRow({
    sessionId: body.cursorSessionId,
    text,
    extraMarkdown: null,
    author: "agent",
    status: "received",
    links: null,
    sessionRefs: JSON.stringify([{ id: body.cursorSessionId }]),
    clientMessageId: null,
  });
  broadcastQueue(body.cursorSessionId);
  return json({ ok: true });
}

export async function dispatchCursorDeliveryInternalRequest(
  request: Request,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/internal/cursor-delivery/progress") {
    return dispatchCursorStreamProgress(request);
  }
  return dispatchCursorDeliveryInternal(request);
}
