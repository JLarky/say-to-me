import {
  enqueueCodexDeliveryJob,
  hasCodexOwedDeliveryWork,
  hasCodexOpenCliTurn,
} from "../codex/durable-delivery.ts";
import {
  enqueueClaudeDeliveryJob,
  hasClaudeOwedDeliveryWork,
  hasClaudeOpenCliTurn,
} from "../claude/durable-delivery.ts";
import {
  enqueueCursorDeliveryJob,
  hasCursorOwedDeliveryWork,
  hasCursorOpenCliTurn,
} from "../cursor/durable-delivery.ts";
import {
  enqueueGrokDeliveryJob,
  hasGrokOwedDeliveryWork,
  hasGrokOpenCliTurn,
} from "../grok/durable-delivery.ts";
import { getOpenCodeStatus } from "../opencode/client.ts";
import { enqueueOpenCodeDeliveryJob } from "../opencode/durable-delivery.ts";
import { detectSessionBackend } from "../session-id.ts";

export type SessionWorkStatus = "pending" | "idle" | "unavailable";

/**
 * Work status as the notification watchers need it: `idle` has to mean "this
 * session owes the relay nothing", not merely "no prompt is in front of the
 * agent this instant".
 *
 * External CLI backends have no live session status to read. Owed delivery jobs
 * track prompt handover (queued / backing off / claimed). An open CLI turn
 * tracks the worker observing process-end after `markDispatched`. Queue-empty
 * is not idle: a succeeded or lease-expired job can still have an open turn.
 */
export async function getSessionWorkStatus(sessionId: string): Promise<SessionWorkStatus> {
  const backend = detectSessionBackend(sessionId);
  if (backend === "claude") {
    return hasClaudeOwedDeliveryWork(sessionId) || hasClaudeOpenCliTurn(sessionId)
      ? "pending"
      : "idle";
  }
  if (backend === "cursor") {
    return hasCursorOwedDeliveryWork(sessionId) || hasCursorOpenCliTurn(sessionId)
      ? "pending"
      : "idle";
  }
  if (backend === "codex") {
    return hasCodexOwedDeliveryWork(sessionId) || hasCodexOpenCliTurn(sessionId)
      ? "pending"
      : "idle";
  }
  if (backend === "grok") {
    return hasGrokOwedDeliveryWork(sessionId) || hasGrokOpenCliTurn(sessionId) ? "pending" : "idle";
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
