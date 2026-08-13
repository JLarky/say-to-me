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

  function listActiveJobs(sessionId: string): ActiveDeliveryJob[] {
    return drizzleDb
      .select({ id: deliveryJobsTable.id, messageId: deliveryJobsTable.messageId })
      .from(deliveryJobsTable)
      .where(
        and(
          eq(sessionIdColumn, sessionId),
          inArray(deliveryJobsTable.status, ["running", "pending", "retrying"]),
        ),
      )
      .all();
  }

  return function stopSession(sessionId: string): Promise<StopExternalCliResult> {
    return stopExternalCliSession({
      sessionId,
      isValidSessionId,
      invalidSessionIdError,
      listActiveJobs,
      cancelJob: cancelActiveJob,
      killWorker: async (activeSessionId) => {
        await new BooDriver().killSession(workerName(activeSessionId));
      },
    });
  };
}
