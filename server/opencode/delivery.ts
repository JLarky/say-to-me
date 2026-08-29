import { spawn } from "node:child_process";
import { broadcastQueue } from "../broadcast.ts";
import { DbMessage } from "../db/schemas.ts";
import { insertAttachmentForMessage, listAttachmentsForMessage } from "../images.ts";
import {
  getMessage,
  insertForwardMessageRow,
  insertMessageRow,
  listQueuedOpencodeDeliveries,
  markCompletionWorkSeen,
  setMessageMergedInto,
  updateForwardStatus,
  updateForwardTarget,
  updateOpencodeDelivery,
} from "../messages.ts";
import {
  formatContinueAttributionLine,
  formatIdleContinueBody,
  isAttributedIdleStoredText,
  isIdleContinueNoticeText,
  isIdleNoticeText,
  parseMessageCreatedAt,
} from "@say-to-me/session-utils/idle-notices";
import { validateSessionId } from "../session-id.ts";
import { getSession, requireSession } from "../sessions.ts";
import {
  inspectOpenCodeActivityRuntime,
  waitForOpenCodeWorkingActivity,
} from "./activity-routes.ts";
import { getOpenCodeStatus } from "./client.ts";
import { resumeCompletionWatches, startCompletionWatch } from "./completion-watch.ts";
import { isLiveCompletionWatchStatus } from "@say-to-me/completion-watch/workflow";
import { createOpenCodeClient, openCodeBaseUrl, openCodeFetch } from "./http.ts";
import { classifyCliTimeoutFromActivity } from "./timeout-classification.ts";
import { buildAgentVoicePromptFromMessage, idleTargetFromMessage } from "../agent-voice-prompt.ts";
import { opencodeReasoningEffortCliArg, readOpenCodeSessionVariant } from "./reasoning-effort.ts";

export const QUEUED_DELIVERY_STATUS = "queued";

function lookupSessionAlias(sessionId: string): string | null {
  return getSession(sessionId)?.alias ?? null;
}

function buildOpenCodeUserMessage(
  sessionId: string,
  reply: Pick<
    DbMessage,
    | "text"
    | "createdAt"
    | "sessionId"
    | "sessionRefs"
    | "forwardRole"
    | "forwardSourceSessionId"
    | "forwardTargetSessionId"
  >,
  imagePaths: string[],
): string {
  // The agent reads image attachments as /tmp paths in the prompt text, so append
  // any not already inlined there (deduped, so an inline path isn't repeated).
  const missing = imagePaths.filter((filePath) => !reply.text.includes(filePath));
  const body = missing.length > 0 ? `${reply.text}\n${missing.join("\n")}` : reply.text;
  return buildAgentVoicePromptFromMessage(
    sessionId,
    { ...reply, text: body },
    { lookupAlias: lookupSessionAlias },
  );
}

function combinedQueuedText(sessionId: string, pending: DbMessage[]): string {
  if (pending.length > 1 && pending.every((reply) => isIdleContinueNoticeText(reply.text))) {
    return pending
      .map((reply) => {
        if (isAttributedIdleStoredText(reply.text)) return reply.text.trim();
        const target = idleTargetFromMessage(sessionId, reply);
        const alias = target ? (lookupSessionAlias(target.id) ?? target.alias) : null;
        const body = target ? formatIdleContinueBody(target.id, alias) : reply.text;
        return formatContinueAttributionLine(
          sessionId,
          body,
          parseMessageCreatedAt(reply.createdAt),
        );
      })
      .join("\n");
  }
  return pending.map((reply) => reply.text).join("\n\n");
}

function listOpenCodeAttachmentPaths(messageId: number): string[] {
  return listAttachmentsForMessage(messageId)
    .filter(
      (attachment) =>
        attachment.mimeType === "text/markdown" || attachment.mimeType.startsWith("image/"),
    )
    .map((attachment) => attachment.filePath);
}

