import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { broadcastQueue } from "../broadcast.ts";
import { drizzleDb } from "../db/index.ts";
import { messages, paseoDeliveryJobs } from "../db/drizzle-schema.ts";
import { DbPaseoDeliveryJob } from "../db/schemas.ts";
import { getMessage, updateForwardStatus, updateForwardTarget } from "../messages.ts";
import { detectSessionBackend } from "../session-id.ts";
import { dispatchPaseoMessage, PaseoCommandError } from "./client.ts";

const POLL_MS = Number(process.env.SAY_TO_ME_PASEO_DELIVERY_POLL_MS || 250);
const LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export type PaseoDeliveryJobInput = {
  messageId: number;
  messageSessionId: string;
  paseoSessionId: string;
  kind: "direct_user_message" | "forward_target_message";
  maxAttempts?: number;
};

const columns = {
  id: paseoDeliveryJobs.id,
  messageId: paseoDeliveryJobs.messageId,
  messageSessionId: paseoDeliveryJobs.messageSessionId,
  paseoSessionId: paseoDeliveryJobs.paseoSessionId,
  kind: paseoDeliveryJobs.kind,
  status: paseoDeliveryJobs.status,
  attemptCount: paseoDeliveryJobs.attemptCount,
  maxAttempts: paseoDeliveryJobs.maxAttempts,
  nextAttemptAt: paseoDeliveryJobs.nextAttemptAt,
  lockedAt: paseoDeliveryJobs.lockedAt,
  lockedBy: paseoDeliveryJobs.lockedBy,
  lastError: paseoDeliveryJobs.lastError,
  createdAt: paseoDeliveryJobs.createdAt,
  updatedAt: paseoDeliveryJobs.updatedAt,
};

const nowSql = () => sql`CURRENT_TIMESTAMP`;
const retryDelayMs = (attempt: number) => Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));

export function shouldRetryPaseoDelivery(
  error: unknown,
  attemptCount: number,
  maxAttempts: number,
) {
  return attemptCount < maxAttempts && (!(error instanceof PaseoCommandError) || error.retryable);
}

