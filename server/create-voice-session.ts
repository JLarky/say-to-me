import { randomUUID } from "node:crypto";
import type { DbSession } from "./db/schemas.ts";
import { isOpenableSessionName, VOICE_SESSION } from "./session-id.ts";
import { ensureSession, getSession, setSessionAliasIfSafe } from "./sessions.ts";

/** Prefer an already-openable name as the vo_ slug; otherwise generate one. */
export function voiceSessionSlug(name: string): string {
  const trimmed = name.trim();
  if (trimmed && isOpenableSessionName(trimmed)) return trimmed.slice(0, 128);
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 120);
  if (slug && isOpenableSessionName(slug)) return slug;
  return `voice-${randomUUID().slice(0, 8)}`;
}

export function mintVoiceSessionId(name?: string | null): string {
  const base = voiceSessionSlug(name?.trim() || "");
  let slug = base;
  let sessionId = `${VOICE_SESSION.prefix}${slug}`;
  let n = 2;
  while (getSession(sessionId) || !VOICE_SESSION.idPattern.test(sessionId)) {
    slug = `${base}-${n}`;
    sessionId = `${VOICE_SESSION.prefix}${slug}`;
    n += 1;
    if (n > 1000) throw new Error("Unable to allocate voice session id.");
  }
  return sessionId;
}

/**
 * Create a local voice-only session (`vo_<slug>`). No workspace/model — messages
 * queue and play in-app and never deliver to an agent backend.
 */
export function createVoiceSessionRecord(name?: string | null): DbSession {
  const sessionId = mintVoiceSessionId(name);
  const session = ensureSession(sessionId);
  const alias = name?.trim();
  if (alias) setSessionAliasIfSafe(sessionId, alias);
  return getSession(sessionId) ?? session;
}
