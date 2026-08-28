import { BooDriver } from "./driver.ts";

const REPLACEMENT_MAX_ATTEMPTS = 40;
const REPLACEMENT_INTERVAL_MS = 500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type WorkerDriver = Pick<BooDriver, "listSessions" | "startCommand">;

export type ScheduleWorkerReplacementOptions = {
  driver?: WorkerDriver;
  intervalMs?: number;
  maxAttempts?: number;
};

const pendingReplacements = new Set<string>();

/**
 * A stale worker only exits on its next idle claim (after a 400), so its Boo
 * name lingers briefly and `ensureWorker` skips. Retry on a bounded backoff
 * until the name frees and a fresh worker starts, so the message that
 * triggered the retirement isn't left `pending` until the next enqueue. This
 * only *schedules* the replacement — no kill.
 */
export async function scheduleWorkerReplacement(
  workerName: string,
  autostartDisabled: boolean,
  ensureWorker: (driver: WorkerDriver) => Promise<boolean>,
  {
    driver = new BooDriver(),
    intervalMs = REPLACEMENT_INTERVAL_MS,
    maxAttempts = REPLACEMENT_MAX_ATTEMPTS,
  }: ScheduleWorkerReplacementOptions = {},
): Promise<void> {
  if (autostartDisabled) return;
  if (pendingReplacements.has(workerName)) return;
  pendingReplacements.add(workerName);
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (await ensureWorker(driver)) return;
      await delay(intervalMs);
    }
  } finally {
    pendingReplacements.delete(workerName);
  }
}
