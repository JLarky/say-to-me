import {
  isClaudeSessionId,
  isCodexSessionId,
  isCursorSessionId,
  isGrokSessionId,
  type SessionBackend,
} from "../session-id.ts";

export type ExternalCliBackend = Extract<SessionBackend, "claude" | "cursor" | "codex" | "grok">;

export function isExternalCliSessionId(
  sessionId: string,
): sessionId is `cc_${string}` | `cur_${string}` | `cx_${string}` | `gr_${string}` {
  return (
    isClaudeSessionId(sessionId) ||
    isCursorSessionId(sessionId) ||
    isCodexSessionId(sessionId) ||
    isGrokSessionId(sessionId)
  );
}

export function externalCliBackend(sessionId: string): ExternalCliBackend | null {
  if (isClaudeSessionId(sessionId)) return "claude";
  if (isCursorSessionId(sessionId)) return "cursor";
  if (isCodexSessionId(sessionId)) return "codex";
  if (isGrokSessionId(sessionId)) return "grok";
  return null;
}
