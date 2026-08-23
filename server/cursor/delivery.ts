import path from "node:path";
import { hasExternalCliSessionWork } from "../external-cli/cli-session-busy.ts";
import { externalCliStateRoot } from "../external-cli/state-root.ts";
import { cursorSessionUuid } from "../session-id.ts";
import { getSession } from "../sessions.ts";

/** Cursor stores sessions under a per-cwd project dir (slashes/dots → dashes, no leading slash). */
export function cursorProjectDirName(cwd: string): string {
  return cwd.replace(/^\//, "").replace(/[/.]+/g, "-");
}

export function cursorSessionFilePath(cwd: string, sessionId: string): string {
  const chatId = cursorSessionUuid(sessionId);
  return path.join(
    externalCliStateRoot(),
    ".cursor",
    "projects",
    cursorProjectDirName(cwd),
    "agent-transcripts",
    chatId,
    `${chatId}.jsonl`,
  );
}

/** Bare chat uuid for `agent --resume`. */
export function resolveCursorResumeId(_cwd: string, sessionId: string): string {
  return cursorSessionUuid(sessionId);
}

export function resolveCursorModel(_cwd: string, sessionId: string): string | null {
  const session = getSession(sessionId);
  return session?.opencodeSelectedModel || null;
}

/** Busy + Stop while `cursor-agent -p` is still the open CLI turn, not leftover shells. */
export function isCursorSessionBusy(sessionId: string): boolean {
  return hasExternalCliSessionWork(sessionId);
}
