import { ErrorPayload, type Routine, type Session } from "./types.ts";

export {
  canEditRoutine as canEditTimer,
  canStopRoutine as canStopTimer,
  formatRemaining,
  formatRoutineTime as formatTimerTime,
  isExpiredPausedRoutine as isExpiredPausedTimer,
  repeatLabel,
  routineCountdownLabel as timerCountdownLabel,
  routineNeedsClock as timerNeedsClock,
  routineScheduleLabel as timerScheduleLabel,
  routineSortTime as timerSortTime,
  routineStatusLabel as timerStatusLabel,
  type RoutineLabelInput,
} from "@say-to-me/session-utils/routine-labels";

export type TimerDraft = {
  sessionId: string;
  title: string;
  message: string;
  nextFireAt: string;
  repeatMinutes: string;
};

export function routineLabelInput(
  routine: Routine,
  viewerSessionId?: string | null,
  sessions: Session[] = [],
) {
  const sessionName = (sessionId: string | null | undefined) => {
    if (!sessionId) return null;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return null;
    return session.alias?.trim() || session.opencodeTitle?.trim() || null;
  };

  if (routine.trigger.kind === "session_idle") {
    return {
      status: routine.status,
      nextFireAt: Number.MAX_SAFE_INTEGER,
      intervalMs: null,
      lastError: routine.lastError,
      triggerKind: "session_idle" as const,
      viewerSessionId: viewerSessionId ?? null,
      ownerSessionId: routine.ownerSessionId,
      targetSessionId: routine.trigger.targetSessionId,
      ownerDisplayName: sessionName(routine.ownerSessionId),
      targetDisplayName: sessionName(routine.trigger.targetSessionId),
      title: routine.title,
    };
  }
  return {
    status: routine.status,
    nextFireAt: routine.trigger.nextFireAt,
    intervalMs: routine.trigger.intervalMs,
    lastError: routine.lastError,
    triggerKind: "schedule" as const,
    viewerSessionId: viewerSessionId ?? null,
    ownerSessionId: routine.ownerSessionId,
    targetSessionId: null,
    ownerDisplayName: sessionName(routine.ownerSessionId),
    targetDisplayName: null,
    title: routine.title,
  };
}

export function emptyTimerDraft(sessions: Session[]): TimerDraft {
  return {
    sessionId: sessions[0]?.id ?? "default",
    title: "Check in",
    message:
      "User has set a wake up routine for this session. If you know what action is expected from you act on that. If you are unsure you might ask user for clarification. Use `say-to-me usage routines` to learn more how to control routines including Pausing a routine which you think was sent to you by accident.",
    nextFireAt: localDateTime(Date.now() + 15 * 60 * 1000),
    repeatMinutes: "",
  };
}

export function dueAtFromDraft(draft: TimerDraft): number {
  return new Date(draft.nextFireAt).getTime();
}

export function intervalFromDraft(draft: TimerDraft): number | null {
  const minutes = Number(draft.repeatMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60_000) : null;
}

export function errorMessage(cause: unknown, fallback: string): string {
  const value = cause;
  if (value instanceof Error) return value.message || fallback;
  try {
    return ErrorPayload.assert(value).error || fallback;
  } catch {
    return fallback;
  }
}

export function localDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function draftFromRoutine(routine: Routine): TimerDraft {
  if (routine.trigger.kind !== "schedule" || routine.action.kind !== "deliver_prompt") {
    return emptyTimerDraft([]);
  }
  return {
    sessionId: routine.ownerSessionId,
    title: routine.title ?? routine.action.title,
    message: routine.action.message,
    nextFireAt: localDateTime(routine.trigger.nextFireAt),
    repeatMinutes: routine.trigger.intervalMs
      ? String(Math.round(routine.trigger.intervalMs / 60_000))
      : "",
  };
}

/** @deprecated Use draftFromRoutine */
export const draftFromTimer = draftFromRoutine;
