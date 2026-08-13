import { useMemo, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link, useNavigate } from "react-router";

import type { PrototypeRosterStatus, PrototypeSession } from "../../new-space-prototype.ts";
import {
  isSessionLinkContextTarget,
  isUnmodifiedPrimaryClick,
  sessionHref,
} from "../../session-context-menu.ts";
import { badge } from "../../styles/feed.stylex.ts";
import { formatMessageTime, sessionsHref } from "../../utils.ts";
import { roster } from "./SpaceSessionRoster.stylex.ts";

export type SpaceSessionRosterProps = {
  spaceName: string;
  sessions: PrototypeSession[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCreateSession?: () => void;
  onImportSession?: () => void;
  onMoveSession?: (sessionId: string) => void;
  onReleaseSession?: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onSessionContextMenu?: (sessionId: string, event: ReactMouseEvent) => void;
  onViewHistory?: () => void;
  historyButtonRef?: RefObject<HTMLButtonElement | null>;
  includeSubspaces?: boolean;
};

function stateStyle(status: PrototypeRosterStatus | undefined) {
  if (status === "error") return roster.stateError;
  if (status === "attention") return roster.stateAttention;
  if (status === "idle") return roster.stateIdle;
  if (status === "unknown") return roster.stateUnknown;
  return null;
}

function rosterStatusOf(session: PrototypeSession): PrototypeRosterStatus {
  return session.rosterStatus ?? "unknown";
}

function rosterLabelOf(session: PrototypeSession): string {
  return session.rosterStatusLabel ?? (session.status === "Jarvis" ? "JARVIS" : "UNKNOWN");
}

function providerLine(session: PrototypeSession): string {
  return `${session.provider} · ${session.model}`;
}

function countByStatus(sessions: PrototypeSession[], status: PrototypeRosterStatus): number {
  return sessions.filter((session) => rosterStatusOf(session) === status).length;
}

export function SpaceSessionRoster({
  spaceName,
  sessions,
  loading = false,
  error = null,
  onRetry,
  onCreateSession,
  onImportSession,
  onMoveSession,
  onReleaseSession,
  onArchiveSession,
  onDeleteSession,
  onSessionContextMenu,
  onViewHistory,
  historyButtonRef,
  includeSubspaces = false,
}: SpaceSessionRosterProps) {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const summary = useMemo(
    () => ({
      error: countByStatus(sessions, "error"),
      attention: countByStatus(sessions, "attention"),
      working: countByStatus(sessions, "working"),
      idle: countByStatus(sessions, "idle"),
    }),
    [sessions],
  );

  if (loading) {
    return (
      <section {...stylex.props(roster.section)} aria-busy="true" aria-live="polite">
        <div {...stylex.props(roster.empty)}>
          <strong {...stylex.props(roster.emptyTitle)}>Loading sessions…</strong>
          <span {...stylex.props(roster.emptyBody)}>
            Reading attachments and cached status for {spaceName}.
          </span>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section {...stylex.props(roster.section)} aria-live="assertive">
        <div {...stylex.props(roster.empty)}>
          <strong {...stylex.props(roster.emptyTitle)}>Sessions unavailable</strong>
          <span {...stylex.props(roster.emptyBody)}>{error}</span>
          {onRetry ? (
            <div {...stylex.props(roster.actions)}>
              <button {...stylex.props(roster.copyButton)} type="button" onClick={onRetry}>
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  if (sessions.length === 0) {
    return (
      <section {...stylex.props(roster.section)}>
        <div {...stylex.props(roster.empty)}>
          <strong {...stylex.props(roster.emptyTitle)}>No sessions yet</strong>
          <span {...stylex.props(roster.emptyBody)}>
            Start a fresh session in {spaceName}, or import one from a claimed checkout.
          </span>
          <div {...stylex.props(roster.actions)}>
            {onCreateSession ? (
              <button {...stylex.props(roster.copyButton)} type="button" onClick={onCreateSession}>
                New session
              </button>
            ) : null}
            {onImportSession ? (
              <button {...stylex.props(roster.copyButton)} type="button" onClick={onImportSession}>
                Import session
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...stylex.props(roster.section)} aria-labelledby="space-session-roster-title">
      <header {...stylex.props(roster.header)}>
        <div>
          <span {...stylex.props(roster.eyebrow)}>SESSIONS</span>
          <strong {...stylex.props(roster.title)} id="space-session-roster-title">
            {sessions.length} session{sessions.length === 1 ? "" : "s"} in {spaceName}
            {includeSubspaces ? " and subspaces" : ""}
          </strong>
          <span {...stylex.props(roster.subtitle)}>
            Open a session from the title. Use details for workspace, ID, and Say facts.
          </span>
        </div>
        <div {...stylex.props(roster.summary)} aria-label="Session status summary">
          {summary.error + summary.attention > 0 ? (
            <span {...stylex.props(roster.summaryPill)}>
              <i {...stylex.props(roster.summaryDot, roster.summaryDotError)} />
              {summary.error + summary.attention} need attention
            </span>
          ) : null}
          {summary.working > 0 ? (
            <span {...stylex.props(roster.summaryPill)}>
              <i {...stylex.props(roster.summaryDot)} />
              {summary.working} working
            </span>
          ) : null}
          {summary.idle > 0 ? (
            <span {...stylex.props(roster.summaryPill)}>
              <i {...stylex.props(roster.summaryDot, roster.summaryDotIdle)} />
              {summary.idle} idle
            </span>
          ) : null}
        </div>
      </header>

      <ol {...stylex.props(roster.list)}>
        {sessions.map((session) => {
          const open = expandedId === session.id;
          const status = rosterStatusOf(session);
          const activity =
            session.latestActivityText ??
            (session.latestSayMessage ? session.latestSayMessage : null);
          const relative = session.activityAt ? formatMessageTime(session.activityAt) : "";
          return (
            <li
              {...stylex.props(roster.item)}
              key={session.id}
              data-session-item
              onContextMenu={(event) => {
                if (!onSessionContextMenu) return;
                // Anchor: browser menu only. Row body: custom menu only.
                if (isSessionLinkContextTarget(event.target)) return;
                event.preventDefault();
                onSessionContextMenu(session.id, event);
              }}
            >
              <div {...stylex.props(roster.row)}>
                <a
                  {...stylex.props(roster.open)}
                  href={sessionHref(session.id)}
                  data-session-link
                  aria-label={`Open session ${session.title}`}
                  onClick={(event) => {
                    if (!isUnmodifiedPrimaryClick(event)) return;
                    event.preventDefault();
                    void navigate(sessionHref(session.id));
                  }}
                >
                  <span
                    {...stylex.props(roster.state, stateStyle(status))}
                    title={rosterLabelOf(session)}
                  >
                    <i {...stylex.props(roster.stateDot)} />
                    <span {...stylex.props(roster.stateLabel)}>{rosterLabelOf(session)}</span>
                  </span>
                  <strong {...stylex.props(roster.name)}>{session.title}</strong>
                  <span {...stylex.props(roster.meta)}>{providerLine(session)}</span>
                </a>
                <span {...stylex.props(roster.badges)}>
                  {session.state === "important" ? (
                    <span {...stylex.props(badge.base)}>Pinned</span>
                  ) : null}
                  {session.state === "jarvis" ? (
                    <span {...stylex.props(badge.base, badge.pending)}>Jarvis</span>
                  ) : null}
                </span>
                <span {...stylex.props(roster.latest)}>
                  <span {...stylex.props(roster.latestLabel)}>LATEST</span>
                  <span
                    {...stylex.props(roster.latestText, !activity && roster.latestEmpty)}
                    title={activity ?? undefined}
                  >
                    {activity ?? "No Say activity yet"}
                  </span>
                </span>
                <time {...stylex.props(roster.time)} dateTime={session.activityAt ?? undefined}>
                  {relative || "—"}
                </time>
                <button
                  {...stylex.props(roster.expand, open && roster.expandOpen)}
                  type="button"
                  aria-expanded={open}
                  aria-controls={`session-details-${session.id}`}
                  aria-label={`${open ? "Hide" : "Show"} details for ${session.title}`}
                  onClick={() =>
                    setExpandedId((current) => (current === session.id ? null : session.id))
                  }
                >
                  <span
                    {...stylex.props(roster.chevron, open && roster.chevronOpen)}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </button>
              </div>
              <span {...stylex.props(roster.mobileLatest)}>
                {activity ?? "No Say activity yet"}
              </span>
              {open ? (
                <div
                  {...stylex.props(roster.details)}
                  id={`session-details-${session.id}`}
                  aria-label={`${session.title} details`}
                >
                  <div {...stylex.props(roster.detailGrid)}>
                    {session.workspacePath ? (
                      <span {...stylex.props(roster.detailBlock)}>
                        <span {...stylex.props(roster.detailLabel)}>WORKSPACE</span>
                        <Link
                          {...stylex.props(roster.workspaceLink)}
                          to={sessionsHref(session.workspacePath)}
                        >
                          {session.workspaceLabel || session.workspacePath}{" "}
                          <span aria-hidden="true">→</span>
                        </Link>
                      </span>
                    ) : null}
                    <span {...stylex.props(roster.detailBlock)}>
                      <span {...stylex.props(roster.detailLabel)}>SESSION ID</span>
                      <span {...stylex.props(roster.sessionLine)}>
                        <a
                          {...stylex.props(roster.sessionId, roster.sessionIdLink)}
                          href={sessionHref(session.id)}
                          data-session-link
                          onClick={(event) => {
                            if (!isUnmodifiedPrimaryClick(event)) return;
                            event.preventDefault();
                            void navigate(sessionHref(session.id));
                          }}
                        >
                          {session.id}
                        </a>
                        <button
                          {...stylex.props(roster.copyButton)}
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(session.id).then(() => {
                              setCopiedId(session.id);
                            });
                          }}
                        >
                          {copiedId === session.id ? "Copied" : "Copy"}
                        </button>
                      </span>
                    </span>
                    <span {...stylex.props(roster.detailBlock, roster.detailWide)}>
                      <span {...stylex.props(roster.detailLabel)}>LATEST SAY MESSAGE</span>
                      {session.latestSayMessage ? (
                        <span {...stylex.props(roster.messageText)}>
                          {session.latestSayAuthor ? `${session.latestSayAuthor}: ` : ""}“
                          {session.latestSayMessage}”
                        </span>
                      ) : (
                        <span {...stylex.props(roster.muted)}>No Say messages yet</span>
                      )}
                    </span>
                    {session.latestDeliveryError ? (
                      <span {...stylex.props(roster.detailBlock, roster.detailWide)}>
                        <span {...stylex.props(roster.detailLabel)}>DELIVERY ERROR</span>
                        <span {...stylex.props(roster.messageText)}>
                          {session.latestDeliveryError}
                        </span>
                      </span>
                    ) : null}
                    {session.timerSummary ? (
                      <span {...stylex.props(roster.detailBlock, roster.detailWide)}>
                        <span {...stylex.props(roster.detailLabel)}>TIMER</span>
                        <span {...stylex.props(roster.timerText)}>{session.timerSummary}</span>
                      </span>
                    ) : null}
                    {session.importedAt ? (
                      <span {...stylex.props(roster.detailBlock)}>
                        <span {...stylex.props(roster.detailLabel)}>ATTACHED</span>
                        <span {...stylex.props(roster.timerText)}>
                          {formatMessageTime(session.importedAt) || session.importedAt}
                        </span>
                      </span>
                    ) : null}
                    {onMoveSession || onReleaseSession || onArchiveSession || onDeleteSession ? (
                      <span {...stylex.props(roster.detailBlock, roster.detailWide)}>
                        <span {...stylex.props(roster.detailLabel)}>ACTIONS</span>
                        <div {...stylex.props(roster.actions)}>
                          {onMoveSession ? (
                            <button
                              {...stylex.props(roster.copyButton)}
                              type="button"
                              onClick={() => onMoveSession(session.id)}
                            >
                              Move
                            </button>
                          ) : null}
                          {onReleaseSession ? (
                            <button
                              {...stylex.props(roster.copyButton)}
                              type="button"
                              onClick={() => onReleaseSession(session.id)}
                            >
                              Release from space
                            </button>
                          ) : null}
                          {onArchiveSession ? (
                            <button
                              {...stylex.props(roster.copyButton)}
                              type="button"
                              onClick={() => onArchiveSession(session.id)}
                            >
                              Archive
                            </button>
                          ) : null}
                          {onDeleteSession ? (
                            <button
                              {...stylex.props(roster.copyButton)}
                              type="button"
                              onClick={() => onDeleteSession(session.id)}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <footer {...stylex.props(roster.footer)}>
        <span>Sorted by attention, working, then idle. Optional fields omitted when unknown.</span>
        {onViewHistory ? (
          <button
            {...stylex.props(roster.historyButton)}
            type="button"
            ref={historyButtonRef}
            onClick={onViewHistory}
          >
            View full history →
          </button>
        ) : null}
      </footer>
    </section>
  );
}
