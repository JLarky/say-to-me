export type JarvisTimerLabelInput = {
  status: string;
  nextFireAt: number;
  intervalMs?: number | null;
  lastError?: string | null;
};

export function formatTimerTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function repeatLabel(timer: Pick<JarvisTimerLabelInput, "intervalMs">): string {
  if (!timer.intervalMs) return "One-shot";
  const minutes = Math.round(timer.intervalMs / 60_000);
  if (minutes < 60) return `Every ${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `Every ${hours}h` : `Every ${minutes}m`;
}

export function timerStatusLabel(
  timer: Pick<JarvisTimerLabelInput, "status" | "lastError">,
): string {
  if (timer.lastError) return `${timer.status} / error`;
  return timer.status;
}

export function timerSortTime(timer: Pick<JarvisTimerLabelInput, "status" | "nextFireAt">): number {
  if (timer.status === "active" || timer.status === "firing") return timer.nextFireAt;
  return Number.MAX_SAFE_INTEGER;
}

export function isExpiredPausedTimer(
  timer: Pick<JarvisTimerLabelInput, "status" | "nextFireAt">,
  now: number,
): boolean {
  return timer.status === "paused" && timer.nextFireAt <= now;
}

export function timerNeedsClock(timer: Pick<JarvisTimerLabelInput, "status">): boolean {
  return timer.status === "active" || timer.status === "paused" || timer.status === "firing";
}

export function canEditTimer(timer: Pick<JarvisTimerLabelInput, "status">): boolean {
  return timer.status === "active" || timer.status === "paused" || timer.status === "cancelled";
}

export function canStopTimer(timer: Pick<JarvisTimerLabelInput, "status">): boolean {
  return timer.status === "active" || timer.status === "paused" || timer.status === "firing";
}

export function timerCountdownLabel(
  timer: Pick<JarvisTimerLabelInput, "status" | "nextFireAt">,
  now = Date.now(),
): string {
  if (isExpiredPausedTimer(timer, now)) return "stopped";
  if (timer.status === "paused")
    return `paused until resumed, next fire ${formatTimerTime(timer.nextFireAt)}`;
  if (timer.status === "cancelled") return "cancelled";
  if (timer.status === "completed") return "completed";
  if (timer.status === "firing") return "firing now";
  const remaining = timer.nextFireAt - now;
  if (remaining <= 0) return "due now";
  return `will fire in ${formatRemaining(remaining)}`;
}

export function timerScheduleLabel(
  timer: Pick<JarvisTimerLabelInput, "status" | "nextFireAt">,
): string {
  if (timer.status === "cancelled") return "Cancelled. Edit to schedule again.";
  if (timer.status === "completed") return "Completed";
  return `Next fire ${formatTimerTime(timer.nextFireAt)}`;
}
