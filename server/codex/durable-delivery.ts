import { codexDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  DbCodexDeliveryJob,
  validateDb,
  type DbCodexDeliveryJob as DbCodexDeliveryJobRow,
  type DbMessage,
} from "../db/schemas.ts";
import type { Effect } from "effect";
import {
  createExternalCliDurableDelivery,
  type ExternalCliDeliveryJobKind,
} from "../external-cli/durable-delivery.ts";
import { ensureCodexBooWorker } from "../external-cli/providers.ts";
import {
  resolveCodexModel,
  resolveCodexReasoningEffort,
  resolveCodexResumeId,
} from "./delivery.ts";
import { type CodexReasoningEffort } from "./reasoning-effort.ts";

const jobSelectColumns = {
  id: codexDeliveryJobs.id,
  messageId: codexDeliveryJobs.messageId,
  messageSessionId: codexDeliveryJobs.messageSessionId,
  codexSessionId: codexDeliveryJobs.codexSessionId,
  kind: codexDeliveryJobs.kind,
  status: codexDeliveryJobs.status,
  attemptCount: codexDeliveryJobs.attemptCount,
  maxAttempts: codexDeliveryJobs.maxAttempts,
  nextAttemptAt: codexDeliveryJobs.nextAttemptAt,
  lockedAt: codexDeliveryJobs.lockedAt,
  lockedBy: codexDeliveryJobs.lockedBy,
  lastError: codexDeliveryJobs.lastError,
  promptDispatchedAt: codexDeliveryJobs.promptDispatchedAt,
  createdAt: codexDeliveryJobs.createdAt,
  updatedAt: codexDeliveryJobs.updatedAt,
};

const codexDelivery = createExternalCliDurableDelivery<
  DbCodexDeliveryJobRow,
  { cwd: string; resumeId: string; model?: string; reasoningEffort?: CodexReasoningEffort },
  "codexSessionId",
  "codex"
>({
  backendLabel: "codex",
  envPrefix: "CODEX",
  realWorkerMode: "codex",
  sessionIdField: "codexSessionId",
  runtimeKey: "codex",
  failureMessage: "Codex delivery failed.",
  unconfirmedMessage: "Couldn't confirm this reached Codex — check the session before retrying",
  noCwdMessage: "Codex session has no working directory.",
  jobsTable: codexDeliveryJobs,
  sessionIdColumn: codexDeliveryJobs.codexSessionId,
  jobSelectColumns,
  validateJob: (row, context) => validateDb(DbCodexDeliveryJob, row, context),
  resolveRuntime: (cwd, sessionId) => ({
    cwd,
    resumeId: resolveCodexResumeId(cwd, sessionId),
    model: resolveCodexModel(cwd, sessionId) ?? undefined,
    reasoningEffort: resolveCodexReasoningEffort(cwd, sessionId) ?? undefined,
  }),
  ensureBooWorker: ensureCodexBooWorker,
  queueTag: "say-to-me/CodexDeliveryQueue",
  promptClientTag: "say-to-me/CodexPromptClient",
  workerIdentityTag: "say-to-me/CodexWorkerIdentity",
});

export type CodexDeliveryJobKind = ExternalCliDeliveryJobKind;

export type EnqueueCodexDeliveryInput = {
  messageId: number;
  messageSessionId: string;
  codexSessionId: string;
  kind: CodexDeliveryJobKind;
  maxAttempts?: number;
};

export const enqueueCodexDeliveryJob = codexDelivery.enqueueDeliveryJob;
export const retryCodexDeliveryJob = codexDelivery.retryDeliveryJob;
export const hasCodexOwedDeliveryWork = codexDelivery.hasOwedDeliveryWork;
export const resumeCodexDeliveryWorkers = codexDelivery.resumePendingDeliveryWorkers;

export type CodexDeliveryQueueService = {
  claimNext: (
    workerId: string,
    codexSessionId?: string,
  ) => Effect.Effect<DbCodexDeliveryJobRow | null>;
  complete: (
    job: DbCodexDeliveryJobRow,
    outcome: "sent" | "failed" | "cancelled",
  ) => Effect.Effect<boolean>;
  retry: (job: DbCodexDeliveryJobRow, error: string) => Effect.Effect<boolean>;
  fail: (job: DbCodexDeliveryJobRow, error: string) => Effect.Effect<boolean>;
  cancel: (job: DbCodexDeliveryJobRow, reason: string) => Effect.Effect<boolean>;
  renew: (job: DbCodexDeliveryJobRow) => Effect.Effect<DbCodexDeliveryJobRow | null>;
};

export type CodexPromptClientService = {
  sendPrompt: (job: DbCodexDeliveryJobRow, message: DbMessage) => Effect.Effect<string, unknown>;
};

export type WorkerIdentityService = { id: string };

export type CodexDeliveryLease = DbCodexDeliveryJobRow;

export type ClaimedCodexDeliveryJob = {
  job: CodexDeliveryLease;
  codex: {
    cwd: string;
    resumeId: string;
  };
  message: DbMessage | null;
} | null;

export type CodexDeliveryEnv =
  | CodexDeliveryQueueService
  | CodexPromptClientService
  | WorkerIdentityService;

export const CodexDeliveryQueue = codexDelivery.DeliveryQueue;
export const CodexPromptClient = codexDelivery.PromptClient;
export const CodexWorkerIdentity = codexDelivery.WorkerIdentity;
export const CodexDeliveryQueueLive = codexDelivery.DeliveryQueueLive;
export const CodexWorkerIdentityLive = codexDelivery.WorkerIdentityLive;
export const CodexPromptClientLive = codexDelivery.PromptClientLive;

export const claimCodexDeliveryJobForWorker = codexDelivery.claimDeliveryJobForWorker;
export const completeCodexDeliveryJobFromWorker = codexDelivery.completeDeliveryJobFromWorker;
export const retryCodexDeliveryJobFromWorker = codexDelivery.retryDeliveryJobFromWorker;
export const failCodexDeliveryJobFromWorker = codexDelivery.failDeliveryJobFromWorker;
export const markCodexDeliveryJobDispatchedFromWorker =
  codexDelivery.markDeliveryJobDispatchedFromWorker;
export const markCodexDeliveryJobUnconfirmedFromWorker =
  codexDelivery.markDeliveryJobUnconfirmedFromWorker;
export const cancelCodexDeliveryJobFromWorker = codexDelivery.cancelDeliveryJobFromWorker;
export const renewCodexDeliveryJobFromWorker = codexDelivery.renewDeliveryJobFromWorker;
export const confirmCodexDeliveryFromObservedWork =
  codexDelivery.confirmDispatchedDeliveryFromObservedWork;
export const confirmCodexDeliveriesForSessionFromObservedWork =
  codexDelivery.confirmDeliveriesForSessionFromObservedWork;
export const runCodexDeliveryOnce = codexDelivery.runDeliveryOnce;
export const codexDeliveryWorkerLoop = codexDelivery.deliveryWorkerLoop;
