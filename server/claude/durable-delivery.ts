import { claudeDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  DbClaudeDeliveryJob,
  validateDb,
  type DbClaudeDeliveryJob as DbClaudeDeliveryJobRow,
  type DbMessage,
} from "../db/schemas.ts";
import type { Effect } from "effect";
import {
  createExternalCliDurableDelivery,
  type ExternalCliDeliveryJobKind,
} from "../external-cli/durable-delivery.ts";
import { ensureClaudeBooWorker } from "../external-cli/providers.ts";
import {
  resolveClaudeModel,
  resolveClaudeSessionFlag,
  type ClaudeSessionFlag,
} from "./delivery.ts";

const jobSelectColumns = {
  id: claudeDeliveryJobs.id,
  messageId: claudeDeliveryJobs.messageId,
  messageSessionId: claudeDeliveryJobs.messageSessionId,
  claudeSessionId: claudeDeliveryJobs.claudeSessionId,
  kind: claudeDeliveryJobs.kind,
  status: claudeDeliveryJobs.status,
  attemptCount: claudeDeliveryJobs.attemptCount,
  maxAttempts: claudeDeliveryJobs.maxAttempts,
  nextAttemptAt: claudeDeliveryJobs.nextAttemptAt,
  lockedAt: claudeDeliveryJobs.lockedAt,
  lockedBy: claudeDeliveryJobs.lockedBy,
  lastError: claudeDeliveryJobs.lastError,
  promptDispatchedAt: claudeDeliveryJobs.promptDispatchedAt,
  createdAt: claudeDeliveryJobs.createdAt,
  updatedAt: claudeDeliveryJobs.updatedAt,
};

const claudeDelivery = createExternalCliDurableDelivery<
  DbClaudeDeliveryJobRow,
  { cwd: string; sessionFlag: ClaudeSessionFlag; model?: string },
  "claudeSessionId",
  "claude"
>({
  backendLabel: "claude",
  envPrefix: "CLAUDE",
  realWorkerMode: "claude",
  sessionIdField: "claudeSessionId",
  runtimeKey: "claude",
  failureMessage: "Claude delivery failed.",
  unconfirmedMessage: "Couldn't confirm this reached Claude — check the session before retrying",
  noCwdMessage: "Claude session has no working directory.",
  jobsTable: claudeDeliveryJobs,
  sessionIdColumn: claudeDeliveryJobs.claudeSessionId,
  jobSelectColumns,
  validateJob: (row, context) => validateDb(DbClaudeDeliveryJob, row, context),
  resolveRuntime: (cwd, sessionId) => ({
    cwd,
    sessionFlag: resolveClaudeSessionFlag(cwd, sessionId),
    model: resolveClaudeModel(cwd, sessionId) ?? undefined,
  }),
  ensureBooWorker: ensureClaudeBooWorker,
  queueTag: "say-to-me/ClaudeDeliveryQueue",
  promptClientTag: "say-to-me/ClaudePromptClient",
  workerIdentityTag: "say-to-me/ClaudeWorkerIdentity",
});

export type ClaudeDeliveryJobKind = ExternalCliDeliveryJobKind;

export type EnqueueClaudeDeliveryInput = {
  messageId: number;
  messageSessionId: string;
  claudeSessionId: string;
  kind: ClaudeDeliveryJobKind;
  maxAttempts?: number;
};

export const enqueueClaudeDeliveryJob = claudeDelivery.enqueueDeliveryJob;
export const retryClaudeDeliveryJob = claudeDelivery.retryDeliveryJob;
export const hasClaudeOwedDeliveryWork = claudeDelivery.hasOwedDeliveryWork;
export const resumeClaudeDeliveryWorkers = claudeDelivery.resumePendingDeliveryWorkers;

export type ClaudeDeliveryQueueService = {
  claimNext: (
    workerId: string,
    claudeSessionId?: string,
  ) => Effect.Effect<DbClaudeDeliveryJobRow | null>;
  complete: (
    job: DbClaudeDeliveryJobRow,
    outcome: "sent" | "failed" | "cancelled",
  ) => Effect.Effect<boolean>;
  retry: (job: DbClaudeDeliveryJobRow, error: string) => Effect.Effect<boolean>;
  fail: (job: DbClaudeDeliveryJobRow, error: string) => Effect.Effect<boolean>;
  cancel: (job: DbClaudeDeliveryJobRow, reason: string) => Effect.Effect<boolean>;
  renew: (job: DbClaudeDeliveryJobRow) => Effect.Effect<DbClaudeDeliveryJobRow | null>;
};

export type ClaudePromptClientService = {
  sendPrompt: (job: DbClaudeDeliveryJobRow, message: DbMessage) => Effect.Effect<string, unknown>;
};

export type WorkerIdentityService = { id: string };

export type ClaudeDeliveryLease = DbClaudeDeliveryJobRow;

export type ClaimedClaudeDeliveryJob = {
  job: ClaudeDeliveryLease;
  claude: {
    cwd: string;
    sessionFlag: ClaudeSessionFlag;
  };
  message: DbMessage | null;
} | null;

export type ClaudeDeliveryEnv =
  | ClaudeDeliveryQueueService
  | ClaudePromptClientService
  | WorkerIdentityService;

export const ClaudeDeliveryQueue = claudeDelivery.DeliveryQueue;
export const ClaudePromptClient = claudeDelivery.PromptClient;
export const ClaudeWorkerIdentity = claudeDelivery.WorkerIdentity;
export const ClaudeDeliveryQueueLive = claudeDelivery.DeliveryQueueLive;
export const ClaudeWorkerIdentityLive = claudeDelivery.WorkerIdentityLive;
export const ClaudePromptClientLive = claudeDelivery.PromptClientLive;

export const claimClaudeDeliveryJobForWorker = claudeDelivery.claimDeliveryJobForWorker;
export const completeClaudeDeliveryJobFromWorker = claudeDelivery.completeDeliveryJobFromWorker;
export const retryClaudeDeliveryJobFromWorker = claudeDelivery.retryDeliveryJobFromWorker;
export const failClaudeDeliveryJobFromWorker = claudeDelivery.failDeliveryJobFromWorker;
export const markClaudeDeliveryJobDispatchedFromWorker =
  claudeDelivery.markDeliveryJobDispatchedFromWorker;
export const markClaudeDeliveryJobUnconfirmedFromWorker =
  claudeDelivery.markDeliveryJobUnconfirmedFromWorker;
export const cancelClaudeDeliveryJobFromWorker = claudeDelivery.cancelDeliveryJobFromWorker;
export const renewClaudeDeliveryJobFromWorker = claudeDelivery.renewDeliveryJobFromWorker;
export const confirmClaudeDeliveryFromObservedWork =
  claudeDelivery.confirmDispatchedDeliveryFromObservedWork;
export const confirmClaudeDeliveriesForSessionFromObservedWork =
  claudeDelivery.confirmDeliveriesForSessionFromObservedWork;
export const runClaudeDeliveryOnce = claudeDelivery.runDeliveryOnce;
export const claudeDeliveryWorkerLoop = claudeDelivery.deliveryWorkerLoop;
