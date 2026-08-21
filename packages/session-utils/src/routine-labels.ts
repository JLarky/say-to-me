export type RoutineLabelInput = {
  status: string;
  nextFireAt: number;
  intervalMs?: number | null;
  lastError?: string | null;
  triggerKind?: "schedule" | "session_idle";
  /** Viewing session for idle waits — drives owner vs target copy. */
  viewerSessionId?: string | null;
  ownerSessionId?: string | null;
  targetSessionId?: string | null;
  /** Human label for the owner session (alias / title); falls back to id. */
  ownerDisplayName?: string | null;
  /** Human label for the watched session (alias / title); falls back to id. */
  targetDisplayName?: string | null;
  /** Stored routine title; auto `Wait for <id>` is treated as unlabeled. */
  title?: string | null;
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

export function repeatLabel(
  routine: Pick<RoutineLabelInput, "intervalMs" | "triggerKind">,
): string {
  if (routine.triggerKind === "session_idle") return "Wait until idle";
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

export function routineSortTime(
  routine: Pick<RoutineLabelInput, "status" | "nextFireAt" | "triggerKind">,
): number {
  if (routine.triggerKind === "session_idle") {
    return routine.status === "active" || routine.status === "firing" ? 0 : Number.MAX_SAFE_INTEGER;
  }
  if (routine.status === "active" || routine.status === "firing") return routine.nextFireAt;
  return Number.MAX_SAFE_INTEGER;
}

export function isExpiredPausedRoutine(
  routine: Pick<RoutineLabelInput, "status" | "nextFireAt" | "triggerKind">,
  now: number,
): boolean {
  if (routine.triggerKind === "session_idle") return false;
  return routine.status === "paused" && routine.nextFireAt <= now;
}

export function routineNeedsClock(
  routine: Pick<RoutineLabelInput, "status" | "triggerKind">,
): boolean {
  if (routine.triggerKind === "session_idle") return false;
  return routine.status === "active" || routine.status === "paused" || routine.status === "firing";
}

export function canEditRoutine(
  routine: Pick<RoutineLabelInput, "status" | "triggerKind">,
): boolean {
  if (routine.triggerKind === "session_idle") return false;
  return (
    routine.status === "active" || routine.status === "paused" || routine.status === "cancelled"
  );
}

export function canStopRoutine(
  routine: Pick<RoutineLabelInput, "status" | "triggerKind">,
): boolean {
  return routine.status === "active" || routine.status === "paused" || routine.status === "firing";
}

function partyName(
  sessionId: string | null | undefined,
  displayName: string | null | undefined,
  fallback: string,
): string {
  const human = displayName?.trim();
  if (human) return human;
  const id = sessionId?.trim();
  if (id) return id;
  return fallback;
}

/**
 * Auto titles written at relay create time — not human context. Custom titles
 * (any other string) are preserved as the routine's primary label.
 */
export function isGeneratedSessionIdleTitle(
  title: string | null | undefined,
  targetSessionId: string | null | undefined,
): boolean {
  if (title == null || title.trim() === "") return true;
  if (targetSessionId != null && title === `Wait for ${targetSessionId}`) return true;
  return false;
}

export function sessionIdlePartyLabel(
  routine: Pick<
    RoutineLabelInput,
    | "viewerSessionId"
    | "ownerSessionId"
    | "targetSessionId"
    | "ownerDisplayName"
    | "targetDisplayName"
  >,
): string {
  const viewer = routine.viewerSessionId;
  if (viewer && routine.targetSessionId && viewer === routine.targetSessionId) {
    const owner = partyName(routine.ownerSessionId, routine.ownerDisplayName, "another session");
    return `will notify ${owner} when idle`;
  }
  const target = partyName(routine.targetSessionId, routine.targetDisplayName, "target");
  return `waiting for ${target} to go idle`;
}

/** Primary list/card title for a session_idle routine. */
export function sessionIdleRoutineTitle(
  routine: Pick<
    RoutineLabelInput,
    | "title"
    | "viewerSessionId"
    | "ownerSessionId"
    | "targetSessionId"
    | "ownerDisplayName"
    | "targetDisplayName"
  >,
): string {
  if (!isGeneratedSessionIdleTitle(routine.title, routine.targetSessionId)) {
    return routine.title!.trim();
  }
  return sessionIdlePartyLabel(routine);
}

export function routineCountdownLabel(
  routine: Pick<
    RoutineLabelInput,
    | "status"
    | "nextFireAt"
    | "triggerKind"
    | "viewerSessionId"
    | "ownerSessionId"
    | "targetSessionId"
    | "ownerDisplayName"
    | "targetDisplayName"
    | "title"
  >,
  now = Date.now(),
): string {
  if (routine.triggerKind === "session_idle") {
    if (routine.status === "cancelled") return "cancelled";
    if (routine.status === "fired") return "notified";
    if (routine.status === "failed") return "failed";
    // Party context lives in the title; avoid duplicating raw/human wait copy.
    return "";
  }
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
  routine: Pick<
    RoutineLabelInput,
    | "status"
    | "nextFireAt"
    | "triggerKind"
    | "viewerSessionId"
    | "ownerSessionId"
    | "targetSessionId"
    | "ownerDisplayName"
    | "targetDisplayName"
    | "title"
  >,
): string {
  if (routine.triggerKind === "session_idle") {
    if (routine.status === "cancelled") return "Cancelled wait.";
    if (routine.status === "fired") return "Idle notification sent.";
    if (routine.status === "failed") return "Wait ended: target delivery failed.";
    return "Active wait.";
  }
  if (routine.status === "cancelled") return "Cancelled. Edit to schedule again.";
  if (routine.status === "fired") return "Fired";
  return `Next fire ${formatRoutineTime(routine.nextFireAt)}`;
}
