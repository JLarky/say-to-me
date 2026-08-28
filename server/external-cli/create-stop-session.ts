import { and, eq, inArray, sql } from "drizzle-orm";
import { BooDriver } from "../boo/driver.ts";
import type {
  claudeDeliveryJobs,
  codexDeliveryJobs,
  cursorDeliveryJobs,
  grokDeliveryJobs,
} from "../db/drizzle-schema.ts";
import { drizzleDb } from "../db/index.ts";
import {
  stopExternalCliSession,
  type ActiveDeliveryJob,
  type StopExternalCliResult,
} from "./stop-session.ts";

export type { StopExternalCliResult };

/** Options for the Stop-flow reuse behind CLI Force send (see force-send.md). */
export type StopSessionOptions = {
  /** The forced message's own delivery is not cancelled by its own force send. */
  keepMessageId?: number;
  /**
   * Cancel only jobs whose provider turn is in flight. Queued-but-idle
   * messages keep waiting; only what actually holds the CLI gets stopped.
   */
  busyOnly?: boolean;
};

type DeliveryJobsTable =
  | typeof claudeDeliveryJobs
  | typeof cursorDeliveryJobs
  | typeof codexDeliveryJobs
  | typeof grokDeliveryJobs;

type SessionIdColumn =
  | typeof claudeDeliveryJobs.claudeSessionId
  | typeof cursorDeliveryJobs.cursorSessionId
  | typeof codexDeliveryJobs.codexSessionId
  | typeof grokDeliveryJobs.grokSessionId;

export type CreateStopSessionConfig = {
  backendLabel: string;
  deliveryJobsTable: DeliveryJobsTable;
  sessionIdColumn: SessionIdColumn;
  isValidSessionId: (sessionId: string) => boolean;
  invalidSessionIdError: string;
  workerName: (sessionId: string) => string;
  booDriver?: Pick<BooDriver, "killSession">;
};

function nowSql() {
  return sql`CURRENT_TIMESTAMP`;
}

export function createStopSession(config: CreateStopSessionConfig) {
  const {
    deliveryJobsTable,
    sessionIdColumn,
    isValidSessionId,
    invalidSessionIdError,
    workerName,
  } = config;

  function cancelActiveJob(jobId: number): number {
    const result = drizzleDb
      .update(deliveryJobsTable)
      .set({
        status: "cancelled",
        lockedAt: null,
        lockedBy: null,
        lastError: "Stopped by user.",
        cliTurnEndedAt: sql`COALESCE(${deliveryJobsTable.cliTurnEndedAt}, ${Date.now()})`,
        updatedAt: nowSql(),
      })
      .where(
        and(
          eq(deliveryJobsTable.id, jobId),
          inArray(deliveryJobsTable.status, ["running", "pending", "retrying"]),
        ),
      )
      .run();
    return result.changes;
  }

  function listActiveJobs(sessionId: string, busyOnly = false): ActiveDeliveryJob[] {
    return drizzleDb
      .select({
        id: deliveryJobsTable.id,
        messageId: deliveryJobsTable.messageId,
        status: deliveryJobsTable.status,
      })
      .from(deliveryJobsTable)
      .where(
        and(
          eq(sessionIdColumn, sessionId),
          inArray(deliveryJobsTable.status, ["running", "pending", "retrying"]),
        ),
      )
      .all()
      .filter((row) => !busyOnly || row.status === "running");
  }

  return function stopSession(
    sessionId: string,
    options: StopSessionOptions = {},
  ): Promise<StopExternalCliResult> {
    return stopExternalCliSession({
      sessionId,
      isValidSessionId,
      invalidSessionIdError,
      listActiveJobs: () => listActiveJobs(sessionId, options.busyOnly === true),
      cancelJob: cancelActiveJob,
      keepMessageIds: options.keepMessageId != null ? [options.keepMessageId] : undefined,
      busyOnly: options.busyOnly === true,
      killWorker: async (activeSessionId) => {
        await (config.booDriver ?? new BooDriver()).killSession(workerName(activeSessionId));
      },
    });
  };
}
