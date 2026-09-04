import { safeResponseJson } from "@say-to-me/runtime-validation";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { PageShell } from "../PageShell.tsx";
import { SessionList } from "../SessionList.tsx";
import { card, misc, text as textStyles } from "../../styles/chrome.stylex.ts";
import { composer, controls } from "../../styles/controls.stylex.ts";
import { queue } from "../../styles/feed.stylex.ts";
import { CreateOpenCodeSessionPayload, ErrorPayload, type Session } from "../../types.ts";
import { useSessions } from "../../use-sessions.ts";
import {
  openCodeProjectSegment,
  openCodeWorkspaceKey,
  openCodeWorkspaceSegment,
  projectFilterHref,
  sessionsHref,
} from "../../utils.ts";

function hrefForSession(sessionId: string | null | undefined): string {
  if (!sessionId) return "/";
  return sessionId === "default" ? "/default" : `/ses/${sessionId}`;
}

function errorMessage(cause: unknown, fallback: string): string {
  const value = cause;
  if (value instanceof Error) return value.message || fallback;
  try {
    return ErrorPayload.assert(value).error || fallback;
  } catch {
    return fallback;
  }
}

export function SessionGroupPage() {
  const navigate = useNavigate();
  const { projectId, workspaceId } = useParams();
  const { sessions, error, deleteSession, updateSessionState } = useSessions();
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");

  const filtered = useMemo(
    () =>
      sessions.filter((session: Session) => {
        if (session.opencodeProjectId !== projectId) return false;
        if (workspaceId && openCodeWorkspaceKey(session) !== workspaceId) return false;
        return true;
      }),
    [sessions, projectId, workspaceId],
  );

  const projectLabel =
    filtered.map((session) => openCodeProjectSegment(session)).find(Boolean) || projectId || "";
  const workspaceLabel = workspaceId
    ? filtered.map((session) => openCodeWorkspaceSegment(session)).find(Boolean) ||
      workspaceId ||
      ""
    : null;

  const heading = workspaceLabel ? `${projectLabel} / ${workspaceLabel}` : projectLabel;

  const workspaceDirectory = workspaceId
    ? (filtered.map((session) => session.opencodeDirectory).find(Boolean) ?? null)
    : null;
  const projectDirectory =
    filtered.map((session) => session.opencodeWorktree).find(Boolean) ||
    filtered.map((session) => session.opencodeDirectory).find(Boolean) ||
    null;

  useEffect(() => {
    document.title = `${heading} · Say To Me`;
  }, [heading]);

  async function create(endpoint: string, body: Record<string, string>) {
    setWorking(true);
    setActionError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await safeResponseJson(response, CreateOpenCodeSessionPayload);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Unable to create OpenCode session."));
      }
      await navigate(hrefForSession(payload.session.id));
    } catch (err) {
      setActionError(errorMessage(err, "Unable to create OpenCode session."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageShell
      eyebrow="OpenCode sessions"
      backTo={workspaceId && projectId ? projectFilterHref(projectId) : "/"}
      backLabel={workspaceId ? "Back to project" : "Back to all sessions"}
      hero={
        <>
          <h1 {...stylex.props(textStyles.title)}>{heading}</h1>
          <p {...stylex.props(textStyles.lede)}>
            {workspaceLabel
              ? "Sessions in this OpenCode workspace."
              : "Sessions in this OpenCode project."}
          </p>
        </>
      }
    >
      <section {...stylex.props(card.base, composer.root)}>
        <div {...stylex.props(composer.actions)}>
          {workspaceId ? (
            <button
              type="button"
              {...stylex.props(controls.button, controls.autoMobileWidth)}
              disabled={working || !workspaceDirectory}
              onClick={() => {
                if (workspaceDirectory)
                  void create("/api/opencode-sessions", { path: workspaceDirectory });
              }}
            >
              Create session in this workspace
            </button>
          ) : (
            <>
              <button
                type="button"
                {...stylex.props(controls.button, controls.autoMobileWidth)}
                disabled={working || !projectDirectory}
                onClick={() => {
                  if (projectDirectory)
                    void create("/api/opencode-sessions", { path: projectDirectory });
                }}
              >
                {projectLabel
                  ? `Create session in ${projectLabel}`
                  : "Create session in this project"}
              </button>
              <button
                type="button"
                {...stylex.props(controls.button, controls.secondary, controls.autoMobileWidth)}
                disabled={working || !projectDirectory}
                onClick={() => {
                  if (projectDirectory)
                    void create("/api/opencode-workspaces", { directory: projectDirectory });
                }}
              >
                Create worktree
              </button>
            </>
          )}
          {projectDirectory ? (
            <button
              type="button"
              {...stylex.props(controls.button, controls.secondary, controls.autoMobileWidth)}
              onClick={() => void navigate(sessionsHref(projectDirectory))}
            >
              All sessions for this folder
            </button>
          ) : null}
        </div>
        {actionError ? <div {...stylex.props(misc.error)}>{actionError}</div> : null}
      </section>

      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}

      <section {...stylex.props(card.base, queue.panel)}>
        <div {...stylex.props(queue.heading)}>
          <h2 {...stylex.props(queue.headingH2)}>Sessions</h2>
          <span {...stylex.props(queue.headingCount)}>{filtered.length}</span>
        </div>
        <SessionList
          sessions={filtered}
          onOpen={(id) => navigate(hrefForSession(id))}
          onDelete={deleteSession}
          onStateChange={updateSessionState}
          onFilter={(href) => navigate(href)}
        />
      </section>
    </PageShell>
  );
}
