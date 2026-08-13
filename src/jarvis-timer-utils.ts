import { ErrorPayload, type JarvisTimer, type Session } from "./types.ts";

export {
  canEditTimer,
  canStopTimer,
  formatRemaining,
  formatTimerTime,
  isExpiredPausedTimer,
  repeatLabel,
  timerCountdownLabel,
  timerNeedsClock,
  timerScheduleLabel,
  timerSortTime,
  timerStatusLabel,
} from "@say-to-me/session-utils/jarvis-timer-labels";

export type TimerDraft = {
  sessionId: string;
  title: string;
  message: string;
  nextFireAt: string;
  repeatMinutes: string;
};

export function emptyTimerDraft(sessions: Session[]): TimerDraft {
  return {
    sessionId: sessions[0]?.id ?? "default",
    title: "Check in",
    message:
      "User has set a wake up timer for this session. If you know what action is expected from you act on that. If you are unsure you might ask user for clarification. Use `say-to-me usage timers` to learn more how to control timers including Pausing a timer which you think was sent to you by accident.",
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

export function errorMessage(value: unknown, fallback: string): string {
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

export function draftFromTimer(timer: JarvisTimer): TimerDraft {
  return {
    sessionId: timer.sessionId,
    title: timer.title,
    message: timer.message,
    nextFireAt: localDateTime(timer.nextFireAt),
    repeatMinutes: timer.intervalMs ? String(Math.round(timer.intervalMs / 60_000)) : "",
  };
}
