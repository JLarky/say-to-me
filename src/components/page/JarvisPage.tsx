import {
  jarvisCandidateSessions,
  jarvisManagedSessions,
  jarvisSections,
  jarvisStatusLabel,
  type JarvisBucketId,
} from "@say-to-me/session-utils/jarvis-ordering";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { JarvisTimersOverview } from "../JarvisTimers.tsx";
import { PageShell } from "../PageShell.tsx";
import { OpenCodeStatusBadge } from "../SessionStatusControls.tsx";
import { SessionListLabel } from "../SessionLabel.tsx";
import { card, misc, text as textStyles } from "../../styles/chrome.stylex.ts";
import { composer as composerStyles, controls } from "../../styles/controls.stylex.ts";
import { badge, messageMeta, queue, thread } from "../../styles/feed.stylex.ts";
import { session as sessionStyles } from "../../styles/session.stylex.ts";
import { type Session } from "../../types.ts";
import { showSessionIdSubline } from "../../session-label.ts";
import { useSessions } from "../../use-sessions.ts";
import { formatMessageTime, projectIdentity, projectThemeStyle } from "../../utils.ts";

const jarvisStyles = stylex.create({
  meta: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.45rem",
    marginTop: "0.5rem",
  },
  summary: {
    color: "#52606d",
    marginTop: "0.55rem",
    marginBottom: 0,
    overflowWrap: "anywhere",
  },
  sectionStack: {
    display: "grid",
    rowGap: "0.9rem",
    columnGap: "0.9rem",
  },
  subgroupTitle: {
    marginTop: "1rem",
    marginBottom: "0.55rem",
    color: "#3e4c59",
    fontSize: "0.88rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
});

function hrefForSession(sessionId: string | null | undefined): string {
  if (!sessionId) return "/";
  return sessionId === "default" ? "/default" : `/ses/${sessionId}`;
}

function latestLine(text: string | null | undefined): string | null {
  return (
    text
      ?.trim()
      .split("\n")
      .findLast((line) => line.trim().length > 0)
      ?.trim() || null
  );
}

function bucketTitle(bucket: JarvisBucketId): string {
  switch (bucket) {
    case "active":
      return "Active or Watching";
    case "unknown":
      return "Unknown";
    case "idle":
      return "Known Idle";
  }
}

export function JarvisPage() {
  const [sessionInput, setSessionInput] = useState("");
  const { sessions, error, setError, updateSessionState } = useSessions({
    includeCachedStatus: true,
    includeJarvisOverviewDetails: true,
    live: true,
  });
  const managedSessions = jarvisManagedSessions(sessions);
  const candidateSessions = jarvisCandidateSessions(sessions);
  const sections = jarvisSections(candidateSessions);

  useEffect(() => {
    document.title = "Jarvis - Say To Me";
  }, []);

  async function markTypedSession(event: FormEvent) {
    event.preventDefault();
    const sessionId = sessionInput.trim();
    if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) {
      setError("Session id must look like ses_ followed by letters or numbers.");
      return;
    }
    setError("");
    await updateSessionState({ id: sessionId }, "jarvis");
    setSessionInput("");
  }

  async function setJarvisManaged(session: Session, managed: boolean) {
    await updateSessionState(session, managed ? "jarvis" : "general");
  }

  return (
    <PageShell
      eyebrow="Coordination"
      backTo="/"
      backLabel="Back to sessions"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title)}>Jarvis</h1>
          <p {...stylex.props(textStyles.lede)}>
            Cheap session coordination using cached status and latest Say To Me activity.
          </p>
        </>
      }
    >
      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}
      <JarvisTimersOverview sessions={sessions} setError={setError} />
      <section {...stylex.props(card.base, queue.panel)}>
        <div {...stylex.props(queue.heading)}>
          <div>
            <h2 {...stylex.props(queue.headingH2)}>Create Jarvis</h2>
            <p {...stylex.props(jarvisStyles.summary)}>
              Create a Jarvis workspace and session from a space on the dashboard. Open a space, use
              the space actions menu, and choose Create Jarvis.
            </p>
          </div>
        </div>
        <p {...stylex.props(jarvisStyles.summary)}>
          <Link to="/dashboard">Go to spaces dashboard</Link> to create or select a space first.
        </p>
      </section>
      <section {...stylex.props(card.base, queue.panel)}>
        <div {...stylex.props(queue.heading)}>
          <div>
            <h2 {...stylex.props(queue.headingH2)}>Jarvis Managed</h2>
            <p {...stylex.props(jarvisStyles.summary)}>
              Sessions explicitly selected for Jarvis coordination. This uses the existing session
              state and cached metadata, without extra OpenCode polling.
            </p>
          </div>
          <span {...stylex.props(queue.headingCount)}>{managedSessions.length}</span>
        </div>
        <form {...stylex.props(composerStyles.actions)} onSubmit={markTypedSession}>
          <input
            {...stylex.props(controls.textInput)}
            type="text"
            value={sessionInput}
            onChange={(event) => setSessionInput(event.target.value)}
            placeholder="ses_1dd864100ffes6uqv2NbJatAKt"
            aria-label="Jarvis session id"
          />
          <button {...stylex.props(controls.button)} type="submit">
            Mark as Jarvis
          </button>
        </form>
        {managedSessions.length ? (
          <ol {...stylex.props(thread.list, jarvisStyles.sectionStack)}>
            {managedSessions.map((session) => (
              <JarvisSessionRow
                key={session.id}
                session={session}
                onSetManaged={setJarvisManaged}
              />
            ))}
          </ol>
        ) : (
          <p {...stylex.props(misc.empty)}>No Jarvis-managed sessions yet.</p>
        )}
      </section>
      {sections.map((section) => (
        <section key={section.id} {...stylex.props(card.base, queue.panel)}>
          <div {...stylex.props(queue.heading)}>
            <div>
              <h2 {...stylex.props(queue.headingH2)}>{section.title}</h2>
              <p {...stylex.props(jarvisStyles.summary)}>
                Sessions with Say To Me activity in this window, grouped by current status.
              </p>
            </div>
            <span {...stylex.props(queue.headingCount)}>{section.sessions.length}</span>
          </div>
          {section.buckets.map(({ id: bucket, sessions: bucketSessions }) => (
            <div key={bucket}>
              <h3 {...stylex.props(jarvisStyles.subgroupTitle)}>
                {bucketTitle(bucket)} ({bucketSessions.length})
              </h3>
              <ol {...stylex.props(thread.list, jarvisStyles.sectionStack)}>
                {bucketSessions.map((session) => (
                  <JarvisSessionRow
                    key={session.id}
                    session={session}
                    bucket={bucket}
                    onSetManaged={setJarvisManaged}
                  />
                ))}
              </ol>
            </div>
          ))}
        </section>
      ))}
    </PageShell>
  );
}

