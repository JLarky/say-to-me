import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzleDb } from "../db/index.ts";
import {
  claudeDeliveryJobs,
  codexDeliveryJobs,
  cursorDeliveryJobs,
  grokDeliveryJobs,
} from "../db/drizzle-schema.ts";
import { hasLiveChild } from "./live-child.ts";
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
 * True while an external CLI session still owes delivery work or has a live
 * spawned CLI child. A stamped `cli_turn_ended_at` is not the busy signal:
 * Stop stays on for the whole child lifetime (false late over false early).
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
  return hasLiveChild(sessionId);
}

/**
 * Latest CLI delivery job's dispatch marker for this message.
 * `undefined` — no CLI job (OpenCode / unknown).
 * `null` — job exists but the prompt never reached the CLI.
 * `number` — `cursor-agent -p` (or sibling) was spawned.
 */
export function getExternalCliPromptDispatchedAt(messageId: number): number | null | undefined {
  for (const table of [
    cursorDeliveryJobs,
    claudeDeliveryJobs,
    codexDeliveryJobs,
    grokDeliveryJobs,
  ]) {
    const row = drizzleDb
      .select({ promptDispatchedAt: table.promptDispatchedAt })
      .from(table)
      .where(eq(table.messageId, messageId))
      .orderBy(desc(table.id))
      .limit(1)
      .get();
    if (row) return row.promptDispatchedAt;
  }
  return undefined;
}
