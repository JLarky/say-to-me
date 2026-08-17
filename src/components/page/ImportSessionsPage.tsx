import { safeResponseJson } from "@say-to-me/runtime-validation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { PageShell } from "../PageShell.tsx";
import { card, misc, text as textStyles } from "../../styles/chrome.stylex.ts";
import { composer, controls } from "../../styles/controls.stylex.ts";
import { queue, thread } from "../../styles/feed.stylex.ts";
import { type } from "arktype";
import { ErrorPayload, WorkspacePathPayload } from "../../types.ts";
import { base64UrlDecode, importSessionsHref } from "../../utils.ts";

type ImportProvider = "claude" | "codex" | "cursor" | "grok";

const providerLabels = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
} satisfies Record<ImportProvider, string>;

const DiscoverableSessionSchema = type({
  sessionId: "string",
  chatId: "string",
  title: "string | null",
  modifiedAt: "number | null",
  imported: "boolean",
});

type DiscoverableSession = typeof DiscoverableSessionSchema.infer;

const DiscoverSessionsPayload = type({
  "sessions?": DiscoverableSessionSchema.array(),
});

const styles = stylex.create({
  fieldStack: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.5rem",
  },
  providerRow: {
    display: "flex",
    rowGap: "1rem",
    columnGap: "1rem",
    flexWrap: "wrap",
  },
  providerLabel: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
    fontSize: "0.95rem",
  },
  status: {
    color: "#52606d",
    fontSize: "0.92rem",
    overflowWrap: "anywhere",
  },
  sessionRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    rowGap: "1rem",
    columnGap: "1rem",
    flexWrap: "wrap",
  },
  sessionMeta: {
    color: "#52606d",
    fontSize: "0.88rem",
    overflowWrap: "anywhere",
  },
});

