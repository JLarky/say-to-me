import { canonicalCwd } from "../external-cli/canonical-cwd.ts";
import { detectSessionBackend } from "../session-id.ts";
import { getSession } from "../sessions.ts";
import { parseCursorActivity, type CursorActivityItem } from "./activity.ts";
import { cursorSessionFilePath, isCursorSessionBusy } from "./delivery.ts";
import {
  createExternalCliActivityHub,
  EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT,
  EXTERNAL_CLI_ACTIVITY_MAX_LIMIT,
  type ExternalCliActivitySnapshot,
} from "../external-cli/activity-hub.ts";

export const CURSOR_ACTIVITY_DEFAULT_LIMIT = EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT;
export const CURSOR_ACTIVITY_MAX_LIMIT = EXTERNAL_CLI_ACTIVITY_MAX_LIMIT;

export type CursorActivitySnapshot = ExternalCliActivitySnapshot<CursorActivityItem>;

export function parseCursorActivityLimit(raw: string | undefined): number {
  const value = Number(raw ?? CURSOR_ACTIVITY_DEFAULT_LIMIT);
  if (!Number.isInteger(value) || value < 1) return CURSOR_ACTIVITY_DEFAULT_LIMIT;
  return Math.min(value, CURSOR_ACTIVITY_MAX_LIMIT);
}

export function limitCursorActivitySnapshot(
  snapshot: CursorActivitySnapshot,
  limit: number,
): CursorActivitySnapshot {
  return { ...snapshot, items: snapshot.items.slice(-limit) };
}

const cursorActivityHub = createExternalCliActivityHub<CursorActivityItem>({
  backendLabel: "cursor",
  isSessionBusy: isCursorSessionBusy,
  getSessionFilePath: (sessionId) => {
    if (detectSessionBackend(sessionId) !== "cursor") return null;
    const cwd = getSession(sessionId)?.cwd;
    if (!cwd) return null;
    return cursorSessionFilePath(canonicalCwd(cwd), sessionId);
  },
  parseActivity: (content, maxLimit) => parseCursorActivity(content, maxLimit),
});

export function shutdownCursorActivityHub(): void {
  cursorActivityHub.shutdown();
}

export async function getCursorActivitySnapshot(
  sessionId: string,
  limit = CURSOR_ACTIVITY_DEFAULT_LIMIT,
): Promise<CursorActivitySnapshot> {
  return cursorActivityHub.getSnapshot(sessionId, limit);
}

export function subscribeCursorActivity(
  sessionId: string,
  limit: number,
  listener: import("../activityHub.ts").ActivityListener<CursorActivitySnapshot>,
): () => void {
  return cursorActivityHub.subscribe(sessionId, limit, listener);
}
