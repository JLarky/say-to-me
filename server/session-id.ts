import {
  isPrefixedUuidSessionId,
  prefixedUuidSessionId,
  stripPrefixedUuid,
} from "./external-cli/prefixed-session.ts";

/**
 * OpenCode `Identifier.create("session")` emits `ses_` + 12 lowercase hex
 * (timestamp) + 14 base62 = 26 chars after the prefix. Exact length only —
 * shorter artifacts (e.g. 24-hex `ses_0a9fdff38ae3cee51001df32`) are `none`.
 * Junk like `ses_ses` does not match. Keep in sync with src/session-id-patterns.ts.
 */
const OPENCODE_ID = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const OPENABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const CLAUDE_SESSION = {
  prefix: "cc_",
  idPattern: /^cc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

export const CURSOR_SESSION = {
  prefix: "cur_",
  idPattern: /^cur_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

export const CODEX_SESSION = {
  prefix: "cx_",
  idPattern: /^cx_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

export const GROK_SESSION = {
  prefix: "gr_",
  idPattern: /^gr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

/** T3 Code threads: `t3_` + provider thread UUID. */
export const T3_SESSION = {
  prefix: "t3_",
  idPattern: /^t3_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

/** Paseo agents: `pa_` + provider session UUID. */
export const PASEO_SESSION = {
  prefix: "pa_",
  idPattern: /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;
/** Paseo chat rooms: `pc_` + room UUID. */
export const PASEO_CHAT_SESSION = {
  prefix: "pc_",
  idPattern: /^pc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

/** Voice-only: `vo_` + free-form slug matching OPENABLE_ID (e.g. vo_shopping-notes). */
export const VOICE_SESSION = {
  prefix: "vo_",
  idPattern: /^vo_[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
} as const;

export function validateSessionId(sessionId: string | null | undefined): boolean {
  return sessionId === null || (sessionId != null && OPENCODE_ID.test(sessionId));
}

export function isOpenCodeSessionId(sessionId: string): boolean {
  return OPENCODE_ID.test(sessionId);
}

export function isClaudeSessionId(sessionId: string): boolean {
  return isPrefixedUuidSessionId(CLAUDE_SESSION, sessionId);
}

export function isCursorSessionId(sessionId: string): boolean {
  return isPrefixedUuidSessionId(CURSOR_SESSION, sessionId);
}

export function isCodexSessionId(sessionId: string): boolean {
  return isPrefixedUuidSessionId(CODEX_SESSION, sessionId);
}

export function isGrokSessionId(sessionId: string): boolean {
  return isPrefixedUuidSessionId(GROK_SESSION, sessionId);
}

export function isT3SessionId(sessionId: string): boolean {
  return isPrefixedUuidSessionId(T3_SESSION, sessionId);
}
export function isPaseoSessionId(sessionId: string): boolean {
  return isPrefixedUuidSessionId(PASEO_SESSION, sessionId);
}

export function isPaseoChatSessionId(sessionId: string): boolean {
  return isPrefixedUuidSessionId(PASEO_CHAT_SESSION, sessionId);
}

export function isVoiceSessionId(sessionId: string): boolean {
  return VOICE_SESSION.idPattern.test(sessionId);
}

export function claudeSessionUuid(sessionId: string): string {
  return stripPrefixedUuid(CLAUDE_SESSION.prefix, sessionId);
}

export function cursorSessionUuid(sessionId: string): string {
  return stripPrefixedUuid(CURSOR_SESSION.prefix, sessionId);
}

export function codexSessionUuid(sessionId: string): string {
  return stripPrefixedUuid(CODEX_SESSION.prefix, sessionId);
}

export function grokSessionUuid(sessionId: string): string {
  return stripPrefixedUuid(GROK_SESSION.prefix, sessionId);
}

export function t3SessionUuid(sessionId: string): string {
  return stripPrefixedUuid(T3_SESSION.prefix, sessionId);
}
export function paseoSessionUuid(sessionId: string): string {
  return stripPrefixedUuid(PASEO_SESSION.prefix, sessionId);
}

export function paseoChatRoomUuid(sessionId: string): string {
  return stripPrefixedUuid(PASEO_CHAT_SESSION.prefix, sessionId);
}

export function toClaudeSessionId(input: string): string | null {
  return prefixedUuidSessionId(CLAUDE_SESSION, input);
}

export function toCursorSessionId(input: string): string | null {
  return prefixedUuidSessionId(CURSOR_SESSION, input);
}

export function toCodexSessionId(input: string): string | null {
  return prefixedUuidSessionId(CODEX_SESSION, input);
}

export function toGrokSessionId(input: string): string | null {
  return prefixedUuidSessionId(GROK_SESSION, input);
}

export function toT3SessionId(input: string): string | null {
  return prefixedUuidSessionId(T3_SESSION, input);
}
export function toPaseoSessionId(input: string): string | null {
  return prefixedUuidSessionId(PASEO_SESSION, input);
}

export function toPaseoChatSessionId(input: string): string | null {
  return prefixedUuidSessionId(PASEO_CHAT_SESSION, input);
}

export type SessionBackend =
  | "opencode"
  | "claude"
  | "cursor"
  | "codex"
  | "grok"
  | "t3"
  | "paseo"
  | "paseo-chat"
  | "voice"
  | "none";

export function detectSessionBackend(sessionId: string | null | undefined): SessionBackend {
  if (!sessionId || sessionId === "default") return "none";
  if (isOpenCodeSessionId(sessionId)) return "opencode";
  if (isClaudeSessionId(sessionId)) return "claude";
  if (isCursorSessionId(sessionId)) return "cursor";
  if (isCodexSessionId(sessionId)) return "codex";
  if (isGrokSessionId(sessionId)) return "grok";
  if (isT3SessionId(sessionId)) return "t3";
  if (isPaseoSessionId(sessionId)) return "paseo";
  if (isPaseoChatSessionId(sessionId)) return "paseo-chat";
  if (isVoiceSessionId(sessionId)) return "voice";
  return "none";
}

export function normalizeSessionId(sessionId: string | undefined | null): string | null {
  if (!sessionId || sessionId === "default") return "default";
  if (
    isOpenCodeSessionId(sessionId) ||
    isClaudeSessionId(sessionId) ||
    isCursorSessionId(sessionId) ||
    isCodexSessionId(sessionId) ||
    isGrokSessionId(sessionId) ||
    isT3SessionId(sessionId) ||
    isPaseoSessionId(sessionId) ||
    isPaseoChatSessionId(sessionId) ||
    isVoiceSessionId(sessionId) ||
    OPENABLE_ID.test(sessionId)
  ) {
    return sessionId;
  }
  return null;
}

export function isOpenableSessionName(name: string): boolean {
  return OPENABLE_ID.test(name);
}

export function sessionHref(sessionId: string): string {
  return sessionId === "default" ? "/default" : `/ses/${sessionId}`;
}
