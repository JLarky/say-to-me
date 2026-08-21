export type RoutineLabelInput = {
  status: string;
  nextFireAt: number;
  intervalMs?: number | null;
  lastError?: string | null;
};

export function formatRoutineTime(timestamp: number): string {
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

export function repeatLabel(routine: Pick<RoutineLabelInput, "intervalMs">): string {
  if (!routine.intervalMs) return "One-shot";
  const minutes = Math.round(routine.intervalMs / 60_000);
  if (minutes < 60) return `Every ${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `Every ${hours}h` : `Every ${minutes}m`;
}

export function routineStatusLabel(
  routine: Pick<RoutineLabelInput, "status" | "lastError">,
): string {
  if (routine.lastError) return `${routine.status} / error`;
  return routine.status;
}

export function routineSortTime(routine: Pick<RoutineLabelInput, "status" | "nextFireAt">): number {
  if (routine.status === "active" || routine.status === "firing") return routine.nextFireAt;
  return Number.MAX_SAFE_INTEGER;
}

export function isExpiredPausedRoutine(
  routine: Pick<RoutineLabelInput, "status" | "nextFireAt">,
  now: number,
): boolean {
  return routine.status === "paused" && routine.nextFireAt <= now;
}

export function routineNeedsClock(routine: Pick<RoutineLabelInput, "status">): boolean {
  return routine.status === "active" || routine.status === "paused" || routine.status === "firing";
}

export function canEditRoutine(routine: Pick<RoutineLabelInput, "status">): boolean {
  return (
    routine.status === "active" || routine.status === "paused" || routine.status === "cancelled"
  );
}

export function canStopRoutine(routine: Pick<RoutineLabelInput, "status">): boolean {
  return routine.status === "active" || routine.status === "paused" || routine.status === "firing";
}

export function routineCountdownLabel(
  routine: Pick<RoutineLabelInput, "status" | "nextFireAt">,
  now = Date.now(),
): string {
  if (isExpiredPausedRoutine(routine, now)) return "stopped";
  if (routine.status === "paused")
    return `paused until resumed, next fire ${formatRoutineTime(routine.nextFireAt)}`;
  if (routine.status === "cancelled") return "cancelled";
  if (routine.status === "fired") return "fired";
  if (routine.status === "firing") return "firing now";
  const remaining = routine.nextFireAt - now;
  if (remaining <= 0) return "due now";
  return `will fire in ${formatRemaining(remaining)}`;
}

export function routineScheduleLabel(
  routine: Pick<RoutineLabelInput, "status" | "nextFireAt">,
): string {
  if (routine.status === "cancelled") return "Cancelled. Edit to schedule again.";
  if (routine.status === "fired") return "Fired";
  return `Next fire ${formatRoutineTime(routine.nextFireAt)}`;
}
