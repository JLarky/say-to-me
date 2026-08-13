import { canonicalCwd } from "../external-cli/canonical-cwd.ts";
import { detectSessionBackend } from "../session-id.ts";
import { getSession } from "../sessions.ts";
import { parseGrokActivity, type GrokActivityItem } from "./activity.ts";
import { grokTranscriptPath, isGrokSessionBusy } from "./delivery.ts";
import {
  createExternalCliActivityHub,
  EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT,
  EXTERNAL_CLI_ACTIVITY_MAX_LIMIT,
  type ExternalCliActivitySnapshot,
} from "../external-cli/activity-hub.ts";

export const GROK_ACTIVITY_DEFAULT_LIMIT = EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT;
export const GROK_ACTIVITY_MAX_LIMIT = EXTERNAL_CLI_ACTIVITY_MAX_LIMIT;

export type GrokActivitySnapshot = ExternalCliActivitySnapshot<GrokActivityItem>;

export function parseGrokActivityLimit(raw: string | undefined): number {
  const value = Number(raw ?? GROK_ACTIVITY_DEFAULT_LIMIT);
  if (!Number.isInteger(value) || value < 1) return GROK_ACTIVITY_DEFAULT_LIMIT;
  return Math.min(value, GROK_ACTIVITY_MAX_LIMIT);
}

export function limitGrokActivitySnapshot(
  snapshot: GrokActivitySnapshot,
  limit: number,
): GrokActivitySnapshot {
  return { ...snapshot, items: snapshot.items.slice(-limit) };
}

const grokActivityHub = createExternalCliActivityHub<GrokActivityItem>({
  backendLabel: "grok",
  isSessionBusy: isGrokSessionBusy,
  getSessionFilePath: (sessionId) => {
    if (detectSessionBackend(sessionId) !== "grok") return null;
    const cwd = getSession(sessionId)?.cwd;
    if (!cwd) return null;
    return grokTranscriptPath(canonicalCwd(cwd), sessionId);
  },
  parseActivity: (content, maxLimit) => parseGrokActivity(content, maxLimit),
});

export function shutdownGrokActivityHub(): void {
  grokActivityHub.shutdown();
}

export async function getGrokActivitySnapshot(
  sessionId: string,
  limit = GROK_ACTIVITY_DEFAULT_LIMIT,
): Promise<GrokActivitySnapshot> {
  return grokActivityHub.getSnapshot(sessionId, limit);
}

export function subscribeGrokActivity(
  sessionId: string,
  limit: number,
  listener: import("../activityHub.ts").ActivityListener<GrokActivitySnapshot>,
): () => void {
  return grokActivityHub.subscribe(sessionId, limit, listener);
}
