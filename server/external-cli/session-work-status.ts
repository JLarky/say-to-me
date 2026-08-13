import { isCodexSessionBusy } from "../codex/delivery.ts";
import { enqueueCodexDeliveryJob } from "../codex/durable-delivery.ts";
import { isClaudeSessionBusy } from "../claude/delivery.ts";
import { enqueueClaudeDeliveryJob } from "../claude/durable-delivery.ts";
import { isCursorSessionBusy } from "../cursor/delivery.ts";
import { enqueueCursorDeliveryJob } from "../cursor/durable-delivery.ts";
import { isGrokSessionBusy } from "../grok/delivery.ts";
import { enqueueGrokDeliveryJob } from "../grok/durable-delivery.ts";
import { getOpenCodeStatus } from "../opencode/client.ts";
import { enqueueOpenCodeDeliveryJob } from "../opencode/durable-delivery.ts";
import { detectSessionBackend } from "../session-id.ts";

export type SessionWorkStatus = "pending" | "idle" | "unavailable";

export async function getSessionWorkStatus(sessionId: string): Promise<SessionWorkStatus> {
  const backend = detectSessionBackend(sessionId);
  if (backend === "claude") {
    return isClaudeSessionBusy(sessionId) ? "pending" : "idle";
  }
  if (backend === "cursor") {
    return isCursorSessionBusy(sessionId) ? "pending" : "idle";
  }
  if (backend === "codex") {
    return isCodexSessionBusy(sessionId) ? "pending" : "idle";
  }
  if (backend === "grok") {
    return isGrokSessionBusy(sessionId) ? "pending" : "idle";
  }
  if (backend === "opencode") {
    const status = await getOpenCodeStatus(sessionId);
    if (status === "pending") return "pending";
    if (status === "idle") return "idle";
    return "unavailable";
  }
  return "unavailable";
}

export function enqueueSourceCompletionNotice(input: {
  messageId: number;
  messageSessionId: string;
  sessionId: string;
}): void {
  const backend = detectSessionBackend(input.sessionId);
  if (backend === "claude") {
    enqueueClaudeDeliveryJob({
      messageId: input.messageId,
      messageSessionId: input.messageSessionId,
      claudeSessionId: input.sessionId,
      kind: "direct_user_message",
    });
    return;
  }
  if (backend === "cursor") {
    enqueueCursorDeliveryJob({
      messageId: input.messageId,
      messageSessionId: input.messageSessionId,
      cursorSessionId: input.sessionId,
      kind: "direct_user_message",
    });
    return;
  }
  if (backend === "codex") {
    enqueueCodexDeliveryJob({
      messageId: input.messageId,
      messageSessionId: input.messageSessionId,
      codexSessionId: input.sessionId,
      kind: "direct_user_message",
    });
    return;
  }
  if (backend === "grok") {
    enqueueGrokDeliveryJob({
      messageId: input.messageId,
      messageSessionId: input.messageSessionId,
      grokSessionId: input.sessionId,
      kind: "direct_user_message",
    });
    return;
  }
  enqueueOpenCodeDeliveryJob({
    messageId: input.messageId,
    messageSessionId: input.messageSessionId,
    opencodeSessionId: input.sessionId,
    kind: "source_completion_notice",
  });
}