export async function deliverReplyToOpencode(
  sessionId: string,
  reply: DbMessage,
  { useCli = false, baseUrl }: { useCli?: boolean; baseUrl?: string } = {},
): Promise<void> {
  if (!validateSessionId(sessionId)) return;

  updateOpencodeDelivery(reply.id, "pending", null, null);
  if (isLiveCompletionWatchStatus(reply.completionWatchStatus)) markCompletionWorkSeen(reply.id);
  broadcastQueue(sessionId);
  const deliveryStartedAt = Date.now();

  try {
    if (useCli) {
      await deliverReplyToOpencodeViaCli(sessionId, reply);
    } else {
      await deliverReplyToOpencodeViaApi(sessionId, reply, baseUrl);
    }
  } catch (error) {
    if (error instanceof OpenCodeCliTimeoutError) {
      const currentStatus = await getOpenCodeStatus(sessionId, { baseUrl });
      const status = classifyCliTimeoutFromActivity(
        inspectOpenCodeActivityRuntime(sessionId),
        deliveryStartedAt,
        currentStatus,
      );
      updateOpencodeDelivery(reply.id, status, status === "pending" ? null : error.message, null);
      const delivered = getMessage(reply.id);
      if (
        status === "pending" &&
        delivered &&
        isLiveCompletionWatchStatus(delivered.completionWatchStatus)
      ) {
        startCompletionWatch(delivered.id);
      }
      broadcastQueue(sessionId);
      return;
    }

    if (error instanceof OpenCodeCliActivityConfirmedError) {
      updateOpencodeDelivery(reply.id, "sent", null, null);
      const delivered = getMessage(reply.id);
      if (delivered && isLiveCompletionWatchStatus(delivered.completionWatchStatus)) {
        startCompletionWatch(delivered.id);
      }
      broadcastQueue(sessionId);
      return;
    }

    updateOpencodeDelivery(
      reply.id,
      "failed",
      (error as Error).message || "OpenCode delivery failed",
      null,
    );
  }

  const delivered = getMessage(reply.id);
  if (
    (delivered?.opencodeDeliveryStatus === "sent" ||
      delivered?.opencodeDeliveryStatus === "pending") &&
    isLiveCompletionWatchStatus(delivered.completionWatchStatus)
  ) {
    startCompletionWatch(delivered.id);
  }
  broadcastQueue(sessionId);
}

const inFlightDeliveries = new Set<number>();

function isForwardIdleNotification(reply: DbMessage): boolean {
  return reply.forwardRole === "target" && isIdleNoticeText(reply.text);
}

export type QueuedDeliveryResult = {
  combined: DbMessage;
  pending: DbMessage[];
};

export async function flushQueuedOpencodeDeliveriesIfIdle(
  sessionId: string,
): Promise<QueuedDeliveryResult | null> {
  if (!validateSessionId(sessionId)) return null;

  const queued = listQueuedOpencodeDeliveries(sessionId);
  if (queued.every((reply) => inFlightDeliveries.has(reply.id))) return null;

  if ((await getOpenCodeStatus(sessionId)) !== "idle") return null;

  return deliverQueuedAsNewMessage(sessionId, queued);
}

