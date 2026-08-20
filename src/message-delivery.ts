import type { Message } from "./types.ts";
import { formatMessageTime } from "./utils.ts";

export const deliveryStatuses = [
  "queued",
  "pending",
  "sent",
  "failed",
  "cli_timed_out",
  "cli_unconfirmed",
] as const;
export type DeliveryStatusValue = (typeof deliveryStatuses)[number];
export const deliveryStatusSet = new Set<string>(deliveryStatuses);

export const sessionStateLabel: Record<string, string> = {
  needs_answer: "Needs you",
  needs_direction: "Needs direction",
  can_continue: "Idle",
  working: "Working",
  blocked: "Blocked",
  review: "Review",
  unknown: "Unknown",
};

export function deliveryProviderLabel(message: Message): string {
  const target = message.forwardTargetSessionId ?? message.sessionId;
  if (target.startsWith("cur_")) return "Cursor";
  if (target.startsWith("cc_")) return "Claude";
  if (target.startsWith("cx_")) return "Codex";
  return "OpenCode";
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
    case "cli_unconfirmed":
      return `Not confirmed by ${provider} — check the session before resending`;
  }
}

export function cardStatusLabel(state?: string | null): string {
  return state ? (sessionStateLabel[state] ?? state) : "Unknown";
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
  const match = message.text.match(/^<say-to-me-system>([^<]+) is idle now<\/say-to-me-system>$/);
  return match?.[1] ?? null;
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
