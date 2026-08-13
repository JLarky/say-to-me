import * as stylex from "@stylexjs/stylex";

import {
  sessionListLabel,
  sessionProviderLabel,
  showSessionIdSubline,
  type SessionDisplayInput,
} from "../session-label.ts";
import { session as sessionStyles } from "../styles/session.stylex.ts";

type SessionLabelProps = {
  session: SessionDisplayInput;
};

/** One-line list label from the shared resolver. */
export function SessionListLabel({ session }: SessionLabelProps) {
  return <>{sessionListLabel(session)}</>;
}

type SessionListLabelRowProps = SessionLabelProps & {
  /** When true, show muted session id under/alongside when label differs from id. */
  showId?: boolean;
};

/** List label with optional id subline (Home, Jarvis rows). */
export function SessionListLabelRow({ session, showId = true }: SessionListLabelRowProps) {
  const label = sessionListLabel(session);
  return (
    <span {...stylex.props(sessionStyles.titleCluster)}>
      <span>{label}</span>
      {showId && showSessionIdSubline(session) ? (
        <span {...stylex.props(sessionStyles.idSub)}>{session.id}</span>
      ) : null}
    </span>
  );
}

type SessionProviderSublineProps = SessionLabelProps;

/** Muted provider line when it differs from the list label. */
export function SessionProviderSubline({ session }: SessionProviderSublineProps) {
  const listLabel = sessionListLabel(session);
  const providerLabel = sessionProviderLabel(session);
  if (!providerLabel || providerLabel === listLabel) return null;
  return <span {...stylex.props(sessionStyles.providerTitleText)}>{providerLabel}</span>;
}
