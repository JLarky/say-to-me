import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { Effect, Fiber, Layer, Scope } from "effect";
import { randomUUID } from "node:crypto";
import { broadcastQueue } from "../broadcast.ts";
import { drizzleDb } from "../db/index.ts";
import { opencodeDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  DbOpenCodeDeliveryJob,
  validateDb,
  type DbOpenCodeDeliveryJob as DbOpenCodeDeliveryJobRow,
} from "../db/schemas.ts";
import {
  getMessage,
  markCompletionWorkSeen,
  updateForwardStatus,
  updateForwardTarget,
  updateOpencodeDelivery,
} from "../messages.ts";
import {
  startForwardCompletionNotificationWatch,
  startIdleNotificationWatch,
} from "../notifications.ts";
import { getOpenCodeStatus } from "./client.ts";
import { startCompletionWatch } from "./completion-watch.ts";
import { deliverReplyToOpencode } from "./delivery.ts";
import {
  DEFAULT_WORKER_POLL_MS,
  DeliveryEffects,
  DeliveryEffectsError,
  MessageStore,
  MessageStoreError,
  OpenCodeDeliveryQueue,
  OpenCodeDeliveryQueueError,
  OpenCodeDeliveryRuntime,
  OpenCodeDeliveryStatus,
  OpenCodePromptClient,
  WorkerIdentity,
  openCodeDeliveryWorkerLoop,
  runOpenCodeDeliveryOnce,
  type DeliveryEffectsService,
  type DeliveryOutcome,
  type EnqueueOpenCodeDeliveryInput,
  type MessageStoreService,
  type OpenCodeDeliveryEnv,
  type OpenCodeDeliveryQueueService,
  type OpenCodeDeliveryRuntimeService,
  type OpenCodeDeliveryStatusService,
  type OpenCodePromptClientService,
  type WorkerIdentityService,
} from "@say-to-me/opencode-delivery/workflow";

function tryMessageStore<A>(try_: () => A): Effect.Effect<A, MessageStoreError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new MessageStoreError({ cause }),
  });
}

function tryDeliveryEffects<A>(try_: () => A): Effect.Effect<A, DeliveryEffectsError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new DeliveryEffectsError({ cause }),
  });
}

function tryDeliveryQueue<A>(try_: () => A): Effect.Effect<A, OpenCodeDeliveryQueueError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new OpenCodeDeliveryQueueError({ cause }),
  });
}

// Re-export the workflow surface so existing importers of this module are unaffected.
export * from "@say-to-me/opencode-delivery/workflow";

export const WORKER_POLL_MS = Number(
  process.env.SAY_TO_ME_OPENCODE_DELIVERY_POLL_MS || DEFAULT_WORKER_POLL_MS,
);

const JOB_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const jobSelectColumns = {
  id: opencodeDeliveryJobs.id,
  messageId: opencodeDeliveryJobs.messageId,
  messageSessionId: opencodeDeliveryJobs.messageSessionId,
  opencodeSessionId: opencodeDeliveryJobs.opencodeSessionId,
  kind: opencodeDeliveryJobs.kind,
  status: opencodeDeliveryJobs.status,
  useCli: opencodeDeliveryJobs.useCli,
  force: opencodeDeliveryJobs.force,
  attemptCount: opencodeDeliveryJobs.attemptCount,
  maxAttempts: opencodeDeliveryJobs.maxAttempts,
  nextAttemptAt: opencodeDeliveryJobs.nextAttemptAt,
  lockedAt: opencodeDeliveryJobs.lockedAt,
  lockedBy: opencodeDeliveryJobs.lockedBy,
  lastError: opencodeDeliveryJobs.lastError,
  opencodeMessageId: opencodeDeliveryJobs.opencodeMessageId,
  promptDispatchedAt: opencodeDeliveryJobs.promptDispatchedAt,
  cliTurnEndedAt: opencodeDeliveryJobs.cliTurnEndedAt,
  createdAt: opencodeDeliveryJobs.createdAt,
  updatedAt: opencodeDeliveryJobs.updatedAt,
};

function validateJob(row: unknown, context: string): DbOpenCodeDeliveryJobRow {
  return validateDb(DbOpenCodeDeliveryJob, row, context);
}

function nowSql() {
  return sql`CURRENT_TIMESTAMP`;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
}

