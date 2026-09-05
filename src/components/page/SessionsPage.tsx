import { safeResponseJson } from "@say-to-me/runtime-validation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { PageShell } from "../PageShell.tsx";
import { OpenSessionByIdForm } from "../OpenSessionByIdForm.tsx";
import { card, misc, text as textStyles } from "../../styles/chrome.stylex.ts";
import { composer, controls } from "../../styles/controls.stylex.ts";
import { queue, thread } from "../../styles/feed.stylex.ts";
import { type } from "arktype";
import { codexReasoningEfforts, type CodexReasoningEffort } from "../../codex-reasoning-effort.ts";
import {
  CreateOpenCodeSessionPayload,
  CliSessionPayload,
  ErrorPayload,
  TempWorkspacePathPayload,
  WorkspacePathPayload,
} from "../../types.ts";
import { base64UrlDecode, projectFilterHref, sessionsHref } from "../../utils.ts";

const mobile = "@media (max-width: 680px)" as const;
/** Typing debounce for path/context lookups; skip under Vitest so page suites stay fast. */
const folderLookupDebounceMs = import.meta.env.VITEST ? 0 : 200;

type CliProvider = "claude" | "codex" | "cursor" | "grok";
type CreateProvider = "opencode" | CliProvider;

const providerLabels: Record<CreateProvider, string> = {
  opencode: "OpenCode",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
};

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

const ProviderModelSchema = type({
  providerID: "string",
  id: "string",
  name: "string",
});

const ProviderModelsPayload = type({
  models: ProviderModelSchema.array(),
});

const OpenCodeProjectContext = type({
  id: "string",
  sessionCount: "number",
});

const SessionContextPayload = type({
  path: "string",
  pathStatus: {
    exists: "boolean",
    isDirectory: "boolean",
    writable: "boolean",
    creatable: "boolean",
    parentPath: "string | null",
  },
  providers: {
    claude: { importableCount: "number", inAppCount: "number" },
    codex: { importableCount: "number", inAppCount: "number" },
    cursor: { importableCount: "number", inAppCount: "number" },
    grok: { importableCount: "number", inAppCount: "number" },
  },
  sessionsHere: type({
    id: "string",
    provider: "string",
    title: "string | null",
  }).array(),
  opencodeProject: OpenCodeProjectContext.or("null"),
});

type SessionContext = typeof SessionContextPayload.infer;

