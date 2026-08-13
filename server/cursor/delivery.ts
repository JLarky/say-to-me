import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { cursorDeliveryJobs } from "../db/drizzle-schema.ts";
import { drizzleDb } from "../db/index.ts";
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

export function isCursorSessionBusy(sessionId: string): boolean {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(cursorDeliveryJobs)
    .where(
      and(
        eq(cursorDeliveryJobs.cursorSessionId, sessionId),
        eq(cursorDeliveryJobs.status, "running"),
      ),
    )
    .get();
  return (row?.count ?? 0) > 0;
}
