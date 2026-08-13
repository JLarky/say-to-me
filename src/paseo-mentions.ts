import type { Message } from "./types.ts";

/** Full agent UUID as used in @mentions and Reply tokens. */
export const PASEO_AGENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paseo agent ids appear in chat bodies as @<uuid> mentions (machine-stable tokens). */
export const PASEO_AGENT_MENTION =
  /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;

/** Paseo UI convention: first 7 characters of the agent id. */
export function shortPaseoAgentId(agentId: string): string {
  return agentId.slice(0, 7);
}

export type PaseoAgentLabelKind = "name" | "short";

export type PaseoAgentLabel = {
  id: string;
  label: string;
  kind: PaseoAgentLabelKind;
};

/**
 * Collect known Paseo agent display names from message badges (author identity).
 * Later non-empty names win for the same id.
 */
export function buildPaseoAgentNameMap(
  messages: readonly Pick<Message, "paseoAuthor" | "paseoAuthorName">[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    const id = message.paseoAuthor?.trim();
    const name = message.paseoAuthorName?.trim();
    if (!id || !name) continue;
    names.set(id.toLowerCase(), name);
  }
  return names;
}

function namesToMap(
  namesByAgentId: ReadonlyMap<string, string> | Readonly<Record<string, string>> | undefined,
): Map<string, string> {
  if (!namesByAgentId) return new Map();
  const entries =
    namesByAgentId instanceof Map ? namesByAgentId.entries() : Object.entries(namesByAgentId);
  return new Map([...entries].map(([id, name]) => [id.toLowerCase(), name] as const));
}

/** Prefer display name; fall back to Paseo-style short id (never the full UUID for UI/TTS). */
export function resolvePaseoAgentLabel(
  agentId: string,
  namesByAgentId?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): PaseoAgentLabel {
  const id = agentId.trim();
  const name = namesToMap(namesByAgentId).get(id.toLowerCase())?.trim();
  if (name) return { id, label: name, kind: "name" };
  return { id, label: shortPaseoAgentId(id), kind: "short" };
}

/**
 * Speech/display rewrite: @uuid → name, or short id when name unknown.
 * Leaves the stored message text (and reply tokens) unchanged at the source.
 */
export function speechTextWithAgentNames(
  text: string,
  namesByAgentId?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): string {
  return text.replace(PASEO_AGENT_MENTION, (_full, id: string) => {
    return resolvePaseoAgentLabel(id, namesByAgentId).label;
  });
}

export type PaseoMentionTextPart =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; label: string; kind: PaseoAgentLabelKind };

/** Split message body into text and mention segments for chip rendering. */
export function splitTextWithPaseoMentions(
  text: string,
  namesByAgentId?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): PaseoMentionTextPart[] {
  const parts: PaseoMentionTextPart[] = [];
  const re = new RegExp(PASEO_AGENT_MENTION.source, "gi");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const id = match[1]!;
    const resolved = resolvePaseoAgentLabel(id, namesByAgentId);
    parts.push({
      type: "mention",
      id: resolved.id,
      label: resolved.label,
      kind: resolved.kind,
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  if (parts.length === 0) parts.push({ type: "text", value: text });
  return parts;
}

/** Unique mentionees in document order (for a thin card strip under the message). */
export function uniquePaseoMentionsInText(
  text: string,
  namesByAgentId?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): PaseoAgentLabel[] {
  const seen = new Set<string>();
  const out: PaseoAgentLabel[] = [];
  const re = new RegExp(PASEO_AGENT_MENTION.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = match[1]!;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolvePaseoAgentLabel(id, namesByAgentId));
  }
  return out;
}
