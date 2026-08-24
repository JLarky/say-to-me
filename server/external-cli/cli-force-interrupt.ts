import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  claudeDeliveryJobs,
  codexDeliveryJobs,
  cursorDeliveryJobs,
  grokDeliveryJobs,
} from "../db/drizzle-schema.ts";
import { drizzleDb } from "../db/index.ts";
import { stopClaudeSession } from "../claude/stop.ts";
import { stopCodexSession } from "../codex/stop.ts";
import { stopCursorSession } from "../cursor/stop.ts";
import { stopGrokSession } from "../grok/stop.ts";
import type { StopSessionOptions } from "./create-stop-session.ts";

/**
 * CLI Force send is Stop-then-deliver (docs/spec/force-send.md). Before a
 * forced message may be handed over, whatever provider turn currently holds
 * the session is stopped through the exact flow behind the
 * stop-cursor / stop-claude / stop-codex / stop-grok endpoints: its job is
 * cancelled ("Stopped by user."), the boo worker — and with it the CLI
 * process — is killed, and late output from the killed turn is fenced by the
 * same cancellation invariants as an explicit Stop.
 *
 * OpenCode is intentionally absent: inject-while-busy stays valid there.
 */

export type CliForceInterruptBackend = "cursor" | "claude" | "codex" | "grok";

type DeliveryJobsTable =
  | typeof claudeDeliveryJobs
  | typeof codexDeliveryJobs
  | typeof cursorDeliveryJobs
  | typeof grokDeliveryJobs;

type SessionIdColumn =
  | typeof claudeDeliveryJobs.claudeSessionId
  | typeof cursorDeliveryJobs.cursorSessionId
  | typeof codexDeliveryJobs.codexSessionId
  | typeof grokDeliveryJobs.grokSessionId;

type StopWithSession = (
  sessionId: string,
  options?: StopSessionOptions,
) => Promise<{ ok: true } | { ok: false; status: number; error: string }>;

const backendStops = {
  cursor: stopCursorSession,
  claude: stopClaudeSession,
  codex: stopCodexSession,
  grok: stopGrokSession,
} satisfies Record<CliForceInterruptBackend, StopWithSession>;

const backendTables = {
  cursor: { table: cursorDeliveryJobs, sessionIdColumn: cursorDeliveryJobs.cursorSessionId },
  claude: { table: claudeDeliveryJobs, sessionIdColumn: claudeDeliveryJobs.claudeSessionId },
  codex: { table: codexDeliveryJobs, sessionIdColumn: codexDeliveryJobs.codexSessionId },
  grok: { table: grokDeliveryJobs, sessionIdColumn: grokDeliveryJobs.grokSessionId },
} satisfies Record<
  CliForceInterruptBackend,
  { table: DeliveryJobsTable; sessionIdColumn: SessionIdColumn }
>;

function hasBusyTurn(
  table: DeliveryJobsTable,
  sessionIdColumn: SessionIdColumn,
  sessionId: string,
  keepMessageId: number,
): boolean {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(table)
    .where(
      and(
        eq(sessionIdColumn, sessionId),
        ne(table.messageId, keepMessageId),
        // Claimed and not yet settled: a worker holds it right now, whether or
        // not the prompt has been spawned yet.
        or(
          eq(table.status, "running"),
          // Crash-window belt: an unowned row whose open-turn marker survived.
          // Killing again is harmless; delivering past a live turn is not.
          and(isNotNull(table.promptDispatchedAt), isNull(table.cliTurnEndedAt)),
        ),
      ),
    )
    .get();
  return (row?.count ?? 0) > 0;
}

/**
 * Stop another delivery's in-flight CLI turn so a forced message can take the
 * session now. No-op when nothing is actually holding the provider: queued-but-
 * idle siblings are neither cancelled nor killed, and plain Stop semantics are
 * untouched. Best-effort like the Stop endpoint's own kill step — a failure to
 * interrupt is logged, never surfaced as a delivery error.
 */
export async function interruptBusyCliTurnForForceSend(
  backend: CliForceInterruptBackend,
  sessionId: string,
  keepMessageId: number,
): Promise<void> {
  const { table, sessionIdColumn } = backendTables[backend];
  let busy: boolean;
  try {
    busy = hasBusyTurn(table, sessionIdColumn, sessionId, keepMessageId);
  } catch (error) {
    console.error(`[cli-force-interrupt] ${backend} busy check failed for ${sessionId}:`, error);
    return;
  }
  if (!busy) return;

  try {
    const result = await backendStops[backend](sessionId, {
      keepMessageId,
      busyOnly: true,
    });
    if (!result.ok) {
      console.error(
        `[cli-force-interrupt] ${backend} stop refused for ${sessionId}: ${result.error}`,
      );
    }
  } catch (error) {
    console.error(`[cli-force-interrupt] ${backend} stop failed for ${sessionId}:`, error);
  }
}