export function enqueuePaseoDeliveryJob(input: PaseoDeliveryJobInput): boolean {
  const scheduled = drizzleDb.transaction((tx) => {
    const inserted = tx
      .insert(paseoDeliveryJobs)
      .values({
        ...input,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        status: "pending",
        nextAttemptAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes !== 0) return true;
    const existing = tx
      .select({ id: paseoDeliveryJobs.id, status: paseoDeliveryJobs.status })
      .from(paseoDeliveryJobs)
      .where(
        and(
          eq(paseoDeliveryJobs.messageId, input.messageId),
          eq(paseoDeliveryJobs.kind, input.kind),
        ),
      )
      .get();
    if (!existing) throw new Error("Failed to load existing Paseo delivery job.");
    if (existing.status === "failed") {
      tx.update(paseoDeliveryJobs)
        .set({
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: Date.now(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: nowSql(),
        })
        .where(eq(paseoDeliveryJobs.id, existing.id))
        .run();
      return true;
    }
    return false;
  });
  if (scheduled) kickPaseoDeliveryWorker();
  return scheduled;
}

export function ensurePaseoDeliveryJobForMessage(
  messageId: number,
  options: { retryFailed?: boolean } = {},
): void {
  const message = getMessage(messageId);
  if (!message || message.author !== "user" || message.forwardRole === "source") return;
  const parent = message.parentId != null ? getMessage(message.parentId) : null;
  const target =
    message.forwardRole === "target"
      ? message.forwardTargetSessionId
      : message.attachedSessionId || parent?.attachedSessionId || message.sessionId;
  if (!target || !["paseo", "paseo-chat"].includes(detectSessionBackend(target))) return;
  const kind = message.forwardRole === "target" ? "forward_target_message" : "direct_user_message";
  const existing = getPaseoDeliveryJob(message.id, kind);
  if (existing && (!options.retryFailed || existing.status !== "failed")) return;
  enqueuePaseoDeliveryJob({
    messageId: message.id,
    messageSessionId: message.sessionId,
    paseoSessionId: target,
    kind,
  });
}

function claimNextJob() {
  const now = Date.now();
  const workerId = `paseo-delivery-${process.pid}-${randomUUID()}`;
  drizzleDb
    .update(paseoDeliveryJobs)
    .set({ status: "retrying", lockedAt: null, lockedBy: null, updatedAt: nowSql() })
    .where(
      and(eq(paseoDeliveryJobs.status, "running"), lte(paseoDeliveryJobs.lockedAt, now - LEASE_MS)),
    )
    .run();
  return drizzleDb.transaction((tx) => {
    const row = tx
      .select(columns)
      .from(paseoDeliveryJobs)
      .where(
        and(
          inArray(paseoDeliveryJobs.status, ["pending", "retrying"]),
          lte(paseoDeliveryJobs.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(paseoDeliveryJobs.id))
      .limit(1)
      .get();
    if (!row) return null;
    const job = DbPaseoDeliveryJob.assert(row);
    const claimed = tx
      .update(paseoDeliveryJobs)
      .set({
        status: "running",
        attemptCount: job.attemptCount + 1,
        lockedAt: now,
        lockedBy: workerId,
        updatedAt: nowSql(),
      })
      .where(
        and(
          eq(paseoDeliveryJobs.id, job.id),
          inArray(paseoDeliveryJobs.status, ["pending", "retrying"]),
        ),
      )
      .run();
    return claimed.changes === 1
      ? { ...job, attemptCount: job.attemptCount + 1, lockedAt: now, lockedBy: workerId }
      : null;
  });
}

export async function runPaseoDeliveryOnce(): Promise<boolean> {
  const job = claimNextJob();
  if (!job) return false;
  const message = getMessage(job.messageId);
  if (!message) return true;
  try {
    await dispatchPaseoMessage({ sessionId: job.paseoSessionId, text: message.text });
    const updated = drizzleDb
      .update(paseoDeliveryJobs)
      .set({
        status: "succeeded",
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: nowSql(),
      })
      .where(
        and(
          eq(paseoDeliveryJobs.id, job.id),
          eq(paseoDeliveryJobs.status, "running"),
          eq(paseoDeliveryJobs.attemptCount, job.attemptCount),
        ),
      )
      .run();
    if (updated.changes === 1 && job.kind === "forward_target_message") {
      updateForwardStatus(message.id, "sent");
      if (message.forwardSourceMessageId != null)
        updateForwardTarget(message.forwardSourceMessageId, message.id, "sent");
    }
    if (updated.changes === 1) broadcastQueue(job.messageSessionId);
    if (updated.changes === 1 && job.paseoSessionId !== job.messageSessionId)
      broadcastQueue(job.paseoSessionId);
  } catch (error) {
    const retryable = shouldRetryPaseoDelivery(error, job.attemptCount, job.maxAttempts);
    const ambiguous = error instanceof PaseoCommandError && !error.retryable;
    const terminal = !retryable;
    const updated = drizzleDb
      .update(paseoDeliveryJobs)
      .set({
        status: ambiguous ? "ambiguous" : terminal ? "failed" : "retrying",
        nextAttemptAt: terminal ? job.nextAttemptAt : Date.now() + retryDelayMs(job.attemptCount),
        lockedAt: null,
        lockedBy: null,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: nowSql(),
      })
      .where(
        and(
          eq(paseoDeliveryJobs.id, job.id),
          eq(paseoDeliveryJobs.status, "running"),
          eq(paseoDeliveryJobs.attemptCount, job.attemptCount),
        ),
      )
      .run();
    if (updated.changes === 1 && terminal && job.kind === "forward_target_message") {
      updateForwardStatus(message.id, "failed");
      if (message.forwardSourceMessageId != null)
        updateForwardTarget(message.forwardSourceMessageId, message.id, "failed");
    }
    if (updated.changes === 1) broadcastQueue(job.messageSessionId);
  }
  return true;
}

let workerTimer: ReturnType<typeof setTimeout> | null = null;
let workerRunning = false;
let workerStopping = false;

async function workerTick() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await runPaseoDeliveryOnce();
  } catch (error) {
    console.error("[paseo-delivery] worker tick failed:", error);
  } finally {
    workerRunning = false;
    if (!workerStopping) workerTimer = setTimeout(() => void workerTick(), POLL_MS);
  }
}

export function startPaseoDeliveryWorker(): void {
  workerStopping = false;
  if (!workerTimer && !workerRunning) void workerTick();
}
export function kickPaseoDeliveryWorker(): void {
  startPaseoDeliveryWorker();
}

export function getPaseoDeliveryJob(messageId: number, kind: string) {
  const row = drizzleDb
    .select(columns)
    .from(paseoDeliveryJobs)
    .where(and(eq(paseoDeliveryJobs.messageId, messageId), eq(paseoDeliveryJobs.kind, kind)))
    .get();
  return row ? DbPaseoDeliveryJob.assert(row) : null;
}

export function resumePaseoDeliveryWorkers(): void {
  const candidates = drizzleDb
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.author, "user"))
    .all();
  for (const candidate of candidates) ensurePaseoDeliveryJobForMessage(candidate.id);
  const pending = drizzleDb
    .select({ id: paseoDeliveryJobs.id })
    .from(paseoDeliveryJobs)
    .where(inArray(paseoDeliveryJobs.status, ["pending", "retrying", "running"]))
    .limit(1)
    .get();
  if (pending) startPaseoDeliveryWorker();
}

export async function stopPaseoDeliveryWorker(): Promise<void> {
  workerStopping = true;
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = null;
  while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 0));
}
