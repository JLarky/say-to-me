import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { broadcastQueue } from "../broadcast.ts";
import { drizzleDb } from "../db/index.ts";
import { messages, t3DeliveryJobs } from "../db/drizzle-schema.ts";
import { DbT3DeliveryJob } from "../db/schemas.ts";
import { getMessage, updateForwardStatus, updateForwardTarget } from "../messages.ts";
import { detectSessionBackend } from "../session-id.ts";
import { dispatchT3Message } from "./client.ts";

const POLL_MS = Number(process.env.SAY_TO_ME_T3_DELIVERY_POLL_MS || 250);
const LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export type T3DeliveryJobInput = {
  messageId: number;
  messageSessionId: string;
  t3SessionId: string;
  kind: "direct_user_message" | "forward_target_message";
  maxAttempts?: number;
};

function nowSql() {
  return sql`CURRENT_TIMESTAMP`;
}

function retryDelayMs(attemptCount: number) {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
}

const jobColumns = {
  id: t3DeliveryJobs.id,
  messageId: t3DeliveryJobs.messageId,
  messageSessionId: t3DeliveryJobs.messageSessionId,
  t3SessionId: t3DeliveryJobs.t3SessionId,
  kind: t3DeliveryJobs.kind,
  status: t3DeliveryJobs.status,
  attemptCount: t3DeliveryJobs.attemptCount,
  maxAttempts: t3DeliveryJobs.maxAttempts,
  nextAttemptAt: t3DeliveryJobs.nextAttemptAt,
  lockedAt: t3DeliveryJobs.lockedAt,
  lockedBy: t3DeliveryJobs.lockedBy,
  lastError: t3DeliveryJobs.lastError,
  sequence: t3DeliveryJobs.sequence,
  createdAt: t3DeliveryJobs.createdAt,
  updatedAt: t3DeliveryJobs.updatedAt,
};

