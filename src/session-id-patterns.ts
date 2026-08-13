/**
 * Session-id shapes recognized by the /sessions OpenSessionByIdForm import flow
 * and Cmd+K quick-search actions. Keep in sync with server/session-id.ts —
 * do not invent alternate patterns here.
 *
 * OpenCode `ses_` ids: Identifier.create emits 12 lowercase hex + 14 base62
 * (26 after prefix). Exact length only — shorter 24-hex artifacts are not OpenCode.
 * External CLI UUID-backed ids (cc_/cur_/cx_/gr_/t3_) are recognized case-insensitively
 * and canonicalize to lowercase for path resolution.
 * Voice-only ids are `vo_` + OPENABLE_ID slug (not importable from an agent).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAUDE_ID = /^cc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_ID = /^cur_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODEX_ID = /^cx_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROK_ID = /^gr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const T3_ID = /^t3_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASEO_ID = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASEO_CHAT_ID = /^pc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Case-sensitive — matches server `OPENCODE_ID` / OpenSessionByIdForm. */
const OPENCODE_ID = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
/** Free-form openable names (and the slug after `vo_`). Matches server OPENABLE_ID. */
const OPENABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VOICE_ID = /^vo_[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type PrefixedSessionBackend =
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

export function isBareSessionUuid(input: string): boolean {
  return UUID.test(input.trim());
}

export function isOpenableSessionName(input: string): boolean {
  return OPENABLE_ID.test(input.trim());
}

export function detectPrefixedSessionBackend(sessionId: string): PrefixedSessionBackend {
  if (!sessionId || sessionId === "default") return "none";
  if (OPENCODE_ID.test(sessionId)) return "opencode";
  if (CLAUDE_ID.test(sessionId)) return "claude";
  if (CURSOR_ID.test(sessionId)) return "cursor";
  if (CODEX_ID.test(sessionId)) return "codex";
  if (GROK_ID.test(sessionId)) return "grok";
  if (T3_ID.test(sessionId)) return "t3";
  if (PASEO_ID.test(sessionId)) return "paseo";
  if (PASEO_CHAT_ID.test(sessionId)) return "paseo-chat";
  if (VOICE_ID.test(sessionId)) return "voice";
  return "none";
}

/** Prefixed ids that can be imported from an external agent (not voice-only). */
export function isPrefixedImportableSessionId(sessionId: string): boolean {
  const backend = detectPrefixedSessionBackend(sessionId);
  return backend !== "none" && backend !== "voice";
}

/**
 * Canonical form for local-id lookup keys and import/navigation.
 * - External CLI (cc_/cur_/cx_/gr_): full lowercase
 * - OpenCode (ses_) / voice (vo_): unchanged (case-sensitive bodies)
 */
export function canonicalizeImportableSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (
    CLAUDE_ID.test(trimmed) ||
    CURSOR_ID.test(trimmed) ||
    CODEX_ID.test(trimmed) ||
    GROK_ID.test(trimmed) ||
    T3_ID.test(trimmed) ||
    PASEO_ID.test(trimmed) ||
    PASEO_CHAT_ID.test(trimmed)
  ) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * Prefixed ids the /sessions import flow recognizes (ses_/cc_/cur_/cx_/gr_).
 * Returns the canonical id for import/navigation, or null when not an id.
 * Voice (`vo_`) is intentionally excluded — create locally instead of importing.
 */
export function matchImportableSessionId(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (!isPrefixedImportableSessionId(trimmed)) return null;
  return canonicalizeImportableSessionId(trimmed);
}

/**
 * Query is a valid openable session name and not already a known agent/voice id
 * or folder path shape — candidate for "Create voice-only session" → vo_<query>.
 */
export function matchCreatableVoiceSessionName(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (detectPrefixedSessionBackend(trimmed) !== "none") return null;
  if (isBareSessionUuid(trimmed)) return null;
  if (!isOpenableSessionName(trimmed)) return null;
  // Folder-shaped queries belong to import-folder, not voice create.
  if (trimmed.startsWith("/") || trimmed === "~" || trimmed.startsWith("~/")) return null;
  if (trimmed.includes("/") && !/\s/.test(trimmed) && !/^https?:/i.test(trimmed)) return null;
  return trimmed;
}

export function voiceSessionIdFromName(name: string): string {
  return `vo_${name}`;
}

export {
  CLAUDE_ID as CLAUDE_SESSION_ID_RE,
  CURSOR_ID as CURSOR_SESSION_ID_RE,
  CODEX_ID as CODEX_SESSION_ID_RE,
  GROK_ID as GROK_SESSION_ID_RE,
  T3_ID as T3_SESSION_ID_RE,
  PASEO_ID as PASEO_SESSION_ID_RE,
  PASEO_CHAT_ID as PASEO_CHAT_SESSION_ID_RE,
  VOICE_ID as VOICE_SESSION_ID_RE,
  OPENABLE_ID as OPENABLE_SESSION_ID_RE,
};
