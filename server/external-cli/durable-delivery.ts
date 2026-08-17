import { and, asc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import { Effect, Layer, Schedule } from "effect";
import { randomUUID } from "node:crypto";
import {
  DeliveryEffectsError,
  ExternalCliDeliveryQueueError,
  makeExternalCliDeliveryWorkflow,
  MessageStoreError,
  type DeliveryEffectsService,
  type DeliveryMessage,
  type DeliveryQueueService,
  type ExternalCliDeliveryJob,
  type ExternalCliDeliveryJobKind,
  type MessageStoreService,
  type PromptClientService,
  type WorkerIdentityService,
} from "@say-to-me/external-cli-delivery/workflow";
import { broadcastQueue } from "../broadcast.ts";
import type {
  claudeDeliveryJobs,
  codexDeliveryJobs,
  cursorDeliveryJobs,
  grokDeliveryJobs,
} from "../db/drizzle-schema.ts";
import { drizzleDb } from "../db/index.ts";
import type { DbMessage } from "../db/schemas.ts";
import { insertExternalAgentReply } from "./agent-reply.ts";
import {
  getMessage,
  markCompletionWorkSeen,
  updateForwardStatus,
  updateForwardTarget,
  updateOpencodeDelivery,
} from "../messages.ts";
import { getSession } from "../sessions.ts";
import {
  startForwardCompletionNotificationWatch,
  startIdleNotificationWatch,
} from "../notifications.ts";
import { echoReplyDelayMs, workerMode, type ExternalCliWorkerEnvPrefix } from "./worker-env.ts";

export type { ExternalCliDeliveryJobKind } from "@say-to-me/external-cli-delivery/workflow";

export type ExternalCliDeliveryJobRow = {
  id: number;
  messageId: number;
  messageSessionId: string;
  kind: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lockedAt: number | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

const WORKER_POLL_MS = Number(process.env.SAY_TO_ME_EXTERNAL_CLI_DELIVERY_POLL_MS || 250);
const JOB_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

type DeliveryJobsTable =
  | typeof claudeDeliveryJobs
  | typeof cursorDeliveryJobs
  | typeof codexDeliveryJobs
  | typeof grokDeliveryJobs;

type DeliveryJobSelectColumns =
  | {
      id: typeof claudeDeliveryJobs.id;
      messageId: typeof claudeDeliveryJobs.messageId;
      messageSessionId: typeof claudeDeliveryJobs.messageSessionId;
      claudeSessionId: typeof claudeDeliveryJobs.claudeSessionId;
      kind: typeof claudeDeliveryJobs.kind;
      status: typeof claudeDeliveryJobs.status;
      attemptCount: typeof claudeDeliveryJobs.attemptCount;
      maxAttempts: typeof claudeDeliveryJobs.maxAttempts;
      nextAttemptAt: typeof claudeDeliveryJobs.nextAttemptAt;
      lockedAt: typeof claudeDeliveryJobs.lockedAt;
      lockedBy: typeof claudeDeliveryJobs.lockedBy;
      lastError: typeof claudeDeliveryJobs.lastError;
      createdAt: typeof claudeDeliveryJobs.createdAt;
      updatedAt: typeof claudeDeliveryJobs.updatedAt;
    }
  | {
      id: typeof cursorDeliveryJobs.id;
      messageId: typeof cursorDeliveryJobs.messageId;
      messageSessionId: typeof cursorDeliveryJobs.messageSessionId;
      cursorSessionId: typeof cursorDeliveryJobs.cursorSessionId;
      kind: typeof cursorDeliveryJobs.kind;
      status: typeof cursorDeliveryJobs.status;
      attemptCount: typeof cursorDeliveryJobs.attemptCount;
      maxAttempts: typeof cursorDeliveryJobs.maxAttempts;
      nextAttemptAt: typeof cursorDeliveryJobs.nextAttemptAt;
      lockedAt: typeof cursorDeliveryJobs.lockedAt;
      lockedBy: typeof cursorDeliveryJobs.lockedBy;
      lastError: typeof cursorDeliveryJobs.lastError;
      createdAt: typeof cursorDeliveryJobs.createdAt;
      updatedAt: typeof cursorDeliveryJobs.updatedAt;
    }
  | {
      id: typeof codexDeliveryJobs.id;
      messageId: typeof codexDeliveryJobs.messageId;
      messageSessionId: typeof codexDeliveryJobs.messageSessionId;
      codexSessionId: typeof codexDeliveryJobs.codexSessionId;
      kind: typeof codexDeliveryJobs.kind;
      status: typeof codexDeliveryJobs.status;
      attemptCount: typeof codexDeliveryJobs.attemptCount;
      maxAttempts: typeof codexDeliveryJobs.maxAttempts;
      nextAttemptAt: typeof codexDeliveryJobs.nextAttemptAt;
      lockedAt: typeof codexDeliveryJobs.lockedAt;
      lockedBy: typeof codexDeliveryJobs.lockedBy;
      lastError: typeof codexDeliveryJobs.lastError;
      createdAt: typeof codexDeliveryJobs.createdAt;
      updatedAt: typeof codexDeliveryJobs.updatedAt;
    }
  | {
      id: typeof grokDeliveryJobs.id;
      messageId: typeof grokDeliveryJobs.messageId;
      messageSessionId: typeof grokDeliveryJobs.messageSessionId;
      grokSessionId: typeof grokDeliveryJobs.grokSessionId;
      kind: typeof grokDeliveryJobs.kind;
      status: typeof grokDeliveryJobs.status;
      attemptCount: typeof grokDeliveryJobs.attemptCount;
      maxAttempts: typeof grokDeliveryJobs.maxAttempts;
      nextAttemptAt: typeof grokDeliveryJobs.nextAttemptAt;
      lockedAt: typeof grokDeliveryJobs.lockedAt;
      lockedBy: typeof grokDeliveryJobs.lockedBy;
      lastError: typeof grokDeliveryJobs.lastError;
      createdAt: typeof grokDeliveryJobs.createdAt;
      updatedAt: typeof grokDeliveryJobs.updatedAt;
    };

type SessionIdColumn =
  | typeof claudeDeliveryJobs.claudeSessionId
  | typeof cursorDeliveryJobs.cursorSessionId
  | typeof codexDeliveryJobs.codexSessionId
  | typeof grokDeliveryJobs.grokSessionId;

export type ExternalCliDurableDeliveryConfig<
  TJob extends ExternalCliDeliveryJobRow & Record<TSessionIdField, string>,
  TRuntime,
  TSessionIdField extends string,
  TRuntimeKey extends string,
> = {
  backendLabel: string;
  envPrefix: ExternalCliWorkerEnvPrefix;
  realWorkerMode: string;
  sessionIdField: TSessionIdField;
  runtimeKey: TRuntimeKey;
  failureMessage: string;
  noCwdMessage: string;
  jobsTable: DeliveryJobsTable;
  sessionIdColumn: SessionIdColumn;
  jobSelectColumns: DeliveryJobSelectColumns;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each worker validates its raw database row with its schema-derived validator.
  validateJob: (row: unknown, context: string) => TJob;
  resolveRuntime: (cwd: string, sessionId: string) => TRuntime;
  ensureBooWorker: (sessionId: string) => Promise<boolean>;
  queueTag: string;
  promptClientTag: string;
  workerIdentityTag: string;
};

export function createExternalCliDurableDelivery<
  TJob extends ExternalCliDeliveryJobRow & Record<TSessionIdField, string>,
  TRuntime,
  TSessionIdField extends string,
  TRuntimeKey extends string,
>(config: ExternalCliDurableDeliveryConfig<TJob, TRuntime, TSessionIdField, TRuntimeKey>) {
  type EnqueueInput = {
    messageId: number;
    messageSessionId: string;
    kind: ExternalCliDeliveryJobKind;
    maxAttempts?: number;
  } & Record<TSessionIdField, string>;

  type ClaimedJob = {
    job: TJob;
    message: DbMessage | null;
  } & Record<TRuntimeKey, TRuntime>;

  const sessionIdColumn = config.sessionIdColumn;

  function nowSql() {
    return sql`CURRENT_TIMESTAMP`;
  }

  function retryDelayMs(attemptCount: number): number {
    return Math.min(30_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
  }

  function loadJob(id: number): TJob | null {
    const row = drizzleDb
      .select(config.jobSelectColumns)
      .from(config.jobsTable)
      .where(eq(config.jobsTable.id, id))
      .limit(1)
      .get();
    return row ? config.validateJob(row, `${config.backendLabel}DeliveryJob`) : null;
  }

  function getSessionId(job: TJob): string {
    return job[config.sessionIdField];
  }

  function enqueueDeliveryJob(input: EnqueueInput): TJob {
    const sessionId = input[config.sessionIdField];
    const result = drizzleDb.transaction((tx) => {
      const insertResult = tx
        .insert(config.jobsTable)
        .values({
          messageId: input.messageId,
          messageSessionId: input.messageSessionId,
          [config.sessionIdField]: sessionId,
          kind: input.kind,
          status: "pending",
          maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          nextAttemptAt: Date.now(),
        })
        .onConflictDoNothing()
        .run();
      const created = insertResult.changes === 1;

      const row = tx
        .select(config.jobSelectColumns)
        .from(config.jobsTable)
        .where(
          and(
            eq(config.jobsTable.messageId, input.messageId),
            eq(config.jobsTable.kind, input.kind),
          ),
        )
        .limit(1)
        .get();
      if (!row) throw new Error(`Failed to enqueue ${config.backendLabel} delivery job.`);

      if (created) {
        updateOpencodeDelivery(input.messageId, "queued", null, null);
        return config.validateJob(row, `enqueue${config.backendLabel}DeliveryJob`);
      }

      const job = config.validateJob(row, `enqueue${config.backendLabel}DeliveryJob`);
      if (job.status === "succeeded" || job.status === "cancelled") {
        return job;
      }
      if (job.status === "failed") {
        const cas = tx
          .update(config.jobsTable)
          .set({
            status: "pending",
            nextAttemptAt: Date.now(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            updatedAt: nowSql(),
          })
          .where(and(eq(config.jobsTable.id, job.id), eq(config.jobsTable.status, "failed")))
          .run();
        if (cas.changes === 1) {
          updateOpencodeDelivery(input.messageId, "queued", null, null);
        }
        const refreshed = tx
          .select(config.jobSelectColumns)
          .from(config.jobsTable)
          .where(eq(config.jobsTable.id, job.id))
          .limit(1)
          .get();
        if (!refreshed) {
          throw new Error(`Failed to load ${config.backendLabel} delivery job after enqueue.`);
        }
        return config.validateJob(refreshed, `enqueue${config.backendLabel}DeliveryJob`);
      }
      return job;
    });
    void config.ensureBooWorker(sessionId).catch((error) => {
      console.error(
        `[${config.backendLabel}-delivery] failed to ensure boo worker for ${sessionId}:`,
        error,
      );
    });
    return result;
  }

  function resumePendingDeliveryWorkers(): void {
    const rows = drizzleDb
      .select({ sessionId: sessionIdColumn })
      .from(config.jobsTable)
      .where(inArray(config.jobsTable.status, ["pending", "retrying", "running"]))
      .all();
    const sessionIds = new Set(
      rows.flatMap((row) => (typeof row.sessionId === "string" ? [row.sessionId] : [])),
    );
    for (const sessionId of sessionIds) {
      void config.ensureBooWorker(sessionId).catch((error) => {
        console.error(
          `[${config.backendLabel}-delivery] failed to resume boo worker for ${sessionId}:`,
          error,
        );
      });
    }
  }

  const workflow = makeExternalCliDeliveryWorkflow(`say-to-me/${config.backendLabel}`, {
    failureMessage: config.failureMessage,
  });
  const {
    DeliveryQueue,
    PromptClient,
    WorkerIdentity,
    MessageStore,
    DeliveryEffects,
    runDeliveryOnce: runWorkflowOnce,
  } = workflow;

  function tryQueue<A>(try_: () => A): Effect.Effect<A, ExternalCliDeliveryQueueError> {
    return Effect.try({
      try: try_,
      catch: (cause) => new ExternalCliDeliveryQueueError({ cause }),
    });
  }

  function tryStore<A>(try_: () => A): Effect.Effect<A, MessageStoreError> {
    return Effect.try({
      try: try_,
      catch: (cause) => new MessageStoreError({ cause }),
    });
  }

  function tryEffects<A>(try_: () => A): Effect.Effect<A, DeliveryEffectsError> {
    return Effect.try({
      try: try_,
      catch: (cause) => new DeliveryEffectsError({ cause }),
    });
  }

  function toWorkflowJob(job: TJob): ExternalCliDeliveryJob {
    return {
      id: job.id,
      messageId: job.messageId,
      messageSessionId: job.messageSessionId,
      externalSessionId: getSessionId(job),
      kind: job.kind,
      status: job.status,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      nextAttemptAt: job.nextAttemptAt,
      lockedAt: job.lockedAt,
      lockedBy: job.lockedBy,
      lastError: job.lastError,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  function toDeliveryMessage(message: DbMessage): DeliveryMessage {
    return {
      id: message.id,
      sessionId: message.sessionId,
      text: message.text,
      opencodeDeliveryStatus: message.opencodeDeliveryStatus,
      forwardRole: message.forwardRole,
      forwardSourceSessionId: message.forwardSourceSessionId,
      forwardSourceMessageId: message.forwardSourceMessageId,
      completionWatchStatus: message.completionWatchStatus,
      completionSourceSessionId: message.completionSourceSessionId,
      completionSourceMessageId: message.completionSourceMessageId,
    };
  }

  function leaseWhere(
    job: Pick<ExternalCliDeliveryJob, "id" | "attemptCount" | "lockedAt" | "lockedBy">,
  ): SQL | undefined {
    if (job.lockedAt == null || job.lockedBy == null) return sql`1 = 0`;
    return and(
      eq(config.jobsTable.id, job.id),
      eq(config.jobsTable.status, "running"),
      eq(config.jobsTable.attemptCount, job.attemptCount),
      eq(config.jobsTable.lockedAt, job.lockedAt),
      eq(config.jobsTable.lockedBy, job.lockedBy),
    );
  }

  const DeliveryQueueLive = Layer.succeed(DeliveryQueue, {
    claimNext: (workerId, sessionId) =>
      tryQueue(() => {
        const now = Date.now();
        const staleBefore = now - JOB_LEASE_MS;
        drizzleDb
          .update(config.jobsTable)
          .set({ status: "retrying", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
          .where(
            and(
              eq(config.jobsTable.status, "running"),
              lte(config.jobsTable.lockedAt, staleBefore),
            ),
          )
          .run();

        const candidate = drizzleDb.transaction((tx) => {
          const where = sessionId
            ? and(
                inArray(config.jobsTable.status, ["pending", "retrying"]),
                eq(sessionIdColumn, sessionId),
                lte(config.jobsTable.nextAttemptAt, now),
              )
            : and(
                inArray(config.jobsTable.status, ["pending", "retrying"]),
                lte(config.jobsTable.nextAttemptAt, now),
              );
          const rows = tx
            .select(config.jobSelectColumns)
            .from(config.jobsTable)
            .where(where)
            .orderBy(asc(config.jobsTable.id))
            .all();
          const row = rows.find((candidateRow) => {
            const candidateJob = config.validateJob(
              candidateRow,
              `claim${config.backendLabel}DeliveryJob`,
            );
            const running = tx
              .select({ count: sql<number>`COUNT(*)` })
              .from(config.jobsTable)
              .where(
                and(
                  eq(sessionIdColumn, getSessionId(candidateJob)),
                  eq(config.jobsTable.status, "running"),
                ),
              )
              .get();
            return (running?.count ?? 0) === 0;
          });
          if (!row) return null;
          const job = config.validateJob(row, `claim${config.backendLabel}DeliveryJob`);
          const claimed = tx
            .update(config.jobsTable)
            .set({
              status: "running",
              attemptCount: job.attemptCount + 1,
              lockedAt: now,
              lockedBy: workerId,
              updatedAt: nowSql(),
            })
            .where(
              and(
                eq(config.jobsTable.id, job.id),
                inArray(config.jobsTable.status, ["pending", "retrying"]),
              ),
            )
            .run();
          if (claimed.changes === 0) return null;
          const loaded = loadJob(job.id);
          return loaded ? toWorkflowJob(loaded) : null;
        });
        return candidate;
      }),
    complete: (job, outcome) =>
      tryQueue(() => {
        const result = drizzleDb
          .update(config.jobsTable)
          .set({
            status: outcome === "cancelled" ? "cancelled" : "succeeded",
            lockedAt: null,
            lockedBy: null,
            updatedAt: nowSql(),
          })
          .where(leaseWhere(job))
          .run();
        return result.changes > 0;
      }),
    retry: (job, error) =>
      tryQueue(() => {
        const result = drizzleDb
          .update(config.jobsTable)
          .set({
            status: "retrying",
            nextAttemptAt: Date.now() + retryDelayMs(job.attemptCount),
            lockedAt: null,
            lockedBy: null,
            lastError: error,
            updatedAt: nowSql(),
          })
          .where(leaseWhere(job))
          .run();
        return result.changes > 0;
      }),
    fail: (job, error) =>
      tryQueue(() => {
        const result = drizzleDb
          .update(config.jobsTable)
          .set({
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            lastError: error,
            updatedAt: nowSql(),
          })
          .where(leaseWhere(job))
          .run();
        return result.changes > 0;
      }),
    cancel: (job, reason) =>
      tryQueue(() => {
        const result = drizzleDb
          .update(config.jobsTable)
          .set({
            status: "cancelled",
            lockedAt: null,
            lockedBy: null,
            lastError: reason,
            updatedAt: nowSql(),
          })
          .where(leaseWhere(job))
          .run();
        return result.changes > 0;
      }),
    renew: (job) =>
      tryQueue(() => {
        const result = drizzleDb
          .update(config.jobsTable)
          .set({ lockedAt: Date.now(), updatedAt: nowSql() })
          .where(leaseWhere(job))
          .run();
        if (result.changes === 0) return null;
        const loaded = loadJob(job.id);
        return loaded ? toWorkflowJob(loaded) : null;
      }),
  } satisfies DeliveryQueueService);

  const MessageStoreLive = Layer.succeed(MessageStore, {
    getMessage: (id) =>
      tryStore(() => {
        const message = getMessage(id);
        return message ? toDeliveryMessage(message) : null;
      }),
    updateOpencodeDelivery: (id, status, error, opencodeMessageId) =>
      tryStore(() => updateOpencodeDelivery(id, status ?? "queued", error, opencodeMessageId)),
    markCompletionWorkSeen: (id) => tryStore(() => markCompletionWorkSeen(id)),
    updateForwardStatus: (id, status) => tryStore(() => updateForwardStatus(id, status)),
    updateForwardTarget: (sourceMessageId, targetMessageId, status) =>
      tryStore(() => updateForwardTarget(sourceMessageId, targetMessageId, status)),
  } satisfies MessageStoreService);

  const DeliveryEffectsLive = Layer.succeed(DeliveryEffects, {
    broadcastQueue: (sessionId) => tryEffects(() => broadcastQueue(sessionId ?? undefined)),
    insertAgentReply: (sessionId, reply) =>
      tryEffects(() => {
        insertExternalAgentReply(sessionId, reply);
      }),
    startForwardCompletionNotificationWatch: (input) =>
      tryEffects(() => startForwardCompletionNotificationWatch(input)),
    startIdleNotificationWatch: (input) => tryEffects(() => startIdleNotificationWatch(input)),
  } satisfies DeliveryEffectsService);

  function queueProgram<A>(effect: Effect.Effect<A, unknown, DeliveryQueueService>): Promise<A> {
    return Effect.runPromise(effect.pipe(Effect.provide(DeliveryQueueLive)));
  }

  function afterDelivery(job: TJob, message: DbMessage): void {
    if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
      updateForwardTarget(message.forwardSourceMessageId, message.id, "sent");
      updateForwardStatus(message.id, "sent");
    }
    updateOpencodeDelivery(message.id, "sent", null, null);
    broadcastQueue(message.sessionId);
    const externalSessionId = getSessionId(job);
    if (message.sessionId !== externalSessionId) broadcastQueue(externalSessionId);

    if (job.kind === "forward_target_message") {
      if (message.completionWatchStatus === "watching") {
        startForwardCompletionNotificationWatch({
          sourceMessageId:
            message.completionSourceMessageId ?? message.forwardSourceMessageId ?? message.id,
          sourceSessionId:
            message.completionSourceSessionId ??
            message.forwardSourceSessionId ??
            message.sessionId,
          targetMessageId: message.id,
          targetSessionId: externalSessionId,
          seenWorking: true,
        });
      } else {
        startIdleNotificationWatch({
          sessionId: externalSessionId,
          triggerMessageId: message.id,
          seenWorking: true,
        });
      }
    } else if (job.kind === "direct_user_message") {
      startIdleNotificationWatch({
        sessionId: externalSessionId,
        triggerMessageId: message.id,
        seenWorking: true,
      });
    }
  }

  function afterDeliveryFailure(message: DbMessage, error = config.failureMessage): void {
    updateOpencodeDelivery(message.id, "failed", error, null);
    if (message.forwardRole) updateForwardStatus(message.id, "failed");
    if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
      updateForwardTarget(message.forwardSourceMessageId, message.id, "failed");
    }
    broadcastQueue(message.sessionId);
  }

  function claimDeliveryJobForWorker(
    workerId: string,
    sessionId?: string,
  ): Promise<ClaimedJob | null> {
    return queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        const claimed = yield* queue.claimNext(workerId, sessionId);
        if (!claimed) return null;
        const job = loadJob(claimed.id);
        if (!job) return null;
        const message = getMessage(job.messageId);
        const cwd = getSession(getSessionId(job))?.cwd;
        if (!cwd) {
          yield* queue.fail(claimed, config.noCwdMessage);
          if (message) afterDeliveryFailure(message, config.noCwdMessage);
          return null;
        }
        if (message) {
          updateOpencodeDelivery(message.id, "pending", null, null);
          if (message.completionWatchStatus === "watching") markCompletionWorkSeen(message.id);
          broadcastQueue(message.sessionId);
        }
        return {
          job,
          [config.runtimeKey]: config.resolveRuntime(cwd, getSessionId(job)),
          message,
        } as ClaimedJob;
      }),
    );
  }

  async function completeDeliveryJobFromWorker(job: TJob, reply: string | null): Promise<boolean> {
    const message = getMessage(job.messageId);
    const completed = await queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.complete(toWorkflowJob(job), "sent");
      }),
    );
    if (!completed || !message) return completed;
    if (reply != null) insertExternalAgentReply(getSessionId(job), reply);
    afterDelivery(job, message);
    return true;
  }

  async function retryDeliveryJobFromWorker(job: TJob, error: string): Promise<boolean> {
    const message = getMessage(job.messageId);
    const retried = await queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.retry(toWorkflowJob(job), error);
      }),
    );
    if (retried && message) updateOpencodeDelivery(message.id, "queued", error, null);
    if (message) broadcastQueue(message.sessionId);
    return retried;
  }

  async function failDeliveryJobFromWorker(job: TJob, error: string): Promise<boolean> {
    const message = getMessage(job.messageId);
    const failed = await queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.fail(toWorkflowJob(job), error);
      }),
    );
    if (failed && message) afterDeliveryFailure(message, error);
    if (message) broadcastQueue(message.sessionId);
    return failed;
  }

  async function cancelDeliveryJobFromWorker(job: TJob, reason: string): Promise<boolean> {
    return queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.cancel(toWorkflowJob(job), reason);
      }),
    );
  }

  async function renewDeliveryJobFromWorker(job: TJob): Promise<TJob | null> {
    const renewed = await queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.renew(toWorkflowJob(job));
      }),
    );
    return renewed ? loadJob(renewed.id) : null;
  }

  const WorkerIdentityLive = Layer.succeed(WorkerIdentity, {
    id: `${config.backendLabel}-delivery-${process.pid}-${randomUUID()}`,
  } satisfies WorkerIdentityService);

  const PromptClientLive = Layer.succeed(PromptClient, {
    sendPrompt: (_job, message) => {
      if (workerMode(config.envPrefix) !== "echo") {
        return Effect.fail(
          new Error(`Only echo ${config.backendLabel} worker mode is implemented.`),
        );
      }
      const delayMs = echoReplyDelayMs(config.envPrefix);
      return Effect.sleep(`${delayMs} millis`).pipe(
        Effect.as(`Echo from ${config.backendLabel} worker: ${message.text}`),
      );
    },
  } satisfies PromptClientService);

  function runDeliveryOnce(sessionId?: string) {
    return runWorkflowOnce(sessionId).pipe(
      Effect.provide(MessageStoreLive),
      Effect.provide(DeliveryEffectsLive),
    );
  }

  const DeliveryLive = Layer.mergeAll(
    DeliveryQueueLive,
    PromptClientLive,
    WorkerIdentityLive,
    MessageStoreLive,
    DeliveryEffectsLive,
  );

  function deliveryWorkerLoop(sessionId: string): Effect.Effect<void> {
    return runWorkflowOnce(sessionId).pipe(
      Effect.zipRight(Effect.void),
      Effect.repeat(Schedule.spaced(`${WORKER_POLL_MS} millis`)),
      Effect.provide(DeliveryLive),
    );
  }

  return {
    enqueueDeliveryJob,
    resumePendingDeliveryWorkers,
    claimDeliveryJobForWorker,
    completeDeliveryJobFromWorker,
    retryDeliveryJobFromWorker,
    failDeliveryJobFromWorker,
    cancelDeliveryJobFromWorker,
    renewDeliveryJobFromWorker,
    runDeliveryOnce,
    deliveryWorkerLoop,
    DeliveryQueue,
    PromptClient,
    WorkerIdentity,
    DeliveryQueueLive,
    WorkerIdentityLive,
    PromptClientLive,
    MessageStoreLive,
    DeliveryEffectsLive,
    DeliveryLive,
  };
}