function sessionHref(sessionId: string): string {
  return `/ses/${sessionId}`;
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

function formatModifiedAt(value: number | null): string {
  if (value == null) return "Unknown time";
  return new Date(value).toLocaleString();
}

function parseProvider(value: string | null): ImportProvider {
  if (value === "codex" || value === "cursor" || value === "grok") return value;
  return "claude";
}

export function ImportSessionsPage() {
  const navigate = useNavigate();
  const { pathKey } = useParams();
  const [searchParams] = useSearchParams();
  const decodedPathKey = pathKey ? base64UrlDecode(pathKey) : null;
  const [pathInput, setPathInput] = useState(() => decodedPathKey ?? "");
  const [provider, setProvider] = useState<ImportProvider>(
    parseProvider(searchParams.get("provider")),
  );
  const [pathStatus, setPathStatus] = useState<WorkspacePathPayload | null>(null);
  const [sessions, setSessions] = useState<DiscoverableSession[]>([]);
  const [checkingPath, setCheckingPath] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [workingSessionId, setWorkingSessionId] = useState<string | null>(null);
  const [error, setError] = useState(
    pathKey && !decodedPathKey ? "Invalid import path in URL." : "",
  );

  useEffect(() => {
    if (!pathKey) return;
    const decoded = base64UrlDecode(pathKey);
    if (!decoded) {
      setError("Invalid import path in URL.");
      return;
    }
    setPathInput(decoded);
    setError("");
  }, [pathKey]);

  const trimmedPath = pathInput.trim();
  const resolvedPath = pathStatus?.path ?? null;
  const canDiscover = pathStatus?.exists === true && pathStatus.isDirectory && pathStatus.writable;

  useEffect(() => {
    document.title = "Import Sessions | Say To Me";
  }, []);

  useEffect(() => {
    setPathStatus(null);
    setSessions([]);
    setError("");
    if (!trimmedPath) {
      setCheckingPath(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setCheckingPath(true);
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
          if (!controller.signal.aborted) setCheckingPath(false);
        });
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmedPath]);

  useEffect(() => {
    if (!canDiscover || !trimmedPath) {
      setSessions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoadingSessions(true);
      setError("");
      const params = new URLSearchParams({ provider, path: trimmedPath });
      fetch(`/api/external-cli/discover?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await safeResponseJson(response, DiscoverSessionsPayload);
          if (!response.ok) throw new Error(errorMessage(payload, "Unable to list sessions."));
          setSessions(payload.sessions ?? []);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") {
            setSessions([]);
            setError(errorMessage(err, "Unable to list sessions."));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingSessions(false);
        });
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [canDiscover, provider, trimmedPath]);

  useEffect(() => {
    if (!trimmedPath) {
      if (!pathKey) return;
      const params = provider !== "claude" ? `?provider=${provider}` : "";
      void navigate(`/import${params}`, { replace: true });
      return;
    }
    if (!resolvedPath) return;
    const nextHref = importSessionsHref(resolvedPath, { provider });
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (currentHref === nextHref) return;
    void navigate(nextHref, { replace: true });
  }, [navigate, pathKey, provider, resolvedPath, trimmedPath]);

  const { availableSessions, importedSessions } = useMemo(() => {
    const available: DiscoverableSession[] = [];
    const imported: DiscoverableSession[] = [];
    for (const session of sessions) {
      if (session.imported) imported.push(session);
      else available.push(session);
    }
    return { availableSessions: available, importedSessions: imported };
  }, [sessions]);

  const statusLine = useMemo(() => {
    if (!trimmedPath) return "Enter a folder path to scan for existing chats.";
    if (checkingPath) return "Checking path...";
    if (pathStatus?.exists) {
      if (!pathStatus.isDirectory) return "Path exists but is not a folder.";
      if (!pathStatus.writable) return "Folder exists but is not writable.";
      if (loadingSessions) return `Scanning ${providerLabels[provider]} sessions...`;
      if (!sessions.length) return `No ${providerLabels[provider]} sessions found in this folder.`;
      if (!availableSessions.length && importedSessions.length) {
        return `${importedSessions.length} session${importedSessions.length === 1 ? "" : "s"} already imported.`;
      }
      if (availableSessions.length && importedSessions.length) {
        return `${availableSessions.length} to import, ${importedSessions.length} already imported.`;
      }
      return `${availableSessions.length} session${availableSessions.length === 1 ? "" : "s"} to import.`;
    }
    if (pathStatus) return "Folder does not exist.";
    return "Enter an absolute or relative path.";
  }, [
    availableSessions.length,
    checkingPath,
    importedSessions.length,
    loadingSessions,
    pathStatus,
    provider,
    sessions.length,
    trimmedPath,
  ]);

  async function importSession(session: DiscoverableSession) {
    setWorkingSessionId(session.sessionId);
    setError("");
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(session.sessionId)}/import`,
        {
          method: "POST",
        },
      );
      const payload = await safeResponseJson(response, ErrorPayload);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Unable to import session."));
      }
      await navigate(sessionHref(session.sessionId));
    } catch (err) {
      setError(errorMessage(err, "Unable to import session."));
    } finally {
      setWorkingSessionId(null);
    }
  }

  function renderSessionList(
    listedSessions: DiscoverableSession[],
    action: "import" | "open",
  ): ReactNode {
    return (
      <ol {...stylex.props(thread.list)}>
        {listedSessions.map((session) => (
          <li key={session.sessionId} {...stylex.props(thread.item, styles.sessionRow)}>
            <div>
              <strong>{session.title || session.chatId}</strong>
              <div {...stylex.props(styles.sessionMeta)}>
                {session.chatId} · {formatModifiedAt(session.modifiedAt)}
              </div>
            </div>
            <button
              type="button"
              {...stylex.props(controls.button, controls.secondary)}
              disabled={action === "import" && workingSessionId === session.sessionId}
              onClick={() =>
                void (action === "open"
                  ? navigate(sessionHref(session.sessionId))
                  : importSession(session))
              }
            >
              {action === "open"
                ? "Open"
                : workingSessionId === session.sessionId
                  ? "Importing..."
                  : "Import"}
            </button>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <PageShell
      eyebrow="External CLI"
      backTo="/new"
      backLabel="Back to create session"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title)}>Import sessions</h1>
          <p {...stylex.props(textStyles.lede)}>
            Pick a provider and folder, then import existing Claude, Codex, Cursor, or Grok chats
            from local transcript files — similar to each tool&apos;s resume picker.
          </p>
        </>
      }
    >
      <section {...stylex.props(card.base, composer.root)}>
        <div {...stylex.props(styles.fieldStack)}>
          <fieldset {...stylex.props(styles.providerRow)}>
            <legend>Provider</legend>
            <label {...stylex.props(styles.providerLabel)}>
              <input
                type="radio"
                name="import-provider"
                checked={provider === "claude"}
                onChange={() => setProvider("claude")}
              />
              Claude
            </label>
            <label {...stylex.props(styles.providerLabel)}>
              <input
                type="radio"
                name="import-provider"
                checked={provider === "codex"}
                onChange={() => setProvider("codex")}
              />
              Codex
            </label>
            <label {...stylex.props(styles.providerLabel)}>
              <input
                type="radio"
                name="import-provider"
                checked={provider === "cursor"}
                onChange={() => setProvider("cursor")}
              />
              Cursor
            </label>
            <label {...stylex.props(styles.providerLabel)}>
              <input
                type="radio"
                name="import-provider"
                checked={provider === "grok"}
                onChange={() => setProvider("grok")}
              />
              Grok
            </label>
          </fieldset>
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
          <span {...stylex.props(styles.status)}>{statusLine}</span>
        </div>
      </section>

      {availableSessions.length ? (
        <section {...stylex.props(card.base, queue.panel)}>
          <div {...stylex.props(queue.heading)}>
            <h2 {...stylex.props(queue.headingH2)}>Sessions to import</h2>
            <span {...stylex.props(queue.headingCount)}>{availableSessions.length}</span>
          </div>
          {renderSessionList(availableSessions, "import")}
        </section>
      ) : null}

      {importedSessions.length ? (
        <section {...stylex.props(card.base, queue.panel)}>
          <div {...stylex.props(queue.heading)}>
            <h2 {...stylex.props(queue.headingH2)}>Already imported</h2>
            <span {...stylex.props(queue.headingCount)}>{importedSessions.length}</span>
          </div>
          {renderSessionList(importedSessions, "open")}
        </section>
      ) : null}

      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}
    </PageShell>
  );
}