export async function deliverQueuedAsNewMessage(
  sessionId: string,
  replies: DbMessage[],
): Promise<QueuedDeliveryResult | null> {
  const pending = replies.filter((reply) => !inFlightDeliveries.has(reply.id));
  if (pending.length === 0) return null;
  if (pending.length > 1 && pending.some((reply) => reply.completionWatchStatus)) {
    let delivered: QueuedDeliveryResult | null = null;
    for (const reply of pending) delivered = await deliverQueuedAsNewMessage(sessionId, [reply]);
    return delivered;
  }
  for (const reply of pending) inFlightDeliveries.add(reply.id);

  try {
    if (pending.length === 1 && isForwardIdleNotification(pending[0])) {
      await deliverReplyToOpencode(sessionId, pending[0]);
      return { combined: getMessage(pending[0].id) ?? pending[0], pending: [] };
    }

    const text = combinedQueuedText(sessionId, pending);
    const forwarded = pending.length === 1 ? pending[0] : null;
    const combined = forwarded?.forwardRole
      ? insertForwardMessageRow({
          sessionId,
          text,
          author: "user",
          status: "received",
          links: forwarded.links,
          sessionRefs: forwarded.sessionRefs,
          clientMessageId: null,
          forwardRole: forwarded.forwardRole,
          forwardSourceSessionId: forwarded.forwardSourceSessionId || sessionId,
          forwardSourceMessageId: forwarded.forwardSourceMessageId,
          forwardTargetSessionId: forwarded.forwardTargetSessionId || sessionId,
          forwardTargetMessageId: forwarded.forwardTargetMessageId,
          forwardStatus: "pending",
          completionWatchStatus: forwarded.completionWatchStatus,
          completionSourceSessionId: forwarded.completionSourceSessionId,
          completionSourceMessageId: forwarded.completionSourceMessageId,
        })
      : insertMessageRow({
          sessionId,
          text,
          extraMarkdown: null,
          author: "user",
          status: "received",
          links: null,
          sessionRefs: null,
          clientMessageId: null,
          completionWatchStatus: forwarded?.completionWatchStatus ?? null,
          completionSourceSessionId: forwarded?.completionSourceSessionId ?? null,
          completionSourceMessageId: forwarded?.completionSourceMessageId ?? null,
        });

    const seen = new Set<string>();
    for (const reply of pending) {
      for (const attachment of listAttachmentsForMessage(reply.id)) {
        if (seen.has(attachment.filePath)) continue;
        seen.add(attachment.filePath);
        insertAttachmentForMessage(combined.id, attachment);
      }
    }

    for (const reply of pending) {
      setMessageMergedInto(reply.id, combined.id);
      if (reply.forwardRole === "target" && reply.forwardSourceMessageId) {
        updateForwardTarget(reply.forwardSourceMessageId, combined.id, "pending");
        updateForwardStatus(reply.id, "merged");
      }
    }
    broadcastQueue(sessionId);

    await deliverReplyToOpencode(sessionId, combined);
    const delivered = getMessage(combined.id);
    const status = delivered?.opencodeDeliveryStatus ?? "sent";
    for (const reply of pending) {
      if (reply.forwardRole === "target" && reply.forwardSourceMessageId) {
        updateForwardTarget(reply.forwardSourceMessageId, combined.id, status);
        updateForwardStatus(combined.id, status);
      }
    }
    if (delivered && isLiveCompletionWatchStatus(delivered.completionWatchStatus)) {
      startCompletionWatch(delivered.id);
    }
    resumeCompletionWatches(sessionId);
    return { combined: delivered ?? combined, pending };
  } finally {
    for (const reply of pending) inFlightDeliveries.delete(reply.id);
  }
}

async function deliverReplyToOpencodeViaApi(
  sessionId: string,
  reply: DbMessage,
  baseUrl = openCodeBaseUrl(),
): Promise<void> {
  const client = createOpenCodeClient(baseUrl);
  const session = requireSession(sessionId);
  const variant = readOpenCodeSessionVariant(session.reasoningEffort);
  const selectedModel =
    session.opencodeSelectedModelProvider && session.opencodeSelectedModel
      ? {
          providerID: session.opencodeSelectedModelProvider,
          modelID: session.opencodeSelectedModel,
        }
      : undefined;
  const imagePaths = listOpenCodeAttachmentPaths(reply.id);
  const result = await client.session.prompt({
    sessionID: sessionId,
    model: selectedModel,
    variant: variant ?? undefined,
    parts: [{ type: "text", text: buildOpenCodeUserMessage(sessionId, reply, imagePaths) }],
  });

  if (!result.response) {
    throw new Error(formatOpenCodePromptError(result.error));
  }
  if (result.response.status < 200 || result.response.status >= 300) {
    throw new Error(`OpenCode returned HTTP ${result.response.status}`);
  }

  updateOpencodeDelivery(reply.id, "sent", null, result.data?.info?.id || null);
}

