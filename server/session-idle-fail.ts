import {
  completeSessionIdleRoutine,
  findActiveSessionIdleRoutineBySourceMessageId,
  findSessionIdleRoutineBySourceMessageId,
} from "./routines.ts";
import {
  getMessage,
  insertForwardMessageRow,
  setCompletionWatchStatus,
  updateForwardStatus,
  updateForwardTarget,
  updateOpencodeDelivery,
} from "./messages.ts";
import { broadcastQueue } from "./broadcast.ts";
import { stopCompletionWatch } from "./opencode/completion-watch.ts";
import { stopForwardCompletionNotificationWatch } from "./notifications.ts";
import { enqueueSourceCompletionNotice } from "./external-cli/session-work-status.ts";

/**
 * When a watched forward target fails delivery before work is seen, notify the
 * owner with reason "failed" and terminalize the session_idle routine.
 */
export function failSessionIdleForWatchedMessage(messageId: number): void {
  const message = getMessage(messageId);
  if (!message || message.completionWatchStatus !== "watching") return;
  const sourceMessageId = message.completionSourceMessageId ?? message.forwardSourceMessageId;
  const sourceSessionId = message.completionSourceSessionId ?? message.forwardSourceSessionId;
  if (sourceMessageId == null || !sourceSessionId) return;

  const routine =
    findActiveSessionIdleRoutineBySourceMessageId(sourceMessageId) ??
    findSessionIdleRoutineBySourceMessageId(sourceMessageId);
  if (!routine) return;

  const noticeText = `<say-to-me-system>${message.sessionId} is idle now</say-to-me-system>`;
  const notification = insertForwardMessageRow({
    sessionId: sourceSessionId,
    text: noticeText,
    author: "user",
    status: "received",
    sessionRefs: JSON.stringify([{ id: message.sessionId }]),
    clientMessageId: `session-idle-failed-${sourceMessageId}`,
    forwardRole: "source",
    forwardSourceSessionId: sourceSessionId,
    forwardSourceMessageId: sourceMessageId,
    forwardTargetSessionId: message.sessionId,
    forwardTargetMessageId: message.id,
    forwardStatus: "completed",
  });
  updateOpencodeDelivery(notification.id, "queued", null, null);
  enqueueSourceCompletionNotice({
    messageId: notification.id,
    messageSessionId: sourceSessionId,
    sessionId: sourceSessionId,
  });

  completeSessionIdleRoutine({
    routineId: routine.id,
    messageId: notification.id,
    targetSessionId: message.sessionId,
    targetMessageId: message.id,
    sourceMessageId,
    reason: "failed",
  });

  setCompletionWatchStatus(message.id, "completed");
  stopCompletionWatch(message.id);
  stopForwardCompletionNotificationWatch(sourceMessageId);
  if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
    updateForwardStatus(message.id, "failed");
    updateForwardTarget(message.forwardSourceMessageId, message.id, "failed");
  }
  broadcastQueue(sourceSessionId);
  broadcastQueue(message.sessionId);
}
