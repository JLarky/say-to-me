import { trace } from "@opentelemetry/api";
import { Effect } from "effect";
import { type Response } from "express";
import { readFileSync } from "node:fs";
import { broadcastQueue } from "./broadcast.ts";
import {
  buildThumbnailData,
  extractTmpAttachmentPaths,
  insertAttachmentForMessage,
  insertMarkdownAttachmentForMessage,
  isMp3Buffer,
  redactInlineAudioAttachmentPaths,
  validateTmpAttachmentPath,
} from "./images.ts";
import {
  deserializeMessage,
  getMessage,
  getMessageByClientId,
  insertMessageRow,
  insertQueuedAgentMessageClaimingCap,
  insertReplyMessage,
  prunePlayedHistory,
  type SessionReferenceInput,
  updateOpencodeDelivery,
} from "./messages.ts";
import { ensureT3DeliveryJobForMessage } from "./t3/durable-delivery.ts";
import { ensurePaseoDeliveryJobForMessage } from "./paseo/durable-delivery.ts";
import { enqueueDelivery } from "./session-services/session-router.ts";
import { recordInAppNotification, sendBrowserPush } from "./push.ts";
import { detectSessionBackend } from "./session-id.ts";
import { ensureSession, getSession } from "./sessions.ts";

export type CreateMessageInput = {
  sessionId: string;
  text: string;
  extraMarkdown?: string | null;
  pushNotificationText?: string | null;
  author: "agent" | "user";
  links: string[] | null;
  sessionRefs: SessionReferenceInput[] | null;
  clientMessageId: string | null;
  useCli?: boolean;
  forceOpencode?: boolean;
  /** Hidden escape hatch: when the session queue is full, replace oldest non-pinned queued agent message. */
  overflow?: "force" | null;
  parentId?: number | null;
  deliverySessionId?: string;
  images?: string[];
  extractInlineImages: boolean;
  notifyOnCompletion?: boolean;
  agentMessageStatus?: "queued" | "received";
  notifyAgent?: boolean;
  paseoAuthor?: string | null;
  paseoAuthorName?: string | null;
};

export type CreateMessageResult = {
  status: number;
  body: unknown;
};

export function buildClaudeUserText(
  text: string,
  markdownAttachment: string | null,
  attachmentPaths: string[],
): string {
  const sections = [text];
  if (markdownAttachment) sections.push(markdownAttachment);
  if (attachmentPaths.length > 0) sections.push(attachmentPaths.join("\n"));
  return sections.join("\n\n");
}

