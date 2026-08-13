import { detectSessionBackend } from "../session-id.ts";
import { parseClaudeActivity, type ClaudeActivityItem } from "./activity.ts";
import { isClaudeSessionBusy } from "./delivery.ts";
import { resolveClaudeSessionJsonlPath } from "./resolve.ts";
import {
  createExternalCliActivityHub,
  EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT,
  EXTERNAL_CLI_ACTIVITY_MAX_LIMIT,
  type ExternalCliActivitySnapshot,
} from "../external-cli/activity-hub.ts";

export const CLAUDE_ACTIVITY_DEFAULT_LIMIT = EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT;
export const CLAUDE_ACTIVITY_MAX_LIMIT = EXTERNAL_CLI_ACTIVITY_MAX_LIMIT;

export type ClaudeActivitySnapshot = ExternalCliActivitySnapshot<ClaudeActivityItem>;

export function parseClaudeActivityLimit(raw: string | undefined): number {
  const value = Number(raw ?? CLAUDE_ACTIVITY_DEFAULT_LIMIT);
  if (!Number.isInteger(value) || value < 1) return CLAUDE_ACTIVITY_DEFAULT_LIMIT;
  return Math.min(value, CLAUDE_ACTIVITY_MAX_LIMIT);
}

export function limitClaudeActivitySnapshot(
  snapshot: ClaudeActivitySnapshot,
  limit: number,
): ClaudeActivitySnapshot {
  return { ...snapshot, items: snapshot.items.slice(-limit) };
}

const claudeActivityHub = createExternalCliActivityHub<ClaudeActivityItem>({
  backendLabel: "claude",
  isSessionBusy: isClaudeSessionBusy,
  getSessionFilePath: (sessionId) => {
    if (detectSessionBackend(sessionId) !== "claude") return null;
    return resolveClaudeSessionJsonlPath(sessionId);
  },
  parseActivity: (content, maxLimit) => parseClaudeActivity(content, maxLimit),
});

export function shutdownClaudeActivityHub(): void {
  claudeActivityHub.shutdown();
}

export async function getClaudeActivitySnapshot(
  sessionId: string,
  limit = CLAUDE_ACTIVITY_DEFAULT_LIMIT,
): Promise<ClaudeActivitySnapshot> {
  return claudeActivityHub.getSnapshot(sessionId, limit);
}

export function subscribeClaudeActivity(
  sessionId: string,
  limit: number,
  listener: import("../activityHub.ts").ActivityListener<ClaudeActivitySnapshot>,
): () => void {
  return claudeActivityHub.subscribe(sessionId, limit, listener);
}
