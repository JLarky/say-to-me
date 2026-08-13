import { detectSessionBackend, codexSessionUuid } from "../session-id.ts";
import { parseCodexActivity, type CodexActivityItem } from "./activity.ts";
import { isCodexSessionBusy } from "./delivery.ts";
import { codexSessionJsonlPath } from "./resolve.ts";
import {
  createExternalCliActivityHub,
  EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT,
  EXTERNAL_CLI_ACTIVITY_MAX_LIMIT,
  type ExternalCliActivitySnapshot,
} from "../external-cli/activity-hub.ts";

export const CODEX_ACTIVITY_DEFAULT_LIMIT = EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT;
export const CODEX_ACTIVITY_MAX_LIMIT = EXTERNAL_CLI_ACTIVITY_MAX_LIMIT;

export type CodexActivitySnapshot = ExternalCliActivitySnapshot<CodexActivityItem>;

export function parseCodexActivityLimit(raw: string | undefined): number {
  const value = Number(raw ?? CODEX_ACTIVITY_DEFAULT_LIMIT);
  if (!Number.isInteger(value) || value < 1) return CODEX_ACTIVITY_DEFAULT_LIMIT;
  return Math.min(value, CODEX_ACTIVITY_MAX_LIMIT);
}

export function limitCodexActivitySnapshot(
  snapshot: CodexActivitySnapshot,
  limit: number,
): CodexActivitySnapshot {
  return { ...snapshot, items: snapshot.items.slice(-limit) };
}

const codexActivityHub = createExternalCliActivityHub<CodexActivityItem>({
  backendLabel: "codex",
  isSessionBusy: isCodexSessionBusy,
  getSessionFilePath: (sessionId) => {
    if (detectSessionBackend(sessionId) !== "codex") return null;
    return codexSessionJsonlPath(codexSessionUuid(sessionId));
  },
  parseActivity: (content, maxLimit) => parseCodexActivity(content, maxLimit),
});

export function shutdownCodexActivityHub(): void {
  codexActivityHub.shutdown();
}

export async function getCodexActivitySnapshot(
  sessionId: string,
  limit = CODEX_ACTIVITY_DEFAULT_LIMIT,
): Promise<CodexActivitySnapshot> {
  return codexActivityHub.getSnapshot(sessionId, limit);
}

export function subscribeCodexActivity(
  sessionId: string,
  limit: number,
  listener: import("../activityHub.ts").ActivityListener<CodexActivitySnapshot>,
): () => void {
  return codexActivityHub.subscribe(sessionId, limit, listener);
}