export async function createMessageResult({
  sessionId,
  text,
  extraMarkdown,
  pushNotificationText,
  author,
  links,
  sessionRefs,
  clientMessageId,
  useCli = false,
  forceOpencode = false,
  overflow = null,
  parentId = null,
  deliverySessionId,
  images,
  extractInlineImages,
  notifyOnCompletion = false,
  agentMessageStatus = "queued",
  notifyAgent = true,
  paseoAuthor = null,
  paseoAuthorName = null,
}: CreateMessageInput): Promise<CreateMessageResult> {
  trace.getActiveSpan()?.setAttributes({
    "message.session_id": sessionId,
    "message.author": author,
    "message.text_length": text.length,
    "message.text_preview": text.slice(0, 120),
    "message.use_cli": useCli,
    "message.client_message_id": clientMessageId || "",
  });

  // Fast-path idempotency before attachment validation (temp upload may be gone on retry).
  if (clientMessageId) {
    const existing = getMessageByClientId(sessionId, author, clientMessageId);
    if (existing) {
      if (author === "user" && detectSessionBackend(sessionId) === "t3") {
        ensureT3DeliveryJobForMessage(existing.id);
      }
      if (author === "user" && ["paseo", "paseo-chat"].includes(detectSessionBackend(sessionId))) {
        ensurePaseoDeliveryJobForMessage(existing.id, { retryFailed: true });
      }
      return { status: 200, body: { message: deserializeMessage(existing) } };
    }
  }

  // Inline paths in text are a best-effort convenience (the regex skips anything
  // malformed); explicit images[] are the strict channel where every entry is
  // validated and a bad one fails the request. Both are deduped, and image
  // thumbnails are rendered up front: a corrupt image (valid extension,
  // unreadable bytes) passes path validation but throws in buildThumbnailData,
  // so doing this before insertMessage fails the whole request with 400 instead
  // of orphaning a row.
  let preparedAttachments: Array<{
    attachment: ReturnType<typeof validateTmpAttachmentPath>;
    thumbnail: Awaited<ReturnType<typeof buildThumbnailData>>;
  }> = [];
  try {
    const inlinePaths = extractInlineImages ? extractTmpAttachmentPaths(text) : [];
    const uniquePaths = [...new Set([...inlinePaths, ...(images ?? [])])];
    preparedAttachments = await Promise.all(
      uniquePaths.map(async (filePath) => {
        const attachment = validateTmpAttachmentPath(filePath);
        const attachmentBytes = readFileSync(attachment.filePath);
        if (attachment.mimeType === "audio/mpeg" && !isMp3Buffer(attachmentBytes)) {
          throw new Error(`Invalid MP3 attachment: ${filePath}`);
        }
        const thumbnail = attachment.mimeType.startsWith("image/")
          ? await buildThumbnailData(attachmentBytes)
          : { thumbnailDataUrl: "", thumbnailWidth: 0, thumbnailHeight: 0 };
        return { attachment, thumbnail };
      }),
    );
  } catch (error) {
    return {
      status: 400,
      body: { error: error instanceof Error ? error.message : "Invalid attachment path." },
    };
  }
  const messageText = redactInlineAudioAttachmentPaths(text);
  const linksJson = links ? JSON.stringify(links) : null;
  const sessionRefsJson = sessionRefs ? JSON.stringify(sessionRefs) : null;
  const markdownAttachment = author === "user" ? extraMarkdown?.trim() || null : null;

  ensureSession(sessionId);
  for (const ref of sessionRefs ?? []) {
    ensureSession(ref.id);
  }

  if (author === "user") {
    const target = deliverySessionId ?? sessionId;
    if (
      (detectSessionBackend(target) === "claude" || detectSessionBackend(target) === "cursor") &&
      !getSession(target)?.cwd
    ) {
      return {
        status: 400,
        body: {
          error: "External CLI sessions need a working directory before messages can be sent.",
        },
      };
    }
  }

  let message;
  if (author === "agent" && parentId == null && agentMessageStatus === "queued") {
    const claimed = insertQueuedAgentMessageClaimingCap({
      sessionId,
      text: messageText,
      extraMarkdown: extraMarkdown || null,
      pushNotificationText: pushNotificationText?.trim() || null,
      links: linksJson,
      sessionRefs: sessionRefsJson,
      clientMessageId,
      completionWatchStatus: notifyOnCompletion ? "watching" : null,
      completionSourceSessionId: null,
      completionSourceMessageId: null,
      overflow: overflow ?? null,
      paseoAuthor,
      paseoAuthorName,
    });
    if (!claimed.ok) {
      return { status: 400, body: { error: claimed.error } };
    }
    if (claimed.existing) {
      return { status: 200, body: { message: deserializeMessage(claimed.message) } };
    }
    message = claimed.message;
  } else {
    message =
      parentId != null
        ? insertReplyMessage(sessionId, messageText, parentId)
        : insertMessageRow({
            sessionId,
            text: messageText,
            extraMarkdown: null,
            pushNotificationText: null,
            author,
            status: "received",
            links: linksJson,
            sessionRefs: sessionRefsJson,
            clientMessageId,
            completionWatchStatus: notifyOnCompletion ? "watching" : null,
            completionSourceSessionId: null,
            completionSourceMessageId: null,
            paseoAuthor,
            paseoAuthorName,
          });
  }
  if (markdownAttachment) insertMarkdownAttachmentForMessage(message.id, markdownAttachment);
  for (const { attachment, thumbnail } of preparedAttachments) {
    insertAttachmentForMessage(message.id, { ...attachment, ...thumbnail });
  }
  prunePlayedHistory(sessionId);
  broadcastQueue(sessionId);

  if (author === "agent" && notifyAgent) {
    // In-app notification (top-right panel) is the unchanged audit log. Browser
    // push only fires for high-signal messages that carry pushNotificationText.
    recordInAppNotification(sessionId, messageText);
    const pushText = pushNotificationText?.trim();
    if (pushText) await sendBrowserPush(sessionId, pushText);
  }
  if (author === "user") {
    const target = deliverySessionId ?? sessionId;
    const backend = detectSessionBackend(target);
    if (backend === "opencode") {
      updateOpencodeDelivery(message.id, "queued", null, null);
    }
    if (backend !== "voice" && backend !== "none") {
      await Effect.runPromise(
        enqueueDelivery(target, {
          messageId: message.id,
          messageSessionId: sessionId,
          kind: "direct_user_message",
          useCli,
          forceOpencode,
        }),
      );
    } else {
      // Explicit no-op: voice-only and junk/legacy ids never attempt agent delivery.
    }
    broadcastQueue(sessionId);
  }
  return { status: 201, body: { message: deserializeMessage(getMessage(message.id)!) } };
}

export async function createMessage(
  res: Response,
  input: CreateMessageInput,
): Promise<Response | undefined> {
  const result = await createMessageResult(input);
  return res.status(result.status).json(result.body);
}
