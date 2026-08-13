import {
  resolveListDisplayName,
  resolveProviderTitleLabel,
  type SessionDisplayInput,
} from "./session-display.ts";

export type { SessionDisplayInput };

export function toSessionDisplayInput(session: SessionDisplayInput): SessionDisplayInput {
  return session;
}

/** Single-line label for lists, cards, notifications, chips. */
export function sessionListLabel(session: SessionDisplayInput): string {
  return resolveListDisplayName(session);
}

/** Provider layer label (ignores alias). */
export function sessionProviderLabel(session: SessionDisplayInput): string {
  return resolveProviderTitleLabel(session);
}

/** Show session id subline when the list label is not the raw id. */
export function showSessionIdSubline(session: SessionDisplayInput): boolean {
  return sessionListLabel(session) !== session.id;
}