function JarvisSessionRow({
  bucket,
  onSetManaged,
  session,
}: {
  bucket?: JarvisBucketId;
  onSetManaged: (session: Session, managed: boolean) => void | Promise<void>;
  session: Session;
}) {
  const identity = projectIdentity(session);
  const details = session.jarvisOverviewDetails;
  const latest = latestLine(details?.latestMessageText);
  const latestAt = details?.latestMessageCreatedAt || session.updatedAt;
  const managed = session.state === "jarvis";
  return (
    <li style={projectThemeStyle(identity)} {...stylex.props(thread.item, thread.projectItem)}>
      <div {...stylex.props(thread.projectItemContent)}>
        <div {...stylex.props(messageMeta.root)}>
          <div {...stylex.props(sessionStyles.titleRow)}>
            <span {...stylex.props(sessionStyles.titleCluster)}>
              <Link {...stylex.props(messageMeta.actionLink)} to={hrefForSession(session.id)}>
                <SessionListLabel session={session} />
              </Link>
              {showSessionIdSubline(session) ? (
                <span {...stylex.props(sessionStyles.idSub)}>{session.id}</span>
              ) : null}
            </span>
          </div>
        </div>
        <div {...stylex.props(jarvisStyles.meta)}>
          {managed ? <span {...stylex.props(badge.base, badge.pending)}>Jarvis</span> : null}
          {session.backend === "voice" || session.opencodeStatus ? (
            <OpenCodeStatusBadge
              status={session.opencodeStatus ?? "unavailable"}
              backend={session.backend}
            />
          ) : null}
          <span
            {...stylex.props(
              badge.base,
              bucket === "active" && badge.pending,
              bucket === "idle" && badge.done,
            )}
          >
            {jarvisStatusLabel(session)}
          </span>
          <span {...stylex.props(badge.base)}>{session.messageCount ?? 0} messages</span>
          {latestAt ? (
            <span {...stylex.props(badge.base)}>Latest {formatMessageTime(latestAt)}</span>
          ) : null}
        </div>
        {latest ? (
          <p {...stylex.props(jarvisStyles.summary)}>
            Last {details?.latestMessageAuthor ?? "message"}: {latest}
          </p>
        ) : null}
        <div {...stylex.props(messageMeta.actions)}>
          <button
            {...stylex.props(controls.button, controls.secondary)}
            type="button"
            onClick={() => onSetManaged(session, !managed)}
          >
            {managed ? "Unmark Jarvis" : "Mark as Jarvis"}
          </button>
        </div>
      </div>
    </li>
  );
}
