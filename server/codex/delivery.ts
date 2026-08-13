import { and, eq, sql } from "drizzle-orm";
import { codexDeliveryJobs } from "../db/drizzle-schema.ts";
import { drizzleDb } from "../db/index.ts";
import { codexSessionUuid } from "../session-id.ts";
import { getSession } from "../sessions.ts";
import { isCodexReasoningEffort } from "../../src/codex-reasoning-effort.ts";
import type { CodexReasoningEffort } from "./reasoning-effort.ts";

/** Bare session uuid for `codex exec resume`. */
export function resolveCodexResumeId(_cwd: string, sessionId: string): string {
  return codexSessionUuid(sessionId);
}

export function resolveCodexModel(_cwd: string, sessionId: string): string | null {
  const session = getSession(sessionId);
  return session?.opencodeSelectedModel || null;
}

export function resolveCodexReasoningEffort(
  _cwd: string,
  sessionId: string,
): CodexReasoningEffort | null {
  const effort = getSession(sessionId)?.reasoningEffort;
  return isCodexReasoningEffort(effort) ? effort : null;
}

export function isCodexSessionBusy(sessionId: string): boolean {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(codexDeliveryJobs)
    .where(
      and(eq(codexDeliveryJobs.codexSessionId, sessionId), eq(codexDeliveryJobs.status, "running")),
    )
    .get();
  return (row?.count ?? 0) > 0;
}