function loadJob(id: number): DbOpenCodeDeliveryJobRow | null {
  const row = drizzleDb
    .select(jobSelectColumns)
    .from(opencodeDeliveryJobs)
    .where(eq(opencodeDeliveryJobs.id, id))
    .limit(1)
    .get();
  return row ? validateJob(row, "opencodeDeliveryJob") : null;
}

function leasedJobWhere(job: DbOpenCodeDeliveryJobRow) {
  if (job.lockedAt == null || job.lockedBy == null) return sql`1 = 0`;
  return and(
    eq(opencodeDeliveryJobs.id, job.id),
    eq(opencodeDeliveryJobs.status, "running"),
    eq(opencodeDeliveryJobs.attemptCount, job.attemptCount),
    eq(opencodeDeliveryJobs.lockedAt, job.lockedAt),
    eq(opencodeDeliveryJobs.lockedBy, job.lockedBy),
  );
}

export function enqueueOpenCodeDeliveryJob(
  input: EnqueueOpenCodeDeliveryInput,
): DbOpenCodeDeliveryJobRow {
  const result = drizzleDb.transaction((tx) => {
    const insertResult = tx
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: input.messageId,
        messageSessionId: input.messageSessionId,
        opencodeSessionId: input.opencodeSessionId,
        kind: input.kind,
        status: "pending",
        useCli: input.useCli ? 1 : 0,
        force: input.force ? 1 : 0,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        nextAttemptAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    const created = insertResult.changes === 1;

    const row = tx
      .select(jobSelectColumns)
      .from(opencodeDeliveryJobs)
      .where(
        and(
          eq(opencodeDeliveryJobs.messageId, input.messageId),
          eq(opencodeDeliveryJobs.kind, input.kind),
        ),
      )
      .limit(1)
      .get();
    if (!row) throw new Error("Failed to enqueue OpenCode delivery job.");

    if (created) {
      updateOpencodeDelivery(input.messageId, "queued", null, null);
      return validateJob(row, "enqueueOpenCodeDeliveryJob");
    }

    const job = validateJob(row, "enqueueOpenCodeDeliveryJob");
    if (job.status === "succeeded" || job.status === "cancelled") {
      return job;
    }
    if (job.status === "failed") {
      const cas = tx
        .update(opencodeDeliveryJobs)
        .set({
          status: "pending",
          nextAttemptAt: Date.now(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          promptDispatchedAt: null,
          cliTurnEndedAt: null,
          updatedAt: nowSql(),
        })
        .where(
          and(
            eq(opencodeDeliveryJobs.id, job.id),
            eq(opencodeDeliveryJobs.status, "failed"),
            sql`${opencodeDeliveryJobs.promptDispatchedAt} IS NULL`,
          ),
        )
        .run();
      if (cas.changes === 1) {
        updateOpencodeDelivery(input.messageId, "queued", null, null);
      }
      const refreshed = tx
        .select(jobSelectColumns)
        .from(opencodeDeliveryJobs)
        .where(eq(opencodeDeliveryJobs.id, job.id))
        .limit(1)
        .get();
      if (!refreshed) throw new Error("Failed to load OpenCode delivery job after enqueue.");
      return validateJob(refreshed, "enqueueOpenCodeDeliveryJob");
    }
    return job;
  });
  kickOpenCodeDeliveryWorker();
  return result;
}

export function retryOpenCodeDeliveryJob(
  messageId: number,
  { force = false }: { force?: boolean } = {},
): DbOpenCodeDeliveryJobRow | null {
  const row = drizzleDb
    .select(jobSelectColumns)
    .from(opencodeDeliveryJobs)
    .where(eq(opencodeDeliveryJobs.messageId, messageId))
    .orderBy(asc(opencodeDeliveryJobs.id))
    .limit(1)
    .get();
  if (!row) return null;
  const job = validateJob(row, "retryOpenCodeDeliveryJob");
  updateOpencodeDelivery(messageId, "queued", null, null);
  drizzleDb
    .update(opencodeDeliveryJobs)
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
    .where(eq(opencodeDeliveryJobs.id, job.id))
    .run();
  return loadJob(job.id);
}

export function countPendingOpenCodeDeliveryJobs(): number {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(opencodeDeliveryJobs)
    .where(inArray(opencodeDeliveryJobs.status, ["pending", "retrying", "running"]))
    .get();
  return row?.count ?? 0;
}

export const OpenCodeDeliveryQueueLive = Layer.succeed(OpenCodeDeliveryQueue, {
  enqueue: (input) => tryDeliveryQueue(() => enqueueOpenCodeDeliveryJob(input)),
  claimNext: (workerId) =>
    tryDeliveryQueue(() => {
      const now = Date.now();
      const staleBefore = now - JOB_LEASE_MS;
      const expired = drizzleDb
        .select({
          id: opencodeDeliveryJobs.id,
          promptDispatchedAt: opencodeDeliveryJobs.promptDispatchedAt,
        })
        .from(opencodeDeliveryJobs)
        .where(
          and(
            eq(opencodeDeliveryJobs.status, "running"),
            lte(opencodeDeliveryJobs.lockedAt, staleBefore),
          ),
        )
        .all();
      const undispatched = expired
        .filter((row) => row.promptDispatchedAt == null)
        .map((row) => row.id);
      if (undispatched.length > 0) {
        drizzleDb
          .update(opencodeDeliveryJobs)
          .set({ status: "retrying", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
          .where(
            and(
              inArray(opencodeDeliveryJobs.id, undispatched),
              eq(opencodeDeliveryJobs.status, "running"),
            ),
          )
          .run();
      }
      const dispatched = expired
        .filter((row) => row.promptDispatchedAt != null)
        .map((row) => row.id);
      if (dispatched.length > 0) {
        drizzleDb
          .update(opencodeDeliveryJobs)
          .set({
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            lastError: "OpenCode delivery lease expired after prompt dispatch.",
            cliTurnEndedAt: sql`COALESCE(${opencodeDeliveryJobs.cliTurnEndedAt}, ${now})`,
            updatedAt: nowSql(),
          })
          .where(
            and(
              inArray(opencodeDeliveryJobs.id, dispatched),
              eq(opencodeDeliveryJobs.status, "running"),
            ),
          )
          .run();
        for (const id of dispatched) {
          const row = drizzleDb
            .select({ messageId: opencodeDeliveryJobs.messageId })
            .from(opencodeDeliveryJobs)
            .where(eq(opencodeDeliveryJobs.id, id))
            .get();
          if (row)
            updateOpencodeDelivery(
              row.messageId,
              "failed",
              "OpenCode delivery lease expired after prompt dispatch.",
              null,
            );
        }
      }
      const candidate = drizzleDb.transaction((tx) => {
        const rows = tx
          .select(jobSelectColumns)
          .from(opencodeDeliveryJobs)
          .where(
            and(
              inArray(opencodeDeliveryJobs.status, ["pending", "retrying"]),
              lte(opencodeDeliveryJobs.nextAttemptAt, now),
            ),
          )
          .orderBy(desc(opencodeDeliveryJobs.force), asc(opencodeDeliveryJobs.id))
          .all();
        const row = rows.find((candidateRow) => {
          const running = tx
            .select({ count: sql<number>`COUNT(*)` })
            .from(opencodeDeliveryJobs)
            .where(
              and(
                eq(opencodeDeliveryJobs.opencodeSessionId, candidateRow.opencodeSessionId),
                eq(opencodeDeliveryJobs.status, "running"),
              ),
            )
            .get();
          return (running?.count ?? 0) === 0;
        });
        if (!row) return null;
        const job = validateJob(row, "claimOpenCodeDeliveryJob");
        const claimed = tx
          .update(opencodeDeliveryJobs)
          .set({
            status: "running",
            attemptCount: job.attemptCount + 1,
            lockedAt: now,
            lockedBy: workerId,
            updatedAt: nowSql(),
          })
          .where(
            and(
              eq(opencodeDeliveryJobs.id, job.id),
              inArray(opencodeDeliveryJobs.status, ["pending", "retrying"]),
            ),
          )
          .run();
        if (claimed.changes === 0) return null;
        return loadJob(job.id);
      });
      return candidate;
    }),
  complete: (job, outcome, opencodeMessageId = null) =>
    tryDeliveryQueue(() => {
      const result = drizzleDb
        .update(opencodeDeliveryJobs)
        .set({
          status: outcome === "cancelled" ? "cancelled" : "succeeded",
          lockedAt: null,
          lockedBy: null,
          opencodeMessageId,
          updatedAt: nowSql(),
        })
        .where(leasedJobWhere(job))
        .run();
      return result.changes > 0;
    }),
  retry: (job, error) =>
    tryDeliveryQueue(() => {
      const nextAttemptAt = Date.now() + retryDelayMs(job.attemptCount);
      const result = drizzleDb
        .update(opencodeDeliveryJobs)
        .set({
          status: "retrying",
          nextAttemptAt,
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          updatedAt: nowSql(),
        })
        .where(leasedJobWhere(job))
        .run();
      return result.changes > 0;
    }),
  fail: (job, error) =>
    tryDeliveryQueue(() => {
      const result = drizzleDb
        .update(opencodeDeliveryJobs)
        .set({
          status: "failed",
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          updatedAt: nowSql(),
        })
        .where(leasedJobWhere(job))
        .run();
      return result.changes > 0;
    }),
  cancel: (job, reason) =>
    tryDeliveryQueue(() => {
      const result = drizzleDb
        .update(opencodeDeliveryJobs)
        .set({
          status: "cancelled",
          lockedAt: null,
          lockedBy: null,
          lastError: reason,
          updatedAt: nowSql(),
        })
        .where(leasedJobWhere(job))
        .run();
      return result.changes > 0;
    }),
  returnToPending: (job) =>
    tryDeliveryQueue(() => {
      const result = drizzleDb
        .update(opencodeDeliveryJobs)
        .set({
          status: "pending",
          attemptCount: job.attemptCount,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: Date.now() + WORKER_POLL_MS,
          updatedAt: nowSql(),
        })
        .where(leasedJobWhere(job))
        .run();
      return result.changes > 0;
    }),
  markDispatched: (job) =>
    tryDeliveryQueue(() => {
      const result = drizzleDb
        .update(opencodeDeliveryJobs)
        .set({
          promptDispatchedAt: sql`COALESCE(${opencodeDeliveryJobs.promptDispatchedAt}, ${Date.now()})`,
          cliTurnEndedAt: null,
          updatedAt: nowSql(),
        })
        .where(leasedJobWhere(job))
        .run();
      return result.changes > 0;
    }),
  markCliTurnEnded: (job) =>
    tryDeliveryQueue(() => {
      const result = drizzleDb
        .update(opencodeDeliveryJobs)
        .set({
          cliTurnEndedAt: sql`COALESCE(${opencodeDeliveryJobs.cliTurnEndedAt}, ${Date.now()})`,
          updatedAt: nowSql(),
        })
        .where(eq(opencodeDeliveryJobs.id, job.id))
        .run();
      return result.changes > 0;
    }),
} satisfies OpenCodeDeliveryQueueService);

export const DeliveryEffectsLive = Layer.succeed(DeliveryEffects, {
  broadcastQueue: (sessionId) => tryDeliveryEffects(() => broadcastQueue(sessionId ?? undefined)),
  startCompletionWatch: (messageId) => tryDeliveryEffects(() => startCompletionWatch(messageId)),
  startForwardCompletionNotificationWatch: (input) =>
    tryDeliveryEffects(() => startForwardCompletionNotificationWatch(input)),
  startIdleNotificationWatch: (input) =>
    tryDeliveryEffects(() => startIdleNotificationWatch(input)),
} satisfies DeliveryEffectsService);

export const MessageStoreLive = Layer.succeed(MessageStore, {
  getMessage: (id) => tryMessageStore(() => getMessage(id)),
  updateOpencodeDelivery: (id, status, error, opencodeMessageId) =>
    tryMessageStore(() => updateOpencodeDelivery(id, status ?? "queued", error, opencodeMessageId)),
  markCompletionWorkSeen: (id) => tryMessageStore(() => markCompletionWorkSeen(id)),
  updateForwardStatus: (id, status) => tryMessageStore(() => updateForwardStatus(id, status)),
  updateForwardTarget: (sourceMessageId, targetMessageId, status) =>
    tryMessageStore(() => updateForwardTarget(sourceMessageId, targetMessageId, status)),
} satisfies MessageStoreService);

export const WorkerIdentityLive = Layer.succeed(WorkerIdentity, {
  id: `opencode-delivery-${process.pid}-${randomUUID()}`,
} satisfies WorkerIdentityService);

export const OpenCodePromptClientLive = Layer.succeed(OpenCodePromptClient, {
  sendPrompt: (job, message) =>
    Effect.tryPromise({
      try: async () => {
        const full = getMessage(message.id);
        if (!full) return "cancelled";
        await deliverReplyToOpencode(job.opencodeSessionId, full, { useCli: job.useCli === 1 });
        const delivered = getMessage(message.id);
        if (!delivered) return "cancelled";
        if (delivered.opencodeDeliveryStatus === "sent") return "sent";
        if (
          delivered.opencodeDeliveryStatus === "pending" ||
          delivered.opencodeDeliveryStatus === "cli_timed_out"
        ) {
          return "pending";
        }
        return "failed";
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.catchAll(() => Effect.succeed("failed" as DeliveryOutcome))),
} satisfies OpenCodePromptClientService);

export const OpenCodeDeliveryStatusLive = Layer.succeed(OpenCodeDeliveryStatus, {
  getStatus: (sessionId, opts) =>
    Effect.tryPromise(() => getOpenCodeStatus(sessionId, opts)).pipe(
      Effect.orElseSucceed(() => null),
    ),
} satisfies OpenCodeDeliveryStatusService);

const DurableDeliveryLive = Layer.mergeAll(
  OpenCodeDeliveryQueueLive,
  OpenCodeDeliveryStatusLive,
  OpenCodePromptClientLive,
  WorkerIdentityLive,
  MessageStoreLive,
  DeliveryEffectsLive,
);

type DeliveryFiber = ReturnType<typeof Effect.runFork>;

export function makeOpenCodeDeliveryRuntime({
  deliveryLayer = DurableDeliveryLive,
  workerLoop = openCodeDeliveryWorkerLoop(WORKER_POLL_MS),
  kickProgram = runOpenCodeDeliveryOnce().pipe(Effect.asVoid),
}: {
  deliveryLayer?: Layer.Layer<OpenCodeDeliveryEnv>;
  workerLoop?: Effect.Effect<void, never, OpenCodeDeliveryEnv>;
  kickProgram?: Effect.Effect<void, never, OpenCodeDeliveryEnv>;
} = {}): OpenCodeDeliveryRuntimeService {
  let worker: DeliveryFiber | null = null;
  const kickFibers = new Set<DeliveryFiber>();

  const interruptAll = (fibers: DeliveryFiber[]) =>
    fibers.length ? Effect.all(fibers.map((fiber) => Fiber.interrupt(fiber))) : Effect.void;

  return {
    start: Effect.sync(() => {
      if (worker) return;
      worker = Effect.runFork(workerLoop.pipe(Effect.provide(deliveryLayer)));
    }),
    kick: Effect.sync(() => {
      let fiber: DeliveryFiber | null = null;
      fiber = Effect.runFork(
        kickProgram
          .pipe(Effect.ensuring(Effect.sync(() => fiber && kickFibers.delete(fiber))))
          .pipe(Effect.provide(deliveryLayer)),
      );
      kickFibers.add(fiber);
    }),
    stop: Effect.gen(function* () {
      const workerFiber = worker;
      worker = null;
      const fibers = workerFiber ? [workerFiber, ...kickFibers] : [...kickFibers];
      kickFibers.clear();
      yield* interruptAll(fibers);
    }),
  } satisfies OpenCodeDeliveryRuntimeService;
}

export function scopedOpenCodeDeliveryRuntime(
  runtime = makeOpenCodeDeliveryRuntime(),
): Effect.Effect<OpenCodeDeliveryRuntimeService, never, Scope.Scope> {
  return Effect.acquireRelease(
    runtime.start.pipe(Effect.as(runtime)),
    (acquiredRuntime) => acquiredRuntime.stop,
  );
}

export const OpenCodeDeliveryRuntimeLive = Layer.succeed(
  OpenCodeDeliveryRuntime,
  makeOpenCodeDeliveryRuntime(),
);

const defaultDeliveryRuntime = makeOpenCodeDeliveryRuntime();

export function startOpenCodeDeliveryWorker(): void {
  Effect.runSync(defaultDeliveryRuntime.start);
}

export function kickOpenCodeDeliveryWorker(): void {
  Effect.runSync(defaultDeliveryRuntime.kick);
}

export async function stopOpenCodeDeliveryWorker(): Promise<void> {
  await Effect.runPromise(defaultDeliveryRuntime.stop);
}