const styles = stylex.create({
  fieldStack: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.75rem",
  },
  sectionBody: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.75rem",
  },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(0, 1fr)",
      [mobile]: "minmax(0, 1fr)",
    },
    rowGap: "1.25rem",
    columnGap: "1.25rem",
    alignItems: "start",
    marginTop: "0.25rem",
  },
  column: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.75rem",
    paddingTop: "0.75rem",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "rgba(23, 32, 42, 0.12)",
  },
  sectionTitle: {
    fontSize: "0.78rem",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#52606d",
    margin: 0,
    marginBottom: "0.25rem",
  },
  status: {
    color: "#52606d",
    fontSize: "0.92rem",
    overflowWrap: "anywhere",
  },
  providerRow: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.35rem",
  },
  providerSummary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    flexWrap: "wrap",
  },
  providerCounts: {
    color: "#52606d",
    fontSize: "0.88rem",
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
  inlineList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    rowGap: "0.5rem",
  },
  rowHighlight: {
    borderColor: "rgba(23, 100, 200, 0.7)",
    backgroundColor: "rgba(210, 228, 255, 0.55)",
    boxShadow: "0 0 0 2px rgba(23, 100, 200, 0.35)",
    transition: "border-color 120ms ease, background-color 120ms ease",
  },
  secondaryLink: {
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
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

function formatModifiedAt(value: number | null): string {
  if (value == null) return "Unknown time";
  return new Date(value).toLocaleString();
}

function parseCreateProvider(value: string | null): CreateProvider {
  if (value === "claude" || value === "codex" || value === "cursor" || value === "grok") {
    return value;
  }
  return "opencode";
}

function parseExpandProvider(value: string | null): CliProvider | null {
  if (value === "claude" || value === "codex" || value === "cursor" || value === "grok") {
    return value;
  }
  return null;
}

export function SessionsPage() {
  const navigate = useNavigate();
  const { pathKey } = useParams();
  const [searchParams] = useSearchParams();
  const decodedPathKey = pathKey ? base64UrlDecode(pathKey) : null;
  const [pathInput, setPathInput] = useState(() => decodedPathKey ?? "");
  const [createProvider, setCreateProvider] = useState<CreateProvider>(
    parseCreateProvider(searchParams.get("provider")),
  );
  const [expandedProvider, setExpandedProvider] = useState<CliProvider | null>(
    parseExpandProvider(searchParams.get("provider")),
  );
  const [pathStatus, setPathStatus] = useState<typeof WorkspacePathPayload.infer | null>(null);
  const [context, setContext] = useState<SessionContext | null>(null);
  const [models, setModels] = useState<(typeof ProviderModelSchema.infer)[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<CodexReasoningEffort | "">(
    "",
  );
  const [discoveredSessions, setDiscoveredSessions] = useState<DiscoverableSession[]>([]);
  const [checkingPath, setCheckingPath] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingDiscover, setLoadingDiscover] = useState(false);
  const [working, setWorking] = useState(false);
  const [suggestingTemp, setSuggestingTemp] = useState(false);
  const [workingSessionId, setWorkingSessionId] = useState<string | null>(null);
  const [highlightedSessionIds, setHighlightedSessionIds] = useState<string[]>([]);
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [error, setError] = useState(
    pathKey && !decodedPathKey ? "Invalid folder path in URL." : "",
  );

  useEffect(() => {
    if (!pathKey) return;
    const decoded = base64UrlDecode(pathKey);
    if (!decoded) {
      setError("Invalid folder path in URL.");
      return;
    }
    setPathInput(decoded);
    setError("");
  }, [pathKey]);

  const trimmedPath = pathInput.trim();
  const resolvedPath = pathStatus?.path ?? context?.path ?? null;
  const canUseFolder = pathStatus?.exists === true && pathStatus.isDirectory && pathStatus.writable;
  const canCreateFolder = pathStatus?.exists === false && pathStatus.creatable;
  const isCliProvider = createProvider !== "opencode";

  useEffect(() => {
    document.title = "Sessions | Say To Me";
  }, []);

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const markImportedHighlight = useCallback((sessionId: string) => {
    setHighlightedSessionIds((current) =>
      current.includes(sessionId) ? current : [...current, sessionId],
    );
    const existing = highlightTimersRef.current.get(sessionId);
    if (existing) clearTimeout(existing);
    highlightTimersRef.current.set(
      sessionId,
      setTimeout(() => {
        highlightTimersRef.current.delete(sessionId);
        setHighlightedSessionIds((current) => current.filter((id) => id !== sessionId));
      }, 4000),
    );
  }, []);

  const refreshContext = useCallback(async () => {
    if (!trimmedPath) return;
    try {
      const response = await fetch(`/api/sessions/context?path=${encodeURIComponent(trimmedPath)}`);
      const payload = await safeResponseJson(response, SessionContextPayload);
      if (!response.ok) return;
      setContext(payload);
    } catch {
      // Keep the current context if a background refresh fails.
    }
  }, [trimmedPath]);

  useEffect(() => {
    setPathStatus(null);
    setContext(null);
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
    }, folderLookupDebounceMs);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmedPath]);

  useEffect(() => {
    if (!canUseFolder || !trimmedPath) {
      setContext(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoadingContext(true);
      fetch(`/api/sessions/context?path=${encodeURIComponent(trimmedPath)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await safeResponseJson(response, SessionContextPayload);
          if (!response.ok)
            throw new Error(errorMessage(payload, "Unable to load folder context."));
          setContext(payload);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") {
            setContext(null);
            setError(errorMessage(err, "Unable to load folder context."));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingContext(false);
        });
    }, folderLookupDebounceMs);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [canUseFolder, trimmedPath]);

  useEffect(() => {
    if (!isCliProvider) {
      setModels([]);
      setSelectedModelId("");
      setSelectedReasoningEffort("");
      return;
    }

    const controller = new AbortController();
    setLoadingModels(true);
    fetch(`/api/providers/${createProvider}/models`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await safeResponseJson(response, ProviderModelsPayload);
        if (!response.ok) throw new Error(errorMessage(payload, "Unable to load models."));
        const listed = payload.models;
        setModels(listed);
        setSelectedModelId((current) => current || listed[0]?.id || "");
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setModels([]);
          setSelectedModelId("");
          setError(errorMessage(err, "Unable to load models."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingModels(false);
      });

    return () => controller.abort();
  }, [createProvider, isCliProvider]);

  useEffect(() => {
    if (!expandedProvider || !canUseFolder || !trimmedPath) {
      setDiscoveredSessions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoadingDiscover(true);
      const params = new URLSearchParams({ provider: expandedProvider, path: trimmedPath });
      fetch(`/api/external-cli/discover?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await safeResponseJson(response, DiscoverSessionsPayload);
          if (!response.ok) throw new Error(errorMessage(payload, "Unable to list sessions."));
          setDiscoveredSessions(payload.sessions ?? []);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") {
            setDiscoveredSessions([]);
            setError(errorMessage(err, "Unable to list sessions."));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingDiscover(false);
        });
    }, 100);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [canUseFolder, expandedProvider, trimmedPath]);

  useEffect(() => {
    if (!trimmedPath) {
      if (!pathKey) return;
      void navigate("/sessions", { replace: true });
      return;
    }
    if (!resolvedPath) return;
    const nextHref = sessionsHref(resolvedPath);
    const currentHref = window.location.pathname;
    if (currentHref === nextHref) return;
    void navigate(nextHref, { replace: true });
  }, [navigate, pathKey, resolvedPath, trimmedPath]);

  const { availableSessions, importedSessions } = useMemo(() => {
    const available: DiscoverableSession[] = [];
    const imported: DiscoverableSession[] = [];
    for (const session of discoveredSessions) {
      if (session.imported) imported.push(session);
      else available.push(session);
    }
    return { availableSessions: available, importedSessions: imported };
  }, [discoveredSessions]);

  const pathStatusLine = useMemo(() => {
    if (!trimmedPath) return "Enter a folder path to create or import sessions.";
    if (checkingPath) return "Checking path...";
    if (pathStatus?.exists) {
      if (!pathStatus.isDirectory) return "Path exists but is not a folder.";
      if (!pathStatus.writable) return "Folder exists but is not writable.";
      if (loadingContext) return "Loading folder context...";
      return "Folder exists and is writable.";
    }
    if (pathStatus) {
      return pathStatus.creatable
        ? `Folder does not exist, but parent is writable: ${pathStatus.parentPath}`
        : `Folder cannot be created; parent is not writable: ${pathStatus.parentPath ?? pathStatus.path}`;
    }
    return "Enter an absolute or relative path.";
  }, [checkingPath, loadingContext, pathStatus, trimmedPath]);

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
    if (!canUseFolder) return;
    setWorking(true);
    setError("");
    try {
      if (createProvider === "opencode") {
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
        return;
      }
      if (!selectedModelId) throw new Error("Pick a model first.");
      const baseBody = { provider: createProvider, path: trimmedPath, modelID: selectedModelId };
      const requestBody =
        createProvider === "codex" && selectedReasoningEffort
          ? { ...baseBody, reasoningEffort: selectedReasoningEffort }
          : baseBody;
      const response = await fetch("/api/cli-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = await safeResponseJson(response, CliSessionPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to create CLI session."));
      await navigate(sessionHref(payload.session.id));
    } catch (err) {
      setError(errorMessage(err, "Unable to create session."));
    } finally {
      setWorking(false);
    }
  }

  async function importSession(session: DiscoverableSession) {
    setWorkingSessionId(session.sessionId);
    setError("");
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(session.sessionId)}/import`,
        { method: "POST" },
      );
      const payload = await safeResponseJson(response, ErrorPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to import session."));
      setDiscoveredSessions((current) =>
        current.map((entry) =>
          entry.sessionId === session.sessionId ? { ...entry, imported: true } : entry,
        ),
      );
      markImportedHighlight(session.sessionId);
      void refreshContext();
    } catch (err) {
      setError(errorMessage(err, "Unable to import session."));
    } finally {
      setWorkingSessionId(null);
    }
  }

  function renderDiscoverList(
    listedSessions: DiscoverableSession[],
    action: "import" | "open",
  ): ReactNode {
    if (!listedSessions.length) {
      return <span {...stylex.props(styles.status)}>No sessions.</span>;
    }
    return (
      <ol {...stylex.props(thread.list)}>
        {listedSessions.map((session) => (
          <li
            key={session.sessionId}
            {...stylex.props(
              thread.item,
              styles.sessionRow,
              highlightedSessionIds.includes(session.sessionId) && styles.rowHighlight,
            )}
          >
            <div>
              <strong>{session.title || session.chatId}</strong>
              <div {...stylex.props(styles.sessionMeta)}>
                {session.chatId} · {formatModifiedAt(session.modifiedAt)}
              </div>
            </div>
            {action === "open" ? (
              <Link
                to={sessionHref(session.sessionId)}
                {...stylex.props(controls.button, controls.secondary, styles.secondaryLink)}
              >
                Open
              </Link>
            ) : (
              <button
                type="button"
                {...stylex.props(controls.button, controls.secondary)}
                disabled={workingSessionId === session.sessionId}
                onClick={() => void importSession(session)}
              >
                {workingSessionId === session.sessionId ? "Importing..." : "Import"}
              </button>
            )}
          </li>
        ))}
      </ol>
    );
  }

  const cliProviders: CliProvider[] = ["claude", "codex", "cursor", "grok"];

  return (
    <PageShell
      eyebrow="Workspace"
      backTo="/"
      backLabel="Back to sessions"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title)}>Sessions</h1>
          <p {...stylex.props(textStyles.lede)}>
            Open an existing session by ID, or pick a folder to create or import chats.
          </p>
        </>
      }
    >
      <section {...stylex.props(card.base, composer.root)}>
        <h2 {...stylex.props(styles.sectionTitle)}>Session ID</h2>
        <OpenSessionByIdForm onError={setError} />
      </section>

      <section {...stylex.props(card.base, composer.root)}>
        <h2 {...stylex.props(styles.sectionTitle)}>Folder</h2>
        <div {...stylex.props(styles.sectionBody)}>
          <div {...stylex.props(styles.fieldStack)}>
            <input
              {...stylex.props(controls.textInput)}
              type="text"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder="Downloads/project1 or /tmp/say-to-me-work/my-task"
            />
            {resolvedPath ? (
              <span {...stylex.props(styles.status)}>Resolves to: {resolvedPath}</span>
            ) : null}
            <span {...stylex.props(styles.status)}>{pathStatusLine}</span>
          </div>
          {!trimmedPath || canCreateFolder ? (
            <div {...stylex.props(composer.actions)}>
              {!trimmedPath ? (
                <button
                  {...stylex.props(controls.button)}
                  disabled={suggestingTemp}
                  onClick={() => void useTempFolder()}
                >
                  Suggest temp folder
                </button>
              ) : null}
              {canCreateFolder ? (
                <button
                  {...stylex.props(controls.button)}
                  disabled={working}
                  onClick={() => void createFolder()}
                >
                  Create folder
                </button>
              ) : null}
            </div>
          ) : null}

          {canUseFolder ? (
            <div {...stylex.props(styles.columns)}>
              <section {...stylex.props(styles.column)}>
                <h3 {...stylex.props(styles.sectionTitle)}>Start new</h3>
                <label {...stylex.props(styles.fieldStack)}>
                  <span>Provider</span>
                  <select
                    {...stylex.props(controls.select)}
                    value={createProvider}
                    onChange={(event) => setCreateProvider(parseCreateProvider(event.target.value))}
                  >
                    {(Object.keys(providerLabels) as CreateProvider[]).map((provider) => (
                      <option key={provider} value={provider}>
                        {providerLabels[provider]}
                      </option>
                    ))}
                  </select>
                </label>
                {isCliProvider ? (
                  <label {...stylex.props(styles.fieldStack)}>
                    <span>Model</span>
                    <select
                      {...stylex.props(controls.select)}
                      value={selectedModelId}
                      disabled={loadingModels || !models.length}
                      onChange={(event) => setSelectedModelId(event.target.value)}
                    >
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {createProvider === "codex" ? (
                  <label {...stylex.props(styles.fieldStack)}>
                    <span>Reasoning effort</span>
                    <select
                      {...stylex.props(controls.select)}
                      aria-label="Codex reasoning effort"
                      value={selectedReasoningEffort}
                      onChange={(event) =>
                        setSelectedReasoningEffort(event.target.value as CodexReasoningEffort | "")
                      }
                    >
                      <option value="">Provider default</option>
                      {codexReasoningEfforts.map((effort) => (
                        <option key={effort} value={effort}>
                          {effort}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  {...stylex.props(controls.button)}
                  disabled={working || (isCliProvider && (!selectedModelId || loadingModels))}
                  onClick={() => void createSession()}
                >
                  Create session
                </button>
              </section>

              <section {...stylex.props(styles.column)}>
                <h3 {...stylex.props(styles.sectionTitle)}>Context</h3>
                {context?.opencodeProject ? (
                  <div {...stylex.props(styles.providerSummary)}>
                    <span>
                      OpenCode project · {context.opencodeProject.sessionCount} session
                      {context.opencodeProject.sessionCount === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      {...stylex.props(controls.button, controls.secondary)}
                      onClick={() => void navigate(projectFilterHref(context.opencodeProject!.id))}
                    >
                      Open project
                    </button>
                  </div>
                ) : null}
                {context?.sessionsHere.length ? (
                  <div {...stylex.props(styles.fieldStack)}>
                    <span {...stylex.props(styles.status)}>
                      Already in Say To Me ({context.sessionsHere.length})
                    </span>
                    <ul {...stylex.props(styles.inlineList)}>
                      {context.sessionsHere.map((session) => (
                        <li
                          key={session.id}
                          {...stylex.props(
                            styles.sessionRow,
                            highlightedSessionIds.includes(session.id) && styles.rowHighlight,
                          )}
                        >
                          <div>
                            <strong>{session.title || session.id}</strong>
                            <div {...stylex.props(styles.sessionMeta)}>{session.provider}</div>
                          </div>
                          <Link
                            to={sessionHref(session.id)}
                            {...stylex.props(
                              controls.button,
                              controls.secondary,
                              styles.secondaryLink,
                            )}
                          >
                            Open
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div {...stylex.props(styles.providerRow)}>
                  <span {...stylex.props(styles.status)}>Importable on disk</span>
                  {cliProviders.map((provider) => {
                    const stats = context?.providers[provider];
                    const count = stats?.importableCount ?? 0;
                    const inApp = stats?.inAppCount ?? 0;
                    const expanded = expandedProvider === provider;
                    return (
                      <div key={provider} {...stylex.props(styles.fieldStack)}>
                        <div {...stylex.props(styles.providerSummary)}>
                          <span>
                            {providerLabels[provider]}
                            <span {...stylex.props(styles.providerCounts)}>
                              {" "}
                              · {count} to import
                              {inApp ? ` · ${inApp} in app` : ""}
                            </span>
                          </span>
                          <button
                            type="button"
                            {...stylex.props(controls.button, controls.secondary)}
                            disabled={!count && !inApp}
                            onClick={() => setExpandedProvider(expanded ? null : provider)}
                          >
                            {expanded ? "Hide" : "Show"}
                          </button>
                        </div>
                        {expanded ? (
                          loadingDiscover ? (
                            <span {...stylex.props(styles.status)}>Scanning...</span>
                          ) : (
                            <>
                              {availableSessions.length ? (
                                <div {...stylex.props(queue.panel)}>
                                  <div {...stylex.props(queue.heading)}>
                                    <h3 {...stylex.props(queue.headingH2)}>To import</h3>
                                    <span {...stylex.props(queue.headingCount)}>
                                      {availableSessions.length}
                                    </span>
                                  </div>
                                  {renderDiscoverList(availableSessions, "import")}
                                </div>
                              ) : null}
                              {importedSessions.length ? (
                                <div {...stylex.props(queue.panel)}>
                                  <div {...stylex.props(queue.heading)}>
                                    <h3 {...stylex.props(queue.headingH2)}>Already imported</h3>
                                    <span {...stylex.props(queue.headingCount)}>
                                      {importedSessions.length}
                                    </span>
                                  </div>
                                  {renderDiscoverList(importedSessions, "open")}
                                </div>
                              ) : null}
                              {!availableSessions.length && !importedSessions.length ? (
                                <span {...stylex.props(styles.status)}>No sessions found.</span>
                              ) : null}
                            </>
                          )
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>

      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}
    </PageShell>
  );
}
