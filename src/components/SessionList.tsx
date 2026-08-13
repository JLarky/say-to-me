import React from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router";
import { sessionListSections } from "@say-to-me/session-utils/session-list-sections";

import { OpenCodeStatusBadge } from "./SessionStatusControls.tsx";
import { SessionListLabelRow } from "./SessionLabel.tsx";
import { misc } from "../styles/chrome.stylex.ts";
import { controls } from "../styles/controls.stylex.ts";
import { badge, messageMeta, queue, thread } from "../styles/feed.stylex.ts";
import { session as sessionStyles } from "../styles/session.stylex.ts";
import type { Session } from "../types.ts";
import type { SessionState } from "../types.ts";
import {
  cliContextLabel,
  openCodeContextLabel,
  openCodeWorkspaceKey,
  projectFilterHref,
  projectIdentity,
  projectThemeStyle,
  workspaceFilterHref,
} from "../utils.ts";

function hrefForSession(sessionId: string | null | undefined): string {
  if (!sessionId) return "/";
  return sessionId === "default" ? "/default" : `/ses/${sessionId}`;
}

type FilterNavigate = (href: string) => void;

/**
 * The OpenCode context badge: `OpenCode / <project> / <workspace>`, where each
 * segment is a filter link keyed by the session's stable ids (never the mutable
 * branch text). A segment is only a link when its id is available; otherwise it
 * renders as plain text.
 */
function OpenCodeContextBadge({
  session,
  onFilter,
}: {
  session: Session;
  onFilter?: FilterNavigate;
}) {
  const context = openCodeContextLabel(session);
  if (!context) return null;

  function hrefForSegment(kind: "project" | "workspace"): string | null {
    const projectId = session.opencodeProjectId;
    if (!projectId) return null;
    if (kind === "project") return projectFilterHref(projectId);
    const workspaceKey = openCodeWorkspaceKey(session);
    return workspaceKey ? workspaceFilterHref(projectId, workspaceKey) : null;
  }

  return (
    <span {...stylex.props(badge.base, badge.context)} title={context.title}>
      OpenCode
      {context.segments.map((segment) => {
        const href = hrefForSegment(segment.kind);
        return (
          <React.Fragment key={`${segment.kind}-${segment.text}`}>
            <span {...stylex.props(badge.separator)}>/</span>
            {href ? (
              <a
                href={href}
                {...stylex.props(badge.segmentLink)}
                onClick={(event) => {
                  if (!onFilter) return;
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onFilter(href);
                }}
              >
                {segment.text}
              </a>
            ) : (
              segment.text
            )}
          </React.Fragment>
        );
      })}
    </span>
  );
}

function CliContextBadge({ session, onFilter }: { session: Session; onFilter?: FilterNavigate }) {
  const context = cliContextLabel(session);
  if (!context) return null;

  return (
    <span {...stylex.props(badge.base, badge.context)} title={context.title}>
      {context.providerLabel}
      <span {...stylex.props(badge.separator)}>/</span>
      <Link
        to={context.href}
        {...stylex.props(badge.segmentLink)}
        onClick={(event) => {
          if (!onFilter) return;
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onFilter(context.href);
        }}
      >
        {context.folderLabel}
      </Link>
    </span>
  );
}

export function SessionList({
  sessions,
  onOpen,
  onDelete,
  onStateChange,
  onFilter,
}: {
  sessions: Session[];
  onOpen: (id: string) => void;
  onDelete?: (session: Session) => void;
  onStateChange?: (session: Session, state: SessionState) => void;
  onFilter?: FilterNavigate;
}) {
  if (!sessions.length) return <p {...stylex.props(misc.empty)}>No sessions yet.</p>;

  const { jarvis, important, general, archived } = sessionListSections(sessions);

  return (
    <>
      <SessionGroup
        sessions={jarvis}
        title="Jarvis"
        onOpen={onOpen}
        onDelete={onDelete}
        onStateChange={onStateChange}
        onFilter={onFilter}
      />
      <SessionGroup
        sessions={important}
        title="Important"
        onOpen={onOpen}
        onDelete={onDelete}
        onStateChange={onStateChange}
        onFilter={onFilter}
      />
      <SessionGroup
        sessions={general}
        title={important.length ? "General" : null}
        onOpen={onOpen}
        onDelete={onDelete}
        onStateChange={onStateChange}
        onFilter={onFilter}
      />
      {archived.length ? (
        <details {...stylex.props(thread.details)}>
          <summary {...stylex.props(thread.summary)}>Archived ({archived.length})</summary>
          <SessionGroup
            sessions={archived}
            title={null}
            onOpen={onOpen}
            onDelete={onDelete}
            onStateChange={onStateChange}
            onFilter={onFilter}
          />
        </details>
      ) : null}
    </>
  );
}

