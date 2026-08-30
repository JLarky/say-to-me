import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { Effect, Layer, Schedule } from "effect";
import { randomUUID } from "node:crypto";
import {
  DeliveryEffectsError,
  ExternalCliDeliveryQueueError,
  makeExternalCliDeliveryWorkflow,
  MessageStoreError,
  ProviderNotStartedError,
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
import {
  messages as messagesTable,
  type claudeDeliveryJobs,
  type codexDeliveryJobs,
  type cursorDeliveryJobs,
  type grokDeliveryJobs,
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
  checkIdleNotification,
  startForwardCompletionNotificationWatch,
  startIdleNotificationWatch,
} from "../notifications.ts";
import { echoReplyDelayMs, workerMode, type ExternalCliWorkerEnvPrefix } from "./worker-env.ts";
import { sessionHasLaterAgentReply } from "../session-has-later-agent-reply.ts";
import { isLiveCompletionWatchStatus } from "@say-to-me/completion-watch/workflow";

export type { ExternalCliDeliveryJobKind } from "@say-to-me/external-cli-delivery/workflow";

export type ExternalCliDeliveryJobRow = {
  id: number;
  messageId: number;
  messageSessionId: string;
  kind: string;
  status: string;
  force: number;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lockedAt: number | null;
  lockedBy: string | null;
  lastError: string | null;
  promptDispatchedAt: number | null;
  cliTurnEndedAt: number | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Terminal and unowned, so a human retry may reset the row and clear the
 * dispatch marker without stranding a worker mid-flight.
 */
const RETRYABLE_JOB_STATUSES = ["failed", "cancelled"] as const;

/**
 * Delivery a session still owes an agent: claimed (`running`), waiting for a
 * worker (`pending`), or backing off between attempts (`retrying`). Only
 * `running` means a prompt is in front of the agent right now, but none of the
 * three mean the session is done with the relay, so completion watches must not
 * read any of them as idle.
 */
const OWED_JOB_STATUSES = ["pending", "retrying", "running"] as const;

/**
 * Why a human retry did or did not resend. `in_flight` and `already_delivered`
 * are refusals: the route turns them into a 409 rather than a silent success,
 * because the caller asked us to send something we deliberately did not send.
 */
export type RetryDeliveryOutcome = "retried" | "already_queued" | "in_flight" | "already_delivered";

export type RetryDeliveryJobResult<TJob> = {
  outcome: RetryDeliveryOutcome;
  job: TJob;
};

const WORKER_POLL_MS = Number(process.env.SAY_TO_ME_EXTERNAL_CLI_DELIVERY_POLL_MS || 250);

/**
 * How long a dispatched job's open-turn marker may sit untouched before a
 * sweeper closes it. Generous by design: real CLI turns renew their lease and
 * bump `updated_at` throughout, so only abandoned/legacy rows go quiet this
 * long. Override exists for tests.
 */
export function cliTurnStaleMs(): number {
  const raw = Number(process.env.SAY_TO_ME_CLI_TURN_STALE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 15 * 60_000;
}
/** Lease for in-flight delivery jobs. Not a turn-end signal — a ~100s CLI turn outlives this. */
export const JOB_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

type DeliveryJobsTable =
  | typeof claudeDeliveryJobs
  | typeof cursorDeliveryJobs
  | typeof codexDeliveryJobs
  | typeof grokDeliveryJobs;

type ForceColumn =
  | typeof claudeDeliveryJobs.force
  | typeof cursorDeliveryJobs.force
  | typeof codexDeliveryJobs.force
  | typeof grokDeliveryJobs.force;

type DeliveryJobSelectColumns =
  | {
      id: typeof claudeDeliveryJobs.id;
      messageId: typeof claudeDeliveryJobs.messageId;
      messageSessionId: typeof claudeDeliveryJobs.messageSessionId;
      claudeSessionId: typeof claudeDeliveryJobs.claudeSessionId;
      kind: typeof claudeDeliveryJobs.kind;
      status: typeof claudeDeliveryJobs.status;
      force: typeof claudeDeliveryJobs.force;
      attemptCount: typeof claudeDeliveryJobs.attemptCount;
      maxAttempts: typeof claudeDeliveryJobs.maxAttempts;
      nextAttemptAt: typeof claudeDeliveryJobs.nextAttemptAt;
      lockedAt: typeof claudeDeliveryJobs.lockedAt;
      lockedBy: typeof claudeDeliveryJobs.lockedBy;
      lastError: typeof claudeDeliveryJobs.lastError;
      promptDispatchedAt: typeof claudeDeliveryJobs.promptDispatchedAt;
      cliTurnEndedAt: typeof claudeDeliveryJobs.cliTurnEndedAt;
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
      force: typeof cursorDeliveryJobs.force;
      attemptCount: typeof cursorDeliveryJobs.attemptCount;
      maxAttempts: typeof cursorDeliveryJobs.maxAttempts;
      nextAttemptAt: typeof cursorDeliveryJobs.nextAttemptAt;
      lockedAt: typeof cursorDeliveryJobs.lockedAt;
      lockedBy: typeof cursorDeliveryJobs.lockedBy;
      lastError: typeof cursorDeliveryJobs.lastError;
      promptDispatchedAt: typeof cursorDeliveryJobs.promptDispatchedAt;
      cliTurnEndedAt: typeof cursorDeliveryJobs.cliTurnEndedAt;
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
      force: typeof codexDeliveryJobs.force;
      attemptCount: typeof codexDeliveryJobs.attemptCount;
      maxAttempts: typeof codexDeliveryJobs.maxAttempts;
      nextAttemptAt: typeof codexDeliveryJobs.nextAttemptAt;
      lockedAt: typeof codexDeliveryJobs.lockedAt;
      lockedBy: typeof codexDeliveryJobs.lockedBy;
      lastError: typeof codexDeliveryJobs.lastError;
      promptDispatchedAt: typeof codexDeliveryJobs.promptDispatchedAt;
      cliTurnEndedAt: typeof codexDeliveryJobs.cliTurnEndedAt;
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
      force: typeof grokDeliveryJobs.force;
      attemptCount: typeof grokDeliveryJobs.attemptCount;
      maxAttempts: typeof grokDeliveryJobs.maxAttempts;
      nextAttemptAt: typeof grokDeliveryJobs.nextAttemptAt;
      lockedAt: typeof grokDeliveryJobs.lockedAt;
      lockedBy: typeof grokDeliveryJobs.lockedBy;
      lastError: typeof grokDeliveryJobs.lastError;
      promptDispatchedAt: typeof grokDeliveryJobs.promptDispatchedAt;
      cliTurnEndedAt: typeof grokDeliveryJobs.cliTurnEndedAt;
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
  /**
   * Reported when a job was handed to the provider but its outcome is unknown.
   * Surfaced as `failed` with this explanation so the user can retry after checking.
   */
  unconfirmedMessage: string;
  noCwdMessage: string;
  jobsTable: DeliveryJobsTable;
  sessionIdColumn: SessionIdColumn;
  forceColumn: ForceColumn;
  jobSelectColumns: DeliveryJobSelectColumns;
  validateJob: (row: unknown, context: string) => TJob;
  resolveRuntime: (cwd: string, sessionId: string) => TRuntime;
  ensureBooWorker: (sessionId: string) => Promise<unknown>;
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
    /**
     * Skip the wait-for-idle hold for this delivery (composer force variant or
     * an explicit user Force send). Timing only: durability, the dispatch
     * marker, and failure reporting are unchanged.
     */
    force?: boolean;
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

  function loadLatestJobForMessage(messageId: number): TJob | null {
    const row = drizzleDb
      .select(config.jobSelectColumns)
      .from(config.jobsTable)
      .where(eq(config.jobsTable.messageId, messageId))
      .orderBy(desc(config.jobsTable.id))
      .limit(1)
      .get();
    return row ? config.validateJob(row, `${config.backendLabel}DeliveryJob`) : null;
  }

  function getSessionId(job: TJob): string {
    return job[config.sessionIdField];
  }

  /**
   * Mark a terminal/running job succeeded without clearing the dispatch marker
   * or creating a new attempt — confirmation only, never a re-prompt.
   */
  function markJobConfirmedWithoutReprompt(job: TJob): void {
    drizzleDb
      .update(config.jobsTable)
      .set({
        status: "succeeded",
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        updatedAt: nowSql(),
      })
      .where(
        and(
          eq(config.jobsTable.id, job.id),
          inArray(config.jobsTable.status, ["failed", "running", "retrying", "cancelled"]),
        ),
      )
      .run();
  }

  /**
   * Phase B: if the prompt was dispatched and the session later shows agent
   * work, treat delivery as confirmed (`sent`) without enqueueing again.
   */
  function confirmDispatchedDeliveryFromObservedWork(messageId: number): boolean {
    const message = getMessage(messageId);
    if (!message) return false;
    if (message.opencodeDeliveryStatus === "sent") return false;
    if (
      message.opencodeDeliveryStatus !== "failed" &&
      message.opencodeDeliveryStatus !== "pending" &&
      message.opencodeDeliveryStatus !== "queued"
    ) {
      return false;
    }
    const job = loadLatestJobForMessage(messageId);
    if (job == null || job.promptDispatchedAt == null) return false;
    // A `running` job is a turn still in flight: the agent posting a progress
    // message is not the end of it. Completing the job here would drop the
    // worker's real reply on the lease compare-and-set and make the session read
    // idle mid-turn, which notifies a relay source before the work is done.
    // Expired leases are swept to retrying/failed first and confirm from there.
    if (job.status === "running") return false;
    if (!sessionHasLaterAgentReply(message, job.promptDispatchedAt)) return false;
    markJobConfirmedWithoutReprompt(job);
    afterDelivery(job, message);
    return true;
  }

  function confirmDeliveriesForSessionFromObservedWork(sessionId: string): number {
    const candidates = drizzleDb
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.sessionId, sessionId),
          inArray(messagesTable.opencodeDeliveryStatus, ["failed", "pending", "queued"]),
        ),
      )
      .all();
    let confirmed = 0;
    for (const candidate of candidates) {
      if (confirmDispatchedDeliveryFromObservedWork(candidate.id)) confirmed += 1;
    }
    return confirmed;
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
          force: input.force ? 1 : 0,
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
        // Revive only jobs whose prompt never reached the provider. The marker is
        // never cleared, so a dispatched job stays terminal across re-enqueues.
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
          .where(
            and(
              eq(config.jobsTable.id, job.id),
              eq(config.jobsTable.status, "failed"),
              isNull(config.jobsTable.promptDispatchedAt),
            ),
          )
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

  /**
   * Human override: reset a terminal delivery job and clear the dispatch marker
   * so it can be sent again. Automatic re-enqueue paths must not clear it.
   *
   * Only `failed` and `cancelled` qualify. Both are terminal with no worker
   * holding the lease, so clearing the marker cannot strand anyone. A `running`
   * job must be refused: resetting it would break the in-flight worker's
   * lease CAS (`leaseHeld` matches on status, attemptCount and lockedBy), and a
   * second worker would then claim the cleared row and prompt the agent again —
   * the duplicate turn the marker exists to forbid. Two retries racing on a
   * `failed` job hit the same hazard, which is why the status is re-read and
   * gated inside the transaction rather than trusted from the caller.
   *
   * `force` marks the user's explicit Force send: a queued-but-held message is
   * flipped to forcing so its next claim skips the wait-for-idle hold, and a
   * reset keeps forcing like OpenCode's retry does.
   */
  function retryDeliveryJob(
    messageId: number,
    { force = false }: { force?: boolean } = {},
  ): RetryDeliveryJobResult<TJob> | null {
    const context = `retry${config.backendLabel}DeliveryJob`;
    const result = drizzleDb.transaction((tx) => {
      const row = tx
        .select(config.jobSelectColumns)
        .from(config.jobsTable)
        .where(eq(config.jobsTable.messageId, messageId))
        .orderBy(asc(config.jobsTable.id))
        .limit(1)
        .get();
      if (!row) return null;
      let job = config.validateJob(row, context);

      // A worker is mid-flight, or the prompt already landed: leave both the row
      // and the marker exactly as they are.
      if (job.status === "running") return { outcome: "in_flight" as const, job };
      if (job.status === "succeeded") return { outcome: "already_delivered" as const, job };
      // Another attempt is already coming. Idempotent: never clear a marker we
      // cannot prove is unowned. A forced request upgrades the hold to a
      // force-send so the next claim hands over immediately.
      if (job.status === "pending" || job.status === "retrying") {
        if (!force || job.force === 1) return { outcome: "already_queued" as const, job };
        const flipped = tx
          .update(config.jobsTable)
          .set({ force: 1, updatedAt: nowSql() })
          .where(
            and(
              eq(config.jobsTable.id, job.id),
              inArray(config.jobsTable.status, ["pending", "retrying"]),
            ),
          )
          .run();
        if (flipped.changes === 0) return { outcome: "in_flight" as const, job };
        const refreshedRow = tx
          .select(config.jobSelectColumns)
          .from(config.jobsTable)
          .where(eq(config.jobsTable.id, job.id))
          .limit(1)
          .get();
        if (!refreshedRow) {
          throw new Error(`Failed to load ${config.backendLabel} delivery job after force.`);
        }
        job = config.validateJob(refreshedRow, context);
        return { outcome: "already_queued" as const, job };
      }

      const reset = tx
        .update(config.jobsTable)
        .set({
          status: "pending",
          nextAttemptAt: Date.now(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          promptDispatchedAt: null,
          cliTurnEndedAt: null,
          // A force-send retry keeps forcing; otherwise preserve the job's flag.
          force: force ? 1 : job.force,
          updatedAt: nowSql(),
        })
        .where(
          and(
            eq(config.jobsTable.id, job.id),
            inArray(config.jobsTable.status, RETRYABLE_JOB_STATUSES),
          ),
        )
        .run();
      if (reset.changes === 0) return { outcome: "in_flight" as const, job };

      updateOpencodeDelivery(messageId, "queued", null, null);
      const refreshed = tx
        .select(config.jobSelectColumns)
        .from(config.jobsTable)
        .where(eq(config.jobsTable.id, job.id))
        .limit(1)
        .get();
      if (!refreshed) {
        throw new Error(`Failed to load ${config.backendLabel} delivery job after retry.`);
      }
      return { outcome: "retried" as const, job: config.validateJob(refreshed, context) };
    });

    if (!result) return null;
    // A reset job with no worker polling its session sits pending forever, and so
    // does one that was already queued when the user pressed Retry.
    if (result.outcome === "retried" || result.outcome === "already_queued") {
      const sessionId = getSessionId(result.job);
      void config.ensureBooWorker(sessionId).catch((error) => {
        console.error(
          `[${config.backendLabel}-delivery] failed to ensure boo worker for ${sessionId}:`,
          error,
        );
      });
    }
    return result;
  }

  /** True while this session has delivery work owed — see `OWED_JOB_STATUSES`. */
  function hasOwedDeliveryWork(sessionId: string): boolean {
    const row = drizzleDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(config.jobsTable)
      .where(
        and(eq(sessionIdColumn, sessionId), inArray(config.jobsTable.status, OWED_JOB_STATUSES)),
      )
      .get();
    return (row?.count ?? 0) > 0;
  }

  /**
   * True while a prompt was handed to the CLI and the worker has not yet
   * observed that turn end. Queue-empty (succeeded/failed/expired) is not idle.
   */
  function hasOpenCliTurn(sessionId: string): boolean {
    const row = drizzleDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(config.jobsTable)
      .where(
        and(
          eq(sessionIdColumn, sessionId),
          isNotNull(config.jobsTable.promptDispatchedAt),
          isNull(config.jobsTable.cliTurnEndedAt),
        ),
      )
      .get();
    return (row?.count ?? 0) > 0;
  }

  function resumePendingDeliveryWorkers(): void {
    const rows = drizzleDb
      .select({ sessionId: sessionIdColumn })
      .from(config.jobsTable)
      .where(inArray(config.jobsTable.status, OWED_JOB_STATUSES))
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
      promptDispatchedAt: job.promptDispatchedAt,
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

  /**
   * The compare-and-set predicate every worker-driven transition is built from:
   * the job, the attempt, and the attempt's holder.
   *
   * `lockedAt` is deliberately absent. Lease renewal bumps it, so it identifies a
   * moment rather than an owner; matching on it lets a renewal that commits while
   * a worker is finishing make a successful delivery fail to record its reply.
   */
  function leaseHeld(
    job: Pick<ExternalCliDeliveryJob, "id" | "attemptCount" | "lockedBy">,
  ): SQL | undefined {
    if (job.lockedBy == null) return sql`1 = 0`;
    return and(
      eq(config.jobsTable.id, job.id),
      eq(config.jobsTable.status, "running"),
      eq(config.jobsTable.attemptCount, job.attemptCount),
      eq(config.jobsTable.lockedBy, job.lockedBy),
    );
  }

  /**
   * Return expired leases to the queue, except for jobs already handed to the
   * provider: re-queueing those would prompt the agent a second time, so they go
   * terminal-unconfirmed instead.
   */
  /**
   * Close open-turn markers that nobody will ever close: jobs dispatched
   * before a server upgrade (pre-`cli_turn_ended_at` rows have no end stamp),
   * or a worker crash on a terminal job. Without this, one stale row keeps
   * `hasOpenCliTurn` true forever and the session can never report idle.
   * Active turns are safe: lease renewals keep bumping `updated_at`, so only
   * rows quiet for the whole stale bound get closed. Failure mode LATE.
   */
  function closeStaleOpenTurns(now: number): void {
    const staleBefore = now - cliTurnStaleMs();
    drizzleDb
      .update(config.jobsTable)
      .set({
        cliTurnEndedAt: sql`COALESCE(${config.jobsTable.cliTurnEndedAt}, ${now})`,
        updatedAt: nowSql(),
      })
      .where(
        and(
          isNotNull(config.jobsTable.promptDispatchedAt),
          isNull(config.jobsTable.cliTurnEndedAt),
          // updatedAt is TEXT CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC);
          // match that exact shape so the comparison stays lexicographic-safe.
          lte(
            config.jobsTable.updatedAt,
            new Date(staleBefore).toISOString().slice(0, 19).replace("T", " "),
          ),
        ),
      )
      .run();
  }

  function reclaimExpiredLeases(staleBefore: number): void {
    closeStaleOpenTurns(Date.now());
    const expired = drizzleDb
      .select({
        id: config.jobsTable.id,
        messageId: config.jobsTable.messageId,
        promptDispatchedAt: config.jobsTable.promptDispatchedAt,
      })
      .from(config.jobsTable)
      .where(
        and(eq(config.jobsTable.status, "running"), lte(config.jobsTable.lockedAt, staleBefore)),
      )
      .all();
    if (expired.length === 0) return;

    const undispatched = expired.flatMap((row) => (row.promptDispatchedAt == null ? [row.id] : []));
    if (undispatched.length > 0) {
      drizzleDb
        .update(config.jobsTable)
        .set({ status: "retrying", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
        .where(
          and(
            eq(config.jobsTable.status, "running"),
            inArray(config.jobsTable.id, undispatched),
            isNull(config.jobsTable.promptDispatchedAt),
          ),
        )
        .run();
    }

    for (const row of expired) {
      if (row.promptDispatchedAt == null) continue;
      const abandoned = drizzleDb
        .update(config.jobsTable)
        .set({
          status: "failed",
          lockedAt: null,
          lockedBy: null,
          lastError: config.unconfirmedMessage,
          // Backstop: the worker never reported process-end. LATE, never forever-pending.
          cliTurnEndedAt: sql`COALESCE(${config.jobsTable.cliTurnEndedAt}, ${Date.now()})`,
          updatedAt: nowSql(),
        })
        .where(and(eq(config.jobsTable.id, row.id), eq(config.jobsTable.status, "running")))
        .run();
      if (abandoned.changes === 0) continue;
      const message = getMessage(row.messageId);
      if (message) afterDeliveryFailure(message, config.unconfirmedMessage);
    }
  }

  const DeliveryQueueLive = Layer.succeed(DeliveryQueue, {
    claimNext: (workerId, sessionId) =>
      tryQueue(() => {
        const now = Date.now();
        // JOB_LEASE_MS is not a turn-end signal — a ~100s CLI turn outlives this.
        // Reclaim of a dispatched job still closes the open-turn marker so idle
        // detection cannot stay pending forever after a crashed worker.
        reclaimExpiredLeases(now - JOB_LEASE_MS);

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
            // Forced jobs first (so a user force-send jumps ahead of a
            // busy-deferred job monopolizing the queue), then oldest first.
            .orderBy(desc(config.forceColumn), asc(config.jobsTable.id))
            .all();
          const row = rows.find((candidateRow) => {
            const candidateJob = config.validateJob(
              candidateRow,
              `claim${config.backendLabel}DeliveryJob`,
            );
            // Wait-for-idle hold: while another delivery's CLI turn is still
            // open, the agent is busy, so a normal send keeps waiting. A forced
            // job skips this hold — that skip is what Force send means.
            if (candidateJob.force !== 1) {
              const openTurn = tx
                .select({ count: sql<number>`COUNT(*)` })
                .from(config.jobsTable)
                .where(
                  and(
                    eq(sessionIdColumn, getSessionId(candidateJob)),
                    isNotNull(config.jobsTable.promptDispatchedAt),
                    isNull(config.jobsTable.cliTurnEndedAt),
                    sql`${config.jobsTable.id} <> ${candidateJob.id}`,
                  ),
                )
                .get();
              if ((openTurn?.count ?? 0) > 0) return false;
            }
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
            // Forced deliveries hand over even mid-turn; everything else also
            // waits out any claimed-but-not-yet-dispatched attempt.
            return candidateJob.force === 1 || (running?.count ?? 0) === 0;
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
    markDispatched: (job) =>
      tryQueue(() => {
        // better-sqlite3 writes synchronously, so this statement has committed by
        // the time the internal request that carries it answers the worker. The
        // worker only spawns the provider after that answer. Clearing
        // cliTurnEndedAt starts this attempt's turn; queue-empty is not idle
        // until the worker observes the CLI process settle.
        const result = drizzleDb
          .update(config.jobsTable)
          .set({
            promptDispatchedAt: sql`COALESCE(${config.jobsTable.promptDispatchedAt}, ${Date.now()})`,
            cliTurnEndedAt: null,
            updatedAt: nowSql(),
          })
          .where(leaseHeld(job))
          .run();
        if (result.changes > 0) startIdleWatchForDispatchedJob(job);
        return result.changes > 0;
      }),
    markCliTurnEnded: (job) =>
      tryQueue(() => {
        // No lease CAS: the worker observed the process settle even if renewal
        // already lost the row. COALESCE keeps the first observation.
        const result = drizzleDb
          .update(config.jobsTable)
          .set({
            cliTurnEndedAt: sql`COALESCE(${config.jobsTable.cliTurnEndedAt}, ${Date.now()})`,
            updatedAt: nowSql(),
          })
          .where(eq(config.jobsTable.id, job.id))
          .run();
        return result.changes > 0;
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
          .where(leaseHeld(job))
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
            cliTurnEndedAt: sql`COALESCE(${config.jobsTable.cliTurnEndedAt}, ${Date.now()})`,
            updatedAt: nowSql(),
          })
          .where(leaseHeld(job))
          .run();
        return result.changes > 0;
      }),
    fail: (job, error, options) =>
      tryQueue(() => {
        const turnEnd =
          options?.markTurnEnded === false
            ? {}
            : { cliTurnEndedAt: sql`COALESCE(${config.jobsTable.cliTurnEndedAt}, ${Date.now()})` };
        const result = drizzleDb
          .update(config.jobsTable)
          .set({
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            lastError: error,
            ...turnEnd,
            updatedAt: nowSql(),
          })
          .where(leaseHeld(job))
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
            cliTurnEndedAt: sql`COALESCE(${config.jobsTable.cliTurnEndedAt}, ${Date.now()})`,
            updatedAt: nowSql(),
          })
          .where(leaseHeld(job))
          .run();
        return result.changes > 0;
      }),
    renew: (job) =>
      tryQueue(() => {
        const result = drizzleDb
          .update(config.jobsTable)
          .set({ lockedAt: Date.now(), updatedAt: nowSql() })
          .where(leaseHeld(job))
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

  /**
   * Direct typed prompts (and unwatched forwards) must watch from dispatch, not
   * only from a successful complete CAS. A finished CLI turn with a lost lease
   * still records turn-end; without this watch there is no idle notice.
   */
  function startIdleWatchForDispatchedJob(job: ExternalCliDeliveryJob): void {
    const message = getMessage(job.messageId);
    if (!message) return;
    if (
      job.kind === "forward_target_message" &&
      isLiveCompletionWatchStatus(message.completionWatchStatus)
    ) {
      return;
    }
    if (job.kind !== "direct_user_message" && job.kind !== "forward_target_message") return;
    startIdleNotificationWatch({
      sessionId: job.externalSessionId,
      triggerMessageId: message.id,
      seenWorking: true,
    });
  }

  function afterDelivery(
    job: TJob,
    message: DbMessage,
    options?: { readonly watchIdle?: boolean },
  ): void {
    if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
      updateForwardTarget(message.forwardSourceMessageId, message.id, "sent");
      updateForwardStatus(message.id, "sent");
    }
    updateOpencodeDelivery(message.id, "sent", null, null);
    broadcastQueue(message.sessionId);
    const externalSessionId = getSessionId(job);
    if (message.sessionId !== externalSessionId) broadcastQueue(externalSessionId);

    if (options?.watchIdle === false) return;
    if (
      job.kind === "forward_target_message" &&
      isLiveCompletionWatchStatus(message.completionWatchStatus)
    ) {
      startForwardCompletionNotificationWatch({
        sourceMessageId:
          message.completionSourceMessageId ?? message.forwardSourceMessageId ?? message.id,
        sourceSessionId:
          message.completionSourceSessionId ?? message.forwardSourceSessionId ?? message.sessionId,
        targetMessageId: message.id,
        targetSessionId: externalSessionId,
        seenWorking: true,
      });
    } else {
      startIdleWatchForDispatchedJob(toWorkflowJob(job));
    }
  }

  function afterDeliveryFailure(message: DbMessage, error = config.failureMessage): void {
    const job = loadLatestJobForMessage(message.id);
    // Dispatched + later agent reply means the prompt landed; confirm instead of
    // leaving a false-failed delivery that skips completion watches.
    // Running jobs must not confirm here either — expired leases sweep to
    // failed/retrying first (PRs 32 and 34).
    if (
      job?.promptDispatchedAt != null &&
      job.status !== "running" &&
      sessionHasLaterAgentReply(message, job.promptDispatchedAt)
    ) {
      markJobConfirmedWithoutReprompt(job);
      afterDelivery(job, message);
      return;
    }
    updateOpencodeDelivery(message.id, "failed", error, null);
    if (message.forwardRole) updateForwardStatus(message.id, "failed");
    if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
      updateForwardTarget(message.forwardSourceMessageId, message.id, "failed");
    }
    broadcastQueue(message.sessionId);
    if (
      isLiveCompletionWatchStatus(message.completionWatchStatus) &&
      (job == null || job.promptDispatchedAt == null)
    ) {
      void import("../session-idle-fail.ts").then((mod) => {
        mod.failSessionIdleForWatchedMessage(message.id);
      });
    }
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
          if (isLiveCompletionWatchStatus(message.completionWatchStatus)) {
            markCompletionWorkSeen(message.id);
          }
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

  async function completeDeliveryJobFromWorker(
    job: TJob,
    reply: string | null,
    options?: { readonly markTurnEnded?: boolean },
  ): Promise<boolean> {
    if (options?.markTurnEnded !== false) await markDeliveryJobCliTurnEndedFromWorker(job);
    const message = getMessage(job.messageId);
    const completed = await queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.complete(toWorkflowJob(job), "sent");
      }),
    );
    if (!completed || !message) {
      if (!completed) await checkIdleNotification(job.messageId);
      return completed;
    }
    if (reply != null) insertExternalAgentReply(getSessionId(job), reply);
    afterDelivery(job, message, { watchIdle: options?.markTurnEnded !== false });
    if (options?.markTurnEnded !== false) await checkIdleNotification(job.messageId);
    return true;
  }

  async function retryDeliveryJobFromWorker(job: TJob, error: string): Promise<boolean> {
    await markDeliveryJobCliTurnEndedFromWorker(job);
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

  async function endDeliveryJobFromWorker(
    job: TJob,
    error: string,
    options?: { readonly markTurnEnded?: boolean },
  ): Promise<boolean> {
    const message = getMessage(job.messageId);
    const failed = await queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.fail(toWorkflowJob(job), error, options);
      }),
    );
    if (failed && message) afterDeliveryFailure(message, error);
    if (message) broadcastQueue(message.sessionId);
    return failed;
  }

  function failDeliveryJobFromWorker(
    job: TJob,
    error: string,
    options?: { readonly markTurnEnded?: boolean },
  ): Promise<boolean> {
    return endDeliveryJobFromWorker(job, error, options);
  }

  /**
   * Deliberately identical to `failDeliveryJobFromWorker` now that
   * `cli_unconfirmed` has collapsed into `failed`: the two differ only in the
   * error text the caller supplies. Both survive because workers post to
   * separate internal endpoints (`/fail` and `/unconfirmed`), so merging them
   * would be a wire change and a worker version bump.
   */
  function markDeliveryJobUnconfirmedFromWorker(
    job: TJob,
    error: string,
    options?: { readonly markTurnEnded?: boolean },
  ): Promise<boolean> {
    return endDeliveryJobFromWorker(job, error, options);
  }

  function markDeliveryJobDispatchedFromWorker(job: TJob): Promise<boolean> {
    return queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.markDispatched(toWorkflowJob(job));
      }),
    );
  }

  function markDeliveryJobCliTurnEndedFromWorker(job: TJob): Promise<boolean> {
    return queueProgram(
      Effect.gen(function* () {
        const queue = yield* DeliveryQueue;
        return yield* queue.markCliTurnEnded(toWorkflowJob(job));
      }),
    );
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
        // Non-echo mode means this Effect path never starts a provider; the REST
        // worker is what actually spawns. Treat that as ProviderNotStartedError
        // so a dispatched job remains retryable rather than unconfirmed.
        return Effect.fail(
          new ProviderNotStartedError({
            message: `Only echo ${config.backendLabel} worker mode is implemented.`,
          }),
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
    retryDeliveryJob,
    hasOwedDeliveryWork,
    hasOpenCliTurn,
    resumePendingDeliveryWorkers,
    claimDeliveryJobForWorker,
    completeDeliveryJobFromWorker,
    retryDeliveryJobFromWorker,
    failDeliveryJobFromWorker,
    markDeliveryJobDispatchedFromWorker,
    markDeliveryJobCliTurnEndedFromWorker,
    markDeliveryJobUnconfirmedFromWorker,
    cancelDeliveryJobFromWorker,
    renewDeliveryJobFromWorker,
    confirmDispatchedDeliveryFromObservedWork,
    confirmDeliveriesForSessionFromObservedWork,
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
