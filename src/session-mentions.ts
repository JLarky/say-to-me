import { SESSION_MENTION_ID } from "./external-cli/session-patterns.ts";

export const sessionMentionPattern = new RegExp(
  `say-to-me\\((${SESSION_MENTION_ID})(?:,\\s*([^)]*?))?\\)`,
  "g",
);
export const rawSessionIdPattern = new RegExp(`(?:${SESSION_MENTION_ID})(?=\\s|$)`, "g");

export type SessionMention = {
  id: string;
  alias: string | null;
};

export function sessionMentionToken(id: string, alias?: string | null): string {
  const cleanAlias = alias?.trim();
  return cleanAlias ? `say-to-me(${id}, ${cleanAlias})` : `say-to-me(${id})`;
}

export type LeadingSessionMessage = {
  session: SessionMention;
  text: string;
};

export function extractSessionMentions(text: string): SessionMention[] {
  const refs: SessionMention[] = [];
  // matchAll seeds its scan from the shared regex's lastIndex, which a prior
  // exec() elsewhere may have left advanced — reset so we scan from the start.
  sessionMentionPattern.lastIndex = 0;
  for (const match of text.matchAll(sessionMentionPattern)) {
    refs.push({ id: match[1], alias: match[2]?.trim() || null });
  }

  const tokenIds = new Set(refs.map((ref) => ref.id));
  for (const id of text.match(rawSessionIdPattern) ?? []) {
    if (!tokenIds.has(id)) refs.push({ id, alias: null });
  }
  return refs;
}

export function extractLeadingSessionMentions(text: string): SessionMention[] {
  const refs: SessionMention[] = [];
  let rest = text.trimStart();
  while (true) {
    sessionMentionPattern.lastIndex = 0;
    const match = sessionMentionPattern.exec(rest);
    if (match?.index === 0) {
      refs.push({ id: match[1], alias: match[2]?.trim() || null });
      rest = rest.slice(match[0].length).trimStart();
      continue;
    }

    rawSessionIdPattern.lastIndex = 0;
    const rawMatch = rawSessionIdPattern.exec(rest);
    if (rawMatch?.index !== 0) return refs;
    refs.push({ id: rawMatch[0], alias: null });
    rest = rest.slice(rawMatch[0].length).trimStart();
  }
}

export function extractLeadingSessionMessage(text: string): LeadingSessionMessage | null {
  let rest = text.trimStart();

  sessionMentionPattern.lastIndex = 0;
  const mentionMatch = sessionMentionPattern.exec(rest);
  if (mentionMatch?.index === 0) {
    rest = rest.slice(mentionMatch[0].length).trimStart();
    if (!rest) return null;
    return {
      session: { id: mentionMatch[1], alias: mentionMatch[2]?.trim() || null },
      text: rest,
    };
  }

  rawSessionIdPattern.lastIndex = 0;
  const rawMatch = rawSessionIdPattern.exec(rest);
  if (rawMatch?.index !== 0) return null;
  rest = rest.slice(rawMatch[0].length).trimStart();
  if (!rest) return null;
  return { session: { id: rawMatch[0], alias: null }, text: rest };
}
