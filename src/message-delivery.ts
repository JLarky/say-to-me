import { isIdleNoticeText } from "@say-to-me/session-utils/idle-notices";
import type { Message } from "./types.ts";
import { formatMessageTime } from "./utils.ts";

export const deliveryStatuses = ["queued", "pending", "sent", "failed", "cli_timed_out"] as const;
export type DeliveryStatusValue = (typeof deliveryStatuses)[number];
export const deliveryStatusSet = new Set<string>(deliveryStatuses);

export const sessionStateLabel = {
  needs_answer: "Needs you",
  needs_direction: "Needs direction",
  can_continue: "Idle",
  working: "Working",
  blocked: "Blocked",
  review: "Review",
  unknown: "Unknown",
} satisfies Record<string, string>;

const sessionStateLabelByState = new Map(Object.entries(sessionStateLabel));

/**
 * Loose prefix → label table for delivery badges. Kept deliberately loose (short
 * ids like `cur_1` match) so UI classification stays aligned with how messages
 * are stored, without requiring a full UUID body.
 *
 * OpenCode is a positive `ses_` entry — not a fallthrough — so an unrecognized
 * prefix cannot be mistaken for a provider that supports Retry.
 */
const DELIVERY_PROVIDER_PREFIXES = [
  { prefix: "cur_", label: "Cursor" },
  { prefix: "cc_", label: "Claude" },
  { prefix: "cx_", label: "Codex" },
  { prefix: "gr_", label: "Grok" },
  { prefix: "ses_", label: "OpenCode" },
] as const;

/** Same target `deliveryProviderLabel` and retry capability both read. */
export function deliveryTargetSessionId(message: Message): string {
  return message.forwardTargetSessionId ?? message.sessionId;
}

export function deliveryProviderLabel(message: Message): string {
  const target = deliveryTargetSessionId(message);
  for (const { prefix, label } of DELIVERY_PROVIDER_PREFIXES) {
    if (target.startsWith(prefix)) return label;
  }
  throw new Error(
    `Message carried a delivery status but session id "${target}" has no known delivery provider`,
  );
}

/**
 * Retry is available for every delivery-backed provider. Derive capability from
 * the session id, never from the display label.
 */
export function canRetryDelivery(message: Message): boolean {
  const target = deliveryTargetSessionId(message);
  return DELIVERY_PROVIDER_PREFIXES.some(({ prefix }) => target.startsWith(prefix));
}

/**
 * Force send applies to every delivery-backed provider. Each one holds queued
 * messages while its session is busy (OpenCode via live status, CLI via the
 * open-turn gate), so a queued row always has a wait that Force send can skip.
 * Derived from the session id, never from the display label.
 */
export function canForceSendDelivery(message: Message): boolean {
  const target = deliveryTargetSessionId(message);
  return DELIVERY_PROVIDER_PREFIXES.some(({ prefix }) => target.startsWith(prefix));
}

export function deliveryStatusLabel(
  status: DeliveryStatusValue | null,
  provider: string,
  raw?: string | null,
) {
  if (!status) return `${provider} ${raw ?? "delivery"}`;
  switch (status) {
    case "queued":
      return `Waiting for ${provider} to be idle`;
    case "pending":
      return `${provider} pending`;
    case "sent":
      return `${provider} sent`;
    case "failed":
      return `${provider} failed`;
    case "cli_timed_out":
      return `${provider} CLI timed out`;
  }
}

export function cardStatusLabel(state?: string | null): string {
  return state ? (sessionStateLabelByState.get(state) ?? state) : "Unknown";
}

export function formatElapsedDuration(from?: string | null, to?: string | null): string {
  const start = new Date(`${from ?? ""}${from?.endsWith("Z") ? "" : "Z"}`).getTime();
  const end = new Date(`${to ?? ""}${to?.endsWith("Z") ? "" : "Z"}`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "a moment";
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

export function idleNotificationSessionId(message: Message): string | null {
  if (message.routineEvent?.kind === "watcher_completed") {
    return message.routineEvent.targetSessionId;
  }
  const legacy = message.text.match(/^<say-to-me-system>([^<]+) is idle now/);
  if (legacy?.[1]) return legacy[1];
  if (!isIdleNoticeText(message.text)) {
    return null;
  }
  const sessions = message.sessions ?? [];
  const other = sessions.find((session) => session.id !== message.sessionId);
  return other?.id ?? sessions[0]?.id ?? message.forwardTargetSessionId ?? null;
}

export function forwardDetail(message: Message, notificationMessage?: Message): string {
  const peerSessionId =
    message.forwardRole === "target"
      ? message.forwardSourceSessionId
      : message.forwardTargetSessionId;
  const direction = message.forwardRole === "target" ? "From" : "To";
  const peer = peerSessionId ?? "another session";
  if (message.forwardRole === "source" && message.forwardStatus === "watching") {
    return `Waiting for ${peer} to finish since ${formatMessageTime(message.createdAt)}`;
  }
  if (message.forwardRole === "source" && message.forwardStatus === "notified") {
    const notificationId = notificationMessage?.id ?? message.forwardTargetMessageId;
    const sourceNotificationId = notificationMessage?.forwardSourceMessageId;
    const sourceDetail =
      sourceNotificationId && sourceNotificationId !== notificationId
        ? `, forwarded from #${sourceNotificationId}`
        : "";
    const duration = formatElapsedDuration(message.createdAt, notificationMessage?.createdAt);
    return `Marked as idle in #${notificationId}${sourceDetail} after ${duration}`;
  }
  return `${direction} ${peer}${message.forwardStatus ? ` | ${message.forwardStatus}` : ""}`;
}

export function systemMessageText(text: string): string | null {
  const match = text.match(/^<say-to-me-system>([\s\S]*?)<\/say-to-me-system>$/);
  return match?.[1]?.trim() || null;
}
