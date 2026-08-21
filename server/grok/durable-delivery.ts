import { grokDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  DbGrokDeliveryJob,
  validateDb,
  type DbGrokDeliveryJob as DbGrokDeliveryJobRow,
  type DbMessage,
} from "../db/schemas.ts";
import type { Effect } from "effect";
import {
  createExternalCliDurableDelivery,
  type ExternalCliDeliveryJobKind,
} from "../external-cli/durable-delivery.ts";
import { ensureGrokBooWorker } from "../external-cli/providers.ts";
import { resolveGrokModel, resolveGrokResumeId } from "./delivery.ts";

const jobSelectColumns = {
  id: grokDeliveryJobs.id,
  messageId: grokDeliveryJobs.messageId,
  messageSessionId: grokDeliveryJobs.messageSessionId,
  grokSessionId: grokDeliveryJobs.grokSessionId,
  kind: grokDeliveryJobs.kind,
  status: grokDeliveryJobs.status,
  attemptCount: grokDeliveryJobs.attemptCount,
  maxAttempts: grokDeliveryJobs.maxAttempts,
  nextAttemptAt: grokDeliveryJobs.nextAttemptAt,
  lockedAt: grokDeliveryJobs.lockedAt,
  lockedBy: grokDeliveryJobs.lockedBy,
  lastError: grokDeliveryJobs.lastError,
  promptDispatchedAt: grokDeliveryJobs.promptDispatchedAt,
  createdAt: grokDeliveryJobs.createdAt,
  updatedAt: grokDeliveryJobs.updatedAt,
};

const grokDelivery = createExternalCliDurableDelivery<
  DbGrokDeliveryJobRow,
  { cwd: string; resumeId: string; model?: string },
  "grokSessionId",
  "grok"
>({
  backendLabel: "grok",
  envPrefix: "GROK",
  realWorkerMode: "grok",
  sessionIdField: "grokSessionId",
  runtimeKey: "grok",
  failureMessage: "Grok delivery failed.",
  unconfirmedMessage: "Couldn't confirm this reached Grok — check the session before retrying",
  noCwdMessage: "Grok session has no working directory.",
  jobsTable: grokDeliveryJobs,
  sessionIdColumn: grokDeliveryJobs.grokSessionId,
  jobSelectColumns,
  validateJob: (row, context) => validateDb(DbGrokDeliveryJob, row, context),
  resolveRuntime: (cwd, sessionId) => ({
    cwd,
    resumeId: resolveGrokResumeId(cwd, sessionId),
    model: resolveGrokModel(cwd, sessionId) ?? undefined,
  }),
  ensureBooWorker: ensureGrokBooWorker,
  queueTag: "say-to-me/GrokDeliveryQueue",
  promptClientTag: "say-to-me/GrokPromptClient",
  workerIdentityTag: "say-to-me/GrokWorkerIdentity",
});

export type GrokDeliveryJobKind = ExternalCliDeliveryJobKind;

export type EnqueueGrokDeliveryInput = {
  messageId: number;
  messageSessionId: string;
  grokSessionId: string;
  kind: GrokDeliveryJobKind;
  maxAttempts?: number;
};

export const enqueueGrokDeliveryJob = grokDelivery.enqueueDeliveryJob;
export const retryGrokDeliveryJob = grokDelivery.retryDeliveryJob;
export const hasGrokOwedDeliveryWork = grokDelivery.hasOwedDeliveryWork;
export const resumeGrokDeliveryWorkers = grokDelivery.resumePendingDeliveryWorkers;

export type GrokDeliveryQueueService = {
  claimNext: (
    workerId: string,
    grokSessionId?: string,
  ) => Effect.Effect<DbGrokDeliveryJobRow | null>;
  complete: (
    job: DbGrokDeliveryJobRow,
    outcome: "sent" | "failed" | "cancelled",
  ) => Effect.Effect<boolean>;
  retry: (job: DbGrokDeliveryJobRow, error: string) => Effect.Effect<boolean>;
  fail: (job: DbGrokDeliveryJobRow, error: string) => Effect.Effect<boolean>;
  cancel: (job: DbGrokDeliveryJobRow, reason: string) => Effect.Effect<boolean>;
  renew: (job: DbGrokDeliveryJobRow) => Effect.Effect<DbGrokDeliveryJobRow | null>;
};

export type GrokPromptClientService = {
  sendPrompt: (job: DbGrokDeliveryJobRow, message: DbMessage) => Effect.Effect<string, unknown>;
};

export type WorkerIdentityService = { id: string };

export type GrokDeliveryLease = DbGrokDeliveryJobRow;

export type ClaimedGrokDeliveryJob = {
  job: GrokDeliveryLease;
  grok: {
    cwd: string;
    resumeId: string;
    model?: string;
  };
  message: DbMessage | null;
} | null;

export type GrokDeliveryEnv =
  | GrokDeliveryQueueService
  | GrokPromptClientService
  | WorkerIdentityService;

export const GrokDeliveryQueue = grokDelivery.DeliveryQueue;
export const GrokPromptClient = grokDelivery.PromptClient;
export const GrokWorkerIdentity = grokDelivery.WorkerIdentity;
export const GrokDeliveryQueueLive = grokDelivery.DeliveryQueueLive;
export const GrokWorkerIdentityLive = grokDelivery.WorkerIdentityLive;
export const GrokPromptClientLive = grokDelivery.PromptClientLive;

export const claimGrokDeliveryJobForWorker = grokDelivery.claimDeliveryJobForWorker;
export const completeGrokDeliveryJobFromWorker = grokDelivery.completeDeliveryJobFromWorker;
export const retryGrokDeliveryJobFromWorker = grokDelivery.retryDeliveryJobFromWorker;
export const failGrokDeliveryJobFromWorker = grokDelivery.failDeliveryJobFromWorker;
export const markGrokDeliveryJobDispatchedFromWorker =
  grokDelivery.markDeliveryJobDispatchedFromWorker;
export const markGrokDeliveryJobUnconfirmedFromWorker =
  grokDelivery.markDeliveryJobUnconfirmedFromWorker;
export const cancelGrokDeliveryJobFromWorker = grokDelivery.cancelDeliveryJobFromWorker;
export const renewGrokDeliveryJobFromWorker = grokDelivery.renewDeliveryJobFromWorker;
export const confirmGrokDeliveryFromObservedWork =
  grokDelivery.confirmDispatchedDeliveryFromObservedWork;
export const confirmGrokDeliveriesForSessionFromObservedWork =
  grokDelivery.confirmDeliveriesForSessionFromObservedWork;
export const runGrokDeliveryOnce = grokDelivery.runDeliveryOnce;
export const grokDeliveryWorkerLoop = grokDelivery.deliveryWorkerLoop;
