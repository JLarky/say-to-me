import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzleDb } from "../db/index.ts";
import {
  claudeDeliveryJobs,
  codexDeliveryJobs,
  cursorDeliveryJobs,
  grokDeliveryJobs,
} from "../db/drizzle-schema.ts";
import { detectSessionBackend } from "../session-id.ts";

const QUEUED_JOB_STATUSES = ["pending", "retrying"] as const;

type CliJobsTable =
  | typeof claudeDeliveryJobs
  | typeof cursorDeliveryJobs
  | typeof codexDeliveryJobs
  | typeof grokDeliveryJobs;

type CliSessionColumn =
  | typeof claudeDeliveryJobs.claudeSessionId
  | typeof cursorDeliveryJobs.cursorSessionId
  | typeof codexDeliveryJobs.codexSessionId
  | typeof grokDeliveryJobs.grokSessionId;

/**
 * True while an external CLI session still owes delivery work or has an open
 * CLI turn. A `running` row whose turn already ended is not busy: process-end
 * is the idle signal even if the complete CAS has not landed yet.
 * Safe to import from `messages.ts` (no cycle through durable-delivery).
 */
export function hasExternalCliSessionWork(sessionId: string): boolean {
  const backend = detectSessionBackend(sessionId);
  if (backend === "claude") {
    return isBusy(claudeDeliveryJobs, claudeDeliveryJobs.claudeSessionId, sessionId);
  }
  if (backend === "cursor") {
    return isBusy(cursorDeliveryJobs, cursorDeliveryJobs.cursorSessionId, sessionId);
  }
  if (backend === "codex") {
    return isBusy(codexDeliveryJobs, codexDeliveryJobs.codexSessionId, sessionId);
  }
  if (backend === "grok") {
    return isBusy(grokDeliveryJobs, grokDeliveryJobs.grokSessionId, sessionId);
  }
  return false;
}

function isBusy(table: CliJobsTable, sessionColumn: CliSessionColumn, sessionId: string): boolean {
  const queued = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(table)
    .where(and(eq(sessionColumn, sessionId), inArray(table.status, QUEUED_JOB_STATUSES)))
    .get();
  if ((queued?.count ?? 0) > 0) return true;
  const claimedNotDispatched = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(table)
    .where(
      and(
        eq(sessionColumn, sessionId),
        eq(table.status, "running"),
        isNull(table.promptDispatchedAt),
      ),
    )
    .get();
  if ((claimedNotDispatched?.count ?? 0) > 0) return true;
  const openTurn = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(table)
    .where(
      and(
        eq(sessionColumn, sessionId),
        isNotNull(table.promptDispatchedAt),
        isNull(table.cliTurnEndedAt),
      ),
    )
    .get();
  return (openTurn?.count ?? 0) > 0;
}
