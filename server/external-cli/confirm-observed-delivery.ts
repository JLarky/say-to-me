import { confirmClaudeDeliveriesForSessionFromObservedWork } from "../claude/durable-delivery.ts";
import { confirmCodexDeliveriesForSessionFromObservedWork } from "../codex/durable-delivery.ts";
import { confirmCursorDeliveriesForSessionFromObservedWork } from "../cursor/durable-delivery.ts";
import { confirmGrokDeliveriesForSessionFromObservedWork } from "../grok/durable-delivery.ts";
import { detectSessionBackend } from "../session-id.ts";

/**
 * When an agent message lands in a CLI session, confirm any dispatched delivery
 * that previously failed outcome recording — without re-prompting.
 */
export function confirmObservedDeliveriesForSession(sessionId: string): number {
  switch (detectSessionBackend(sessionId)) {
    case "cursor":
      return confirmCursorDeliveriesForSessionFromObservedWork(sessionId);
    case "claude":
      return confirmClaudeDeliveriesForSessionFromObservedWork(sessionId);
    case "codex":
      return confirmCodexDeliveriesForSessionFromObservedWork(sessionId);
    case "grok":
      return confirmGrokDeliveriesForSessionFromObservedWork(sessionId);
    default:
      return 0;
  }
}
