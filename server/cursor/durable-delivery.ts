import { cursorDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  DbCursorDeliveryJob,
  validateDb,
  type DbCursorDeliveryJob as DbCursorDeliveryJobRow,
  type DbMessage,
} from "../db/schemas.ts";
import type { Effect } from "effect";
import {
  createExternalCliDurableDelivery,
  type ExternalCliDeliveryJobKind,
} from "../external-cli/durable-delivery.ts";
import { ensureCursorBooWorker } from "../external-cli/providers.ts";
import { resolveCursorModel, resolveCursorResumeId } from "./delivery.ts";

const jobSelectColumns = {
  id: cursorDeliveryJobs.id,
  messageId: cursorDeliveryJobs.messageId,
  messageSessionId: cursorDeliveryJobs.messageSessionId,
  cursorSessionId: cursorDeliveryJobs.cursorSessionId,
  kind: cursorDeliveryJobs.kind,
  status: cursorDeliveryJobs.status,
  force: cursorDeliveryJobs.force,
  attemptCount: cursorDeliveryJobs.attemptCount,
  maxAttempts: cursorDeliveryJobs.maxAttempts,
  nextAttemptAt: cursorDeliveryJobs.nextAttemptAt,
  lockedAt: cursorDeliveryJobs.lockedAt,
  lockedBy: cursorDeliveryJobs.lockedBy,
  lastError: cursorDeliveryJobs.lastError,
  promptDispatchedAt: cursorDeliveryJobs.promptDispatchedAt,
  cliTurnEndedAt: cursorDeliveryJobs.cliTurnEndedAt,
  createdAt: cursorDeliveryJobs.createdAt,
  updatedAt: cursorDeliveryJobs.updatedAt,
};

const cursorDelivery = createExternalCliDurableDelivery<
  DbCursorDeliveryJobRow,
  { cwd: string; resumeId: string; model?: string },
  "cursorSessionId",
  "cursor"
>({
  backendLabel: "cursor",
  envPrefix: "CURSOR",
  realWorkerMode: "cursor",
  sessionIdField: "cursorSessionId",
  runtimeKey: "cursor",
  failureMessage: "Cursor delivery failed.",
  unconfirmedMessage: "Couldn't confirm this reached Cursor — check the session before retrying",
  noCwdMessage: "Cursor session has no working directory.",
  jobsTable: cursorDeliveryJobs,
  sessionIdColumn: cursorDeliveryJobs.cursorSessionId,
  forceColumn: cursorDeliveryJobs.force,
  jobSelectColumns,
  validateJob: (row, context) => validateDb(DbCursorDeliveryJob, row, context),
  resolveRuntime: (cwd, sessionId) => ({
    cwd,
    resumeId: resolveCursorResumeId(cwd, sessionId),
    model: resolveCursorModel(cwd, sessionId) ?? undefined,
  }),
  ensureBooWorker: ensureCursorBooWorker,
  queueTag: "say-to-me/CursorDeliveryQueue",
  promptClientTag: "say-to-me/CursorPromptClient",
  workerIdentityTag: "say-to-me/CursorWorkerIdentity",
});

export type CursorDeliveryJobKind = ExternalCliDeliveryJobKind;

export type EnqueueCursorDeliveryInput = {
  messageId: number;
  messageSessionId: string;
  cursorSessionId: string;
  kind: CursorDeliveryJobKind;
  maxAttempts?: number;
  /** Skip the wait-for-idle hold (composer force variant / user Force send). */
  force?: boolean;
};

export const enqueueCursorDeliveryJob = cursorDelivery.enqueueDeliveryJob;
export const retryCursorDeliveryJob = cursorDelivery.retryDeliveryJob;
export const hasCursorOwedDeliveryWork = cursorDelivery.hasOwedDeliveryWork;
export const hasCursorOpenCliTurn = cursorDelivery.hasOpenCliTurn;
export const resumeCursorDeliveryWorkers = cursorDelivery.resumePendingDeliveryWorkers;

export type CursorDeliveryQueueService = {
  claimNext: (
    workerId: string,
    cursorSessionId?: string,
  ) => Effect.Effect<DbCursorDeliveryJobRow | null>;
  complete: (
    job: DbCursorDeliveryJobRow,
    outcome: "sent" | "failed" | "cancelled",
  ) => Effect.Effect<boolean>;
  retry: (job: DbCursorDeliveryJobRow, error: string) => Effect.Effect<boolean>;
  fail: (job: DbCursorDeliveryJobRow, error: string) => Effect.Effect<boolean>;
  cancel: (job: DbCursorDeliveryJobRow, reason: string) => Effect.Effect<boolean>;
  renew: (job: DbCursorDeliveryJobRow) => Effect.Effect<DbCursorDeliveryJobRow | null>;
};

export type CursorPromptClientService = {
  sendPrompt: (job: DbCursorDeliveryJobRow, message: DbMessage) => Effect.Effect<string, unknown>;
};

export type WorkerIdentityService = { id: string };

export type CursorDeliveryLease = DbCursorDeliveryJobRow;

export type ClaimedCursorDeliveryJob = {
  job: CursorDeliveryLease;
  cursor: {
    cwd: string;
    resumeId: string;
  };
  message: DbMessage | null;
} | null;

export type CursorDeliveryEnv =
  | CursorDeliveryQueueService
  | CursorPromptClientService
  | WorkerIdentityService;

export const CursorDeliveryQueue = cursorDelivery.DeliveryQueue;
export const CursorPromptClient = cursorDelivery.PromptClient;
export const CursorWorkerIdentity = cursorDelivery.WorkerIdentity;
export const CursorDeliveryQueueLive = cursorDelivery.DeliveryQueueLive;
export const CursorWorkerIdentityLive = cursorDelivery.WorkerIdentityLive;
export const CursorPromptClientLive = cursorDelivery.PromptClientLive;

export const claimCursorDeliveryJobForWorker = cursorDelivery.claimDeliveryJobForWorker;
export const completeCursorDeliveryJobFromWorker = cursorDelivery.completeDeliveryJobFromWorker;
export const retryCursorDeliveryJobFromWorker = cursorDelivery.retryDeliveryJobFromWorker;
export const failCursorDeliveryJobFromWorker = cursorDelivery.failDeliveryJobFromWorker;
export const markCursorDeliveryJobDispatchedFromWorker =
  cursorDelivery.markDeliveryJobDispatchedFromWorker;
export const markCursorDeliveryJobCliTurnEndedFromWorker =
  cursorDelivery.markDeliveryJobCliTurnEndedFromWorker;
export const markCursorDeliveryJobUnconfirmedFromWorker =
  cursorDelivery.markDeliveryJobUnconfirmedFromWorker;
export const cancelCursorDeliveryJobFromWorker = cursorDelivery.cancelDeliveryJobFromWorker;
export const renewCursorDeliveryJobFromWorker = cursorDelivery.renewDeliveryJobFromWorker;
export const confirmCursorDeliveryFromObservedWork =
  cursorDelivery.confirmDispatchedDeliveryFromObservedWork;
export const confirmCursorDeliveriesForSessionFromObservedWork =
  cursorDelivery.confirmDeliveriesForSessionFromObservedWork;
export const runCursorDeliveryOnce = cursorDelivery.runDeliveryOnce;
export const cursorDeliveryWorkerLoop = cursorDelivery.deliveryWorkerLoop;
