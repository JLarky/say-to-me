import {
  getClaudeActivitySnapshot,
  subscribeClaudeActivity,
  type ClaudeActivitySnapshot,
} from "../claude/activity-hub.ts";
import {
  getCodexActivitySnapshot,
  subscribeCodexActivity,
  type CodexActivitySnapshot,
} from "../codex/activity-hub.ts";
import {
  getCursorActivitySnapshot,
  subscribeCursorActivity,
  type CursorActivitySnapshot,
} from "../cursor/activity-hub.ts";
import {
  getGrokActivitySnapshot,
  subscribeGrokActivity,
  type GrokActivitySnapshot,
} from "../grok/activity-hub.ts";
import {
  getPaseoActivitySnapshot,
  subscribePaseoActivity,
  type PaseoActivitySnapshot,
} from "../paseo/activity-hub.ts";
import { detectSessionBackend } from "../session-id.ts";
import type { ActivityListener } from "../activityHub.ts";

export type ExternalCliActivitySnapshot =
  | CursorActivitySnapshot
  | ClaudeActivitySnapshot
  | CodexActivitySnapshot
  | GrokActivitySnapshot
  | PaseoActivitySnapshot;

export async function getExternalCliActivitySnapshot(
  sessionId: string,
  limit: number,
): Promise<ExternalCliActivitySnapshot | null> {
  try {
    const backend = detectSessionBackend(sessionId);
    if (backend === "cursor") return await getCursorActivitySnapshot(sessionId, limit);
    if (backend === "claude") return await getClaudeActivitySnapshot(sessionId, limit);
    if (backend === "codex") return await getCodexActivitySnapshot(sessionId, limit);
    if (backend === "grok") return await getGrokActivitySnapshot(sessionId, limit);
    if (backend === "paseo") return await getPaseoActivitySnapshot(sessionId, limit);
    return null;
  } catch {
    return null;
  }
}

export function subscribeExternalCliActivity(
  sessionId: string,
  limit: number,
  listener: ActivityListener<ExternalCliActivitySnapshot>,
): () => void {
  const backend = detectSessionBackend(sessionId);
  if (backend === "cursor") return subscribeCursorActivity(sessionId, limit, listener);
  if (backend === "claude") return subscribeClaudeActivity(sessionId, limit, listener);
  if (backend === "codex") return subscribeCodexActivity(sessionId, limit, listener);
  if (backend === "grok") return subscribeGrokActivity(sessionId, limit, listener);
  if (backend === "paseo") return subscribePaseoActivity(sessionId, limit, listener);
  return () => {};
}
