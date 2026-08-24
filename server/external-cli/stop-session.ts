import { broadcastQueue } from "../broadcast.ts";
import { getMessage } from "../messages.ts";
import { ensureSession } from "../sessions.ts";
import { markDeliveryStoppedByUser, STOPPED_BY_USER_REASON } from "./stop-delivery.ts";

export type StopExternalCliResult = { ok: true } | { ok: false; status: number; error: string };

export type ActiveDeliveryJob = {
  id: number;
  messageId: number;
  /** Present when the caller's listActiveJobs selects it; `busyOnly` needs it. */
  status?: string;
};

export type StopExternalCliSessionConfig = {
  sessionId: string;
  isValidSessionId: (sessionId: string) => boolean;
  invalidSessionIdError: string;
  listActiveJobs: (sessionId: string) => ActiveDeliveryJob[];
  cancelJob: (jobId: number) => number;
  killWorker: (sessionId: string) => Promise<void>;
  /**
   * Jobs for these messages survive the stop. Force send reuses this flow to
   * clear the busy turn without cancelling its own delivery.
   */
  keepMessageIds?: readonly number[];
  /**
   * Cancel only claimed jobs (a provider turn actually in flight). Plain Stop
   * leaves this unset and cancels every active job, queued ones included.
   */
  busyOnly?: boolean;
};

/**
 * Cancel in-flight external-CLI delivery for a session. Kills the Boo worker
 * (best effort). The worker stays down until the next enqueue respawns it —
 * same dormant pattern as `boo kill`, by design for an explicit user stop.
 */
export async function stopExternalCliSession(
  config: StopExternalCliSessionConfig,
): Promise<StopExternalCliResult> {
  if (!config.isValidSessionId(config.sessionId)) {
    return { ok: false, status: 400, error: config.invalidSessionIdError };
  }

  ensureSession(config.sessionId);

  const broadcastSessionIds = new Set<string>([config.sessionId]);
  for (const job of config.listActiveJobs(config.sessionId)) {
    if (config.keepMessageIds?.includes(job.messageId)) continue;
    if (config.busyOnly && job.status !== "running") continue;
    const cancelled = config.cancelJob(job.id);
    if (cancelled === 0) continue;
    const message = getMessage(job.messageId);
    if (message) {
      markDeliveryStoppedByUser(message);
      broadcastSessionIds.add(message.sessionId);
    }
  }

  for (const broadcastSessionId of broadcastSessionIds) {
    broadcastQueue(broadcastSessionId);
  }

  try {
    await config.killWorker(config.sessionId);
  } catch {
    // Worker may already be idle or absent.
  }

  return { ok: true };
}

export { STOPPED_BY_USER_REASON };
