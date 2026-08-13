import type { DbMessage } from "../db/schemas.ts";
import { updateForwardStatus, updateForwardTarget, updateOpencodeDelivery } from "../messages.ts";

export const STOPPED_BY_USER_REASON = "Stopped by user.";

export function markDeliveryStoppedByUser(message: DbMessage): void {
  if (message.opencodeDeliveryStatus === "sent") return;
  updateOpencodeDelivery(message.id, "failed", STOPPED_BY_USER_REASON, null);
  if (message.forwardRole) updateForwardStatus(message.id, "failed");
  if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
    updateForwardTarget(message.forwardSourceMessageId, message.id, "failed");
  }
}