export function enqueueT3DeliveryJob(input: T3DeliveryJobInput): void {
  drizzleDb.transaction((tx) => {
    const inserted = tx
      .insert(t3DeliveryJobs)
      .values({
        ...input,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        status: "pending",
        nextAttemptAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();

    if (inserted.changes === 0) {
      const existing = tx
        .select({ id: t3DeliveryJobs.id, status: t3DeliveryJobs.status })
        .from(t3DeliveryJobs)
        .where(
          and(eq(t3DeliveryJobs.messageId, input.messageId), eq(t3DeliveryJobs.kind, input.kind)),
        )
        .limit(1)
        .get();
      if (!existing) throw new Error("Failed to load existing T3 delivery job.");
      if (existing.status === "failed") {
        tx.update(t3DeliveryJobs)
          .set({
            status: "pending",
            attemptCount: 0,
            nextAttemptAt: Date.now(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            updatedAt: nowSql(),
          })
          .where(and(eq(t3DeliveryJobs.id, existing.id), eq(t3DeliveryJobs.status, "failed")))
          .run();
      }
    }
  });
  kickT3DeliveryWorker();
}

export function ensureT3DeliveryJobForMessage(messageId: number): void {
  const message = getMessage(messageId);
  if (!message || message.author !== "user") return;
  if (message.forwardRole === "source") return;
  const parent = message.parentId != null ? getMessage(message.parentId) : null;
  const t3SessionId =
    message.forwardRole === "target"
      ? message.forwardTargetSessionId
      : message.attachedSessionId || parent?.attachedSessionId || message.sessionId;
  if (!t3SessionId || detectSessionBackend(t3SessionId) !== "t3") return;
  enqueueT3DeliveryJob({
    messageId: message.id,
    messageSessionId: message.sessionId,
    t3SessionId,
    kind: message.forwardRole === "target" ? "forward_target_message" : "direct_user_message",
  });
}

function claimNextJob() {
  const now = Date.now();
  const workerId = `t3-delivery-${process.pid}-${randomUUID()}`;
  drizzleDb
    .update(t3DeliveryJobs)
    .set({ status: "retrying", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
    .where(and(eq(t3DeliveryJobs.status, "running"), lte(t3DeliveryJobs.lockedAt, now - LEASE_MS)))
    .run();

  return drizzleDb.transaction((tx) => {
    const row = tx
      .select(jobColumns)
      .from(t3DeliveryJobs)
      .where(
        and(
          inArray(t3DeliveryJobs.status, ["pending", "retrying"]),
          lte(t3DeliveryJobs.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(t3DeliveryJobs.id))
      .limit(1)
      .get();
    if (!row) return null;
    const job = DbT3DeliveryJob.assert(row);
    const claimed = tx
      .update(t3DeliveryJobs)
      .set({
        status: "running",
        attemptCount: job.attemptCount + 1,
        lockedAt: now,
        lockedBy: workerId,
        updatedAt: nowSql(),
      })
      .where(
        and(eq(t3DeliveryJobs.id, job.id), inArray(t3DeliveryJobs.status, ["pending", "retrying"])),
      )
      .run();
    return claimed.changes === 1
      ? { ...job, attemptCount: job.attemptCount + 1, lockedAt: now, lockedBy: workerId }
      : null;
  });
}

export async function runT3DeliveryOnce(): Promise<boolean> {
  const job = claimNextJob();
  if (!job) return false;
  const message = getMessage(job.messageId);
  if (!message) return true;

  try {
    const result = await dispatchT3Message({
      sessionId: job.t3SessionId,
      messageId: message.id,
      text: message.text,
    });
    const updated = drizzleDb
      .update(t3DeliveryJobs)
      .set({
        status: "succeeded",
        sequence: result.sequence,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: nowSql(),
      })
      .where(
        and(
          eq(t3DeliveryJobs.id, job.id),
          eq(t3DeliveryJobs.status, "running"),
          eq(t3DeliveryJobs.attemptCount, job.attemptCount),
        ),
      )
      .run();
    if (updated.changes === 1 && job.kind === "forward_target_message") {
      updateForwardStatus(message.id, "sent");
      if (message.forwardSourceMessageId != null)
        updateForwardTarget(message.forwardSourceMessageId, message.id, "sent");
    }
    if (updated.changes === 1) broadcastQueue(job.messageSessionId);
    if (updated.changes === 1 && job.t3SessionId !== job.messageSessionId)
      broadcastQueue(job.t3SessionId);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const terminal = job.attemptCount >= job.maxAttempts;
    const updated = drizzleDb
      .update(t3DeliveryJobs)
      .set({
        status: terminal ? "failed" : "retrying",
        nextAttemptAt: terminal ? job.nextAttemptAt : Date.now() + retryDelayMs(job.attemptCount),
        lockedAt: null,
        lockedBy: null,
        lastError: detail,
        updatedAt: nowSql(),
      })
      .where(
        and(
          eq(t3DeliveryJobs.id, job.id),
          eq(t3DeliveryJobs.status, "running"),
          eq(t3DeliveryJobs.attemptCount, job.attemptCount),
        ),
      )
      .run();
    if (updated.changes === 1 && terminal && job.kind === "forward_target_message") {
      updateForwardStatus(message.id, "failed");
      if (message.forwardSourceMessageId != null)
        updateForwardTarget(message.forwardSourceMessageId, message.id, "failed");
    }
    if (updated.changes === 1) broadcastQueue(job.messageSessionId);
    return true;
  }
}

let workerTimer: ReturnType<typeof setTimeout> | null = null;
let workerRunning = false;
let workerStopping = false;

async function workerTick() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await runT3DeliveryOnce();
  } catch (error) {
    console.error("[t3-delivery] worker tick failed:", error);
  } finally {
    workerRunning = false;
    if (!workerStopping) workerTimer = setTimeout(() => void workerTick(), POLL_MS);
  }
}

export function startT3DeliveryWorker(): void {
  workerStopping = false;
  if (!workerTimer && !workerRunning) void workerTick();
}

export function kickT3DeliveryWorker(): void {
  startT3DeliveryWorker();
}

export function resumeT3DeliveryWorkers(): void {
  const missing = drizzleDb
    .select({
      id: messages.id,
      sessionId: messages.sessionId,
      parentId: messages.parentId,
      attachedSessionId: messages.attachedSessionId,
      forwardRole: messages.forwardRole,
      forwardTargetSessionId: messages.forwardTargetSessionId,
    })
    .from(messages)
    .where(eq(messages.author, "user"))
    .all();
  for (const candidate of missing) {
    if (candidate.forwardRole === "source") continue;
    const parent = candidate.parentId != null ? getMessage(candidate.parentId) : null;
    const t3SessionId =
      candidate.forwardRole === "target"
        ? candidate.forwardTargetSessionId
        : candidate.attachedSessionId || parent?.attachedSessionId || candidate.sessionId;
    if (!t3SessionId || detectSessionBackend(t3SessionId) !== "t3") continue;
    if (
      !getT3DeliveryJob(
        candidate.id,
        candidate.forwardRole === "target" ? "forward_target_message" : "direct_user_message",
      )
    ) {
      ensureT3DeliveryJobForMessage(candidate.id);
    }
  }
  const pending = drizzleDb
    .select({ id: t3DeliveryJobs.id })
    .from(t3DeliveryJobs)
    .where(inArray(t3DeliveryJobs.status, ["pending", "retrying", "running"]))
    .limit(1)
    .get();
  if (pending) startT3DeliveryWorker();
}

export async function stopT3DeliveryWorker(): Promise<void> {
  workerStopping = true;
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = null;
  while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 0));
}

export function getT3DeliveryJob(messageId: number, kind: string) {
  const row = drizzleDb
    .select(jobColumns)
    .from(t3DeliveryJobs)
    .where(and(eq(t3DeliveryJobs.messageId, messageId), eq(t3DeliveryJobs.kind, kind)))
    .limit(1)
    .get();
  return row ? DbT3DeliveryJob.assert(row) : null;
}