function formatOpenCodePromptError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") return serialized;
  } catch {
    // Fall through to the generic message.
  }
  return "OpenCode prompt did not return an HTTP response.";
}

const OPENCODE_CLI_MAX_MESSAGE_BYTES = 32_000;
const OPENCODE_CLI_TIMEOUT_MS = 15_000;
const OPENCODE_CLI_ACTIVITY_CONFIRMATION_MS = 5_000;
const OPENCODE_SESSION_FETCH_TIMEOUT_MS = 10_000;

class OpenCodeCliTimeoutError extends Error {
  constructor() {
    super(
      `opencode CLI timed out after ${OPENCODE_CLI_TIMEOUT_MS}ms; OpenCode may still be working.`,
    );
  }
}

class OpenCodeCliActivityConfirmedError extends Error {
  constructor() {
    super("OpenCode activity confirmed after CLI delivery started.");
  }
}

async function deliverReplyToOpencodeViaCli(sessionId: string, reply: DbMessage): Promise<void> {
  const baseUrl = openCodeBaseUrl();

  const imagePaths = listOpenCodeAttachmentPaths(reply.id);
  const message = buildOpenCodeUserMessage(sessionId, reply, imagePaths);
  if (Buffer.byteLength(message, "utf8") > OPENCODE_CLI_MAX_MESSAGE_BYTES) {
    throw new Error(
      `Message too long for CLI delivery (>${OPENCODE_CLI_MAX_MESSAGE_BYTES} bytes); disable "Use CLI" or shorten the reply`,
    );
  }

  // Fetch the session's directory so --dir matches the browser tab's URL,
  // ensuring SSE events are tagged with the session's directory (not the server's CWD).
  const res = await openCodeFetch(`${baseUrl}/session/${sessionId}`, {
    signal: AbortSignal.timeout(OPENCODE_SESSION_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Could not fetch session info: HTTP ${res.status}`);
  const sessionInfo = await res.json();
  const directory = sessionInfo?.directory;
  if (!directory) throw new Error("Session has no directory field");

  const session = requireSession(sessionId);
  const variant = readOpenCodeSessionVariant(session.reasoningEffort);
  const cliArgs = buildOpenCodeCliArgs({
    baseUrl,
    sessionId,
    directory,
    message,
    variant,
  });

  await new Promise((resolve, reject) => {
    const child = spawn("opencode", cliArgs, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    let settled = false;
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    void waitForOpenCodeWorkingActivity(
      sessionId,
      Date.now(),
      OPENCODE_CLI_ACTIVITY_CONFIRMATION_MS,
    ).then((confirmed) => {
      if (!confirmed) return;
      child.kill("SIGTERM");
      settle(() => reject(new OpenCodeCliActivityConfirmedError()));
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle(() => reject(new OpenCodeCliTimeoutError()));
    }, OPENCODE_CLI_TIMEOUT_MS);

    child.on("error", (err) => {
      settle(() => reject(err));
    });
    child.on("close", (code: number | null) => {
      if (settled) return;
      if (code !== 0) {
        console.error(`opencode CLI exited with code ${code}: ${stderr.trim()}`);
      } else if (stderr.trim()) {
        console.error(`opencode CLI stderr: ${stderr.trim()}`);
      }
      settle(() => resolve(code));
    });
  });

  updateOpencodeDelivery(reply.id, "sent", null, null);
}

export function buildOpenCodeCliArgs({
  baseUrl,
  sessionId,
  directory,
  message,
  variant,
}: {
  baseUrl: string;
  sessionId: string;
  directory: string;
  message: string;
  variant?: string | null;
}): string[] {
  const args = ["run", "--attach", baseUrl, "--session", sessionId, "--dir", directory];
  if (variant) args.push(...opencodeReasoningEffortCliArg(variant));
  args.push(message);
  return args;
}