function SessionGroup({
  sessions,
  title,
  onOpen,
  onDelete,
  onStateChange,
  onFilter,
}: {
  sessions: Session[];
  title: string | null;
  onOpen: (id: string) => void;
  onDelete?: (session: Session) => void;
  onStateChange?: (session: Session, state: SessionState) => void;
  onFilter?: FilterNavigate;
}) {
  if (!sessions.length) return null;

  return (
    <>
      {title ? <h3 {...stylex.props(thread.group)}>{title}</h3> : null}
      <ol {...stylex.props(thread.list)}>
        {sessions.map((session) => (
          <SessionListItem
            key={session.id}
            session={session}
            onOpen={onOpen}
            onDelete={onDelete}
            onStateChange={onStateChange}
            onFilter={onFilter}
          />
        ))}
      </ol>
    </>
  );
}

export function SessionListItem({
  session,
  onOpen,
  onDelete,
  onStateChange,
  onFilter,
}: {
  session: Session;
  onOpen: (id: string) => void;
  onDelete?: (session: Session) => void;
  onStateChange?: (session: Session, state: SessionState) => void;
  onFilter?: FilterNavigate;
}) {
  const identity = projectIdentity(session);
  const state = session.state ?? "general";
  return (
    <li style={projectThemeStyle(identity)} {...stylex.props(thread.item, thread.projectItem)}>
      <div {...stylex.props(thread.projectItemContent)}>
        <div {...stylex.props(messageMeta.root)}>
          <div {...stylex.props(sessionStyles.titleRow)}>
            <span {...stylex.props(sessionStyles.titleCluster)}>
              <SessionListLabelRow session={session} />
            </span>
          </div>
          <span {...stylex.props(queue.badges)}>
            {session.backend === "voice" || session.opencodeStatus ? (
              <OpenCodeStatusBadge
                status={session.opencodeStatus ?? "unavailable"}
                backend={session.backend}
              />
            ) : null}
            <OpenCodeContextBadge session={session} onFilter={onFilter} />
            <CliContextBadge session={session} onFilter={onFilter} />
            <span {...stylex.props(badge.base)}>{session.messageCount} messages</span>
            {state === "important" ? <span {...stylex.props(badge.base)}>Pinned</span> : null}
            {state === "jarvis" ? (
              <span {...stylex.props(badge.base, badge.pending)}>Jarvis</span>
            ) : null}
          </span>
        </div>
        <div {...stylex.props(messageMeta.actions)}>
          <Link
            to={hrefForSession(session.id)}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
              onOpen(session.id);
            }}
            {...stylex.props(messageMeta.actionLink)}
          >
            Open
          </Link>
          {onStateChange ? (
            <button
              {...stylex.props(controls.button, controls.secondary)}
              type="button"
              onClick={() =>
                onStateChange(session, state === "important" ? "general" : "important")
              }
            >
              {state === "important" ? "Unpin" : "Pin"}
            </button>
          ) : null}
          {onStateChange ? (
            <button
              {...stylex.props(controls.button, controls.secondary)}
              type="button"
              onClick={() => onStateChange(session, state === "jarvis" ? "general" : "jarvis")}
            >
              {state === "jarvis" ? "Unmark Jarvis" : "Mark as Jarvis"}
            </button>
          ) : null}
          {onStateChange && state !== "archived" ? (
            <button
              {...stylex.props(controls.button, controls.secondary)}
              type="button"
              onClick={() => onStateChange(session, "archived")}
            >
              Archive
            </button>
          ) : null}
          {onStateChange && state === "archived" ? (
            <button
              {...stylex.props(controls.button, controls.secondary)}
              type="button"
              onClick={() => onStateChange(session, "general")}
            >
              Unarchive
            </button>
          ) : null}
          {session.id !== "default" && onDelete ? (
            <button
              {...stylex.props(controls.button, controls.danger)}
              type="button"
              onClick={() => onDelete(session)}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
