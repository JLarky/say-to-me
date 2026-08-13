import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { grokDeliveryJobs } from "../db/drizzle-schema.ts";
import { drizzleDb } from "../db/index.ts";
import { externalCliStateRoot } from "../external-cli/state-root.ts";
import { grokSessionUuid } from "../session-id.ts";
import { getSession } from "../sessions.ts";

/** Grok stores sessions under ~/.grok/sessions/<encodeURIComponent(cwd)>/<bareId>/ */
export function grokProjectDirName(cwd: string): string {
  return encodeURIComponent(cwd);
}

export function grokSessionDir(cwd: string, sessionId: string): string {
  const chatId = grokSessionUuid(sessionId);
  return path.join(externalCliStateRoot(), ".grok", "sessions", grokProjectDirName(cwd), chatId);
}

export function grokTranscriptPath(cwd: string, sessionId: string): string {
  return path.join(grokSessionDir(cwd, sessionId), "chat_history.jsonl");
}

/** Bare chat uuid for grok --resume. */
export function resolveGrokResumeId(_cwd: string, sessionId: string): string {
  return grokSessionUuid(sessionId);
}

export function resolveGrokModel(_cwd: string, sessionId: string): string | null {
  const session = getSession(sessionId);
  return session?.opencodeSelectedModel || null;
}

export function isGrokSessionBusy(sessionId: string): boolean {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(grokDeliveryJobs)
    .where(
      and(eq(grokDeliveryJobs.grokSessionId, sessionId), eq(grokDeliveryJobs.status, "running")),
    )
    .get();
  return (row?.count ?? 0) > 0;
}
