import { safeResponseJson } from "@say-to-me/runtime-validation";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { PageShell } from "../PageShell.tsx";
import { card, misc, text as textStyles } from "../../styles/chrome.stylex.ts";
import { composer, controls } from "../../styles/controls.stylex.ts";
import {
  CreateOpenCodeSessionPayload,
  ErrorPayload,
  TempWorkspacePathPayload,
  WorkspacePathPayload,
  type WorkspacePathPayload as WorkspacePath,
} from "../../types.ts";
import { useSessions } from "../../use-sessions.ts";
import { existingContextHref, importSessionsHref } from "../../utils.ts";

const styles = stylex.create({
  fieldStack: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.5rem",
  },
  status: {
    color: "#52606d",
    fontSize: "0.92rem",
    overflowWrap: "anywhere",
  },
});

function sessionHref(sessionId: string): string {
  return sessionId === "default" ? "/default" : `/ses/${sessionId}`;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message || fallback;
  try {
    return ErrorPayload.assert(value).error || fallback;
  } catch {
    return fallback;
  }
}

export function NewSessionPage() {
  const navigate = useNavigate();
  const { sessions } = useSessions();
  const [pathInput, setPathInput] = useState("");
  const [pathStatus, setPathStatus] = useState<WorkspacePath | null>(null);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [suggestingTemp, setSuggestingTemp] = useState(false);
  const [error, setError] = useState("");

  const trimmedPath = pathInput.trim();
  const canCreateSession =
    pathStatus?.exists === true && pathStatus.isDirectory && pathStatus.writable;
  const canCreateFolder = pathStatus?.exists === false && pathStatus.creatable;
  // The server resolves "~" and relative paths from $HOME and echoes the
  // absolute result back as `path`; show it so the user knows what will be used.
  const resolvedPath = pathStatus?.path ?? null;
  const existingHref = resolvedPath ? existingContextHref(sessions, resolvedPath) : null;

  useEffect(() => {
    document.title = "Create Session | Say To Me";
  }, []);

  useEffect(() => {
    setPathStatus(null);
    setError("");
    if (!trimmedPath) {
      setChecking(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      fetch(`/api/workspace-path?path=${encodeURIComponent(trimmedPath)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await safeResponseJson(response, WorkspacePathPayload);
          if (!response.ok) throw new Error(errorMessage(payload, "Unable to check path."));
          setPathStatus(payload);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setError(errorMessage(err, "Unable to check path."));
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false);
        });
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmedPath]);

  async function createFolder() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/workspace-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmedPath }),
      });
      const payload = await safeResponseJson(response, WorkspacePathPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to create folder."));
      setPathStatus(payload);
    } catch (err) {
      setError(errorMessage(err, "Unable to create folder."));
    } finally {
      setWorking(false);
    }
  }

  async function useTempFolder() {
    setSuggestingTemp(true);
    setError("");
    try {
      const response = await fetch("/api/workspace-path/suggest-temp");
      const payload = await safeResponseJson(response, TempWorkspacePathPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to suggest a temp folder."));
      setPathInput(payload.path);
    } catch (err) {
      setError(errorMessage(err, "Unable to suggest a temp folder."));
    } finally {
      setSuggestingTemp(false);
    }
  }

  async function createSession() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/opencode-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmedPath }),
      });
      const payload = await safeResponseJson(response, CreateOpenCodeSessionPayload);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Unable to create OpenCode session."));
      }
      await navigate(sessionHref(payload.session.id));
    } catch (err) {
      setError(errorMessage(err, "Unable to create OpenCode session."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageShell
      eyebrow="OpenCode"
      backTo="/"
      backLabel="Back to sessions"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title)}>Create session</h1>
          <p {...stylex.props(textStyles.lede)}>
            Enter an absolute or relative folder path. Relative paths resolve from your home folder
            (e.g. <code>Downloads/project1</code>). Create an OpenCode session there, or jump to
            existing sessions for that path.
          </p>
        </>
      }
    >
      <section {...stylex.props(card.base, composer.root)}>
        <div {...stylex.props(styles.fieldStack)}>
          <input
            {...stylex.props(controls.textInput)}
            autoFocus
            type="text"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder="Downloads/project1 or /tmp/say-to-me-work/my-task"
          />
          {resolvedPath ? (
            <span {...stylex.props(styles.status)}>Resolves to: {resolvedPath}</span>
          ) : null}
          {trimmedPath ? (
            <span {...stylex.props(styles.status)}>
              {checking
                ? "Checking path..."
                : pathStatus?.exists
                  ? pathStatus.isDirectory
                    ? pathStatus.writable
                      ? "Folder exists and is writable."
                      : "Folder exists but is not writable."
                    : "Path exists but is not a folder."
                  : pathStatus
                    ? pathStatus.creatable
                      ? `Folder does not exist, but parent is writable: ${pathStatus.parentPath}`
                      : `Folder cannot be created; parent is not writable: ${pathStatus.parentPath ?? pathStatus.path}`
                    : "Enter an absolute or relative path."}
            </span>
          ) : null}
        </div>

        <div {...stylex.props(composer.actions)}>
          {!trimmedPath ? (
            <button
              {...stylex.props(controls.button)}
              disabled={suggestingTemp}
              onClick={useTempFolder}
            >
              Suggest temp folder
            </button>
          ) : null}
          {canCreateSession ? (
            <button {...stylex.props(controls.button)} disabled={working} onClick={createSession}>
              Create session
            </button>
          ) : null}
          {canCreateFolder ? (
            <button {...stylex.props(controls.button)} disabled={working} onClick={createFolder}>
              Create folder
            </button>
          ) : null}
          {existingHref ? (
            <button
              {...stylex.props(controls.button, controls.secondary)}
              type="button"
              onClick={() => void navigate(existingHref)}
            >
              List existing sessions
            </button>
          ) : null}
          <button
            {...stylex.props(controls.button, controls.secondary)}
            type="button"
            onClick={() => {
              const path = resolvedPath ?? trimmedPath;
              void navigate(path ? importSessionsHref(path) : "/import");
            }}
          >
            Import sessions
          </button>
          <button
            {...stylex.props(controls.button, controls.secondary)}
            type="button"
            onClick={() => void navigate("/")}
          >
            Cancel
          </button>
        </div>
      </section>

      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}
    </PageShell>
  );
}
