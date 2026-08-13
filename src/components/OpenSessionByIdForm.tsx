import { safeResponseJson } from "@say-to-me/runtime-validation";
import { ExternalCliSessionInfo } from "../types.ts";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import * as stylex from "@stylexjs/stylex";

import {
  CLAUDE_SESSION_ID_RE,
  CODEX_SESSION_ID_RE,
  CURSOR_SESSION_ID_RE,
  GROK_SESSION_ID_RE,
  detectPrefixedSessionBackend,
  isBareSessionUuid,
} from "../session-id-patterns.ts";
import { importSessionById, sessionHrefForId } from "../session-import-api.ts";
import { composer, controls } from "../styles/controls.stylex.ts";

type Backend =
  | "opencode"
  | "claude"
  | "cursor"
  | "codex"
  | "grok"
  | "t3"
  | "paseo"
  | "paseo-chat"
  | "voice"
  | "none";
type ExternalCliProvider = "claude" | "cursor" | "codex" | "grok";

const PROVIDER_PREFIX: Record<ExternalCliProvider, string> = {
  claude: "cc_",
  cursor: "cur_",
  codex: "cx_",
  grok: "gr_",
};

const pickerStyles = stylex.create({
  row: {
    display: "flex",
    rowGap: "1rem",
    columnGap: "1rem",
    flexWrap: "wrap",
  },
  label: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
    fontSize: "0.95rem",
  },
});

const formStyles = stylex.create({
  sectionBody: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.75rem",
  },
  fieldStack: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.75rem",
  },
  status: {
    color: "#52606d",
    fontSize: "0.92rem",
    overflowWrap: "anywhere",
  },
});

const backendHint: Record<Backend, string> = {
  opencode: "OpenCode session — messages go to OpenCode.",
  claude: "Claude session — needs a working directory.",
  cursor: "Cursor session — needs a working directory.",
  codex: "Codex session — needs a working directory.",
  grok: "Grok session — needs a working directory.",
  t3: "T3 Code thread — import verifies the thread on a configured T3 instance.",
  paseo: "Paseo session — import verifies the UUID on a configured Paseo instance.",
  "paseo-chat": "Paseo chat — import verifies the room on a configured Paseo instance.",
  voice: "Voice-only session — messages stay local and play in the app.",
  none: "Not connected to an agent — messages stay local.",
};

function toExternalCliSessionId(input: string, provider: ExternalCliProvider): string {
  if (
    CLAUDE_SESSION_ID_RE.test(input) ||
    CURSOR_SESSION_ID_RE.test(input) ||
    CODEX_SESSION_ID_RE.test(input) ||
    GROK_SESSION_ID_RE.test(input)
  ) {
    return input;
  }
  return `${PROVIDER_PREFIX[provider]}${input.trim()}`;
}

function needsWorkingDirectory(backend: Backend): boolean {
  return backend === "claude" || backend === "cursor" || backend === "codex" || backend === "grok";
}

function shouldResolveExternalCli(input: string): boolean {
  if (isBareSessionUuid(input)) return true;
  const prefixed = detectPrefixedSessionBackend(input);
  return (
    prefixed === "claude" || prefixed === "cursor" || prefixed === "codex" || prefixed === "grok"
  );
}

export function OpenSessionByIdForm({ onError }: { onError: (message: string) => void }) {
  const navigate = useNavigate();
  const [sessionInput, setSessionInput] = useState("");
  const [externalCliCwd, setExternalCliCwd] = useState("");
  const [resolvedCwd, setResolvedCwd] = useState<string | null>(null);
  const [resolvedBareProvider, setResolvedBareProvider] = useState<ExternalCliProvider | null>(
    null,
  );
  const [bareUuidAmbiguous, setBareUuidAmbiguous] = useState(false);
  const [bareUuidUnknown, setBareUuidUnknown] = useState(false);
  const [manualProvider, setManualProvider] = useState<ExternalCliProvider>("cursor");

  const trimmedInput = sessionInput.trim();

  useEffect(() => {
    if (!shouldResolveExternalCli(trimmedInput)) {
      setResolvedBareProvider(null);
      setResolvedCwd(null);
      setBareUuidAmbiguous(false);
      setBareUuidUnknown(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/external-cli/resolve/${encodeURIComponent(trimmedInput)}`);
        const data = await safeResponseJson(res, ExternalCliSessionInfo);
        if (cancelled) return;
        if (data.cwd) {
          setResolvedCwd(data.cwd);
          setExternalCliCwd(data.cwd);
        } else {
          setResolvedCwd(null);
        }
        if (
          data.provider === "claude" ||
          data.provider === "cursor" ||
          data.provider === "codex" ||
          data.provider === "grok"
        ) {
          setResolvedBareProvider(data.provider);
          setBareUuidAmbiguous(false);
          setBareUuidUnknown(false);
          return;
        }
        setResolvedBareProvider(null);
        setBareUuidAmbiguous(data.ambiguous === true);
        setBareUuidUnknown(data.ambiguous !== true);
      } catch {
        if (!cancelled) {
          setResolvedBareProvider(null);
          setResolvedCwd(null);
          setBareUuidAmbiguous(false);
          setBareUuidUnknown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trimmedInput]);

  const externalCliProvider = useMemo((): ExternalCliProvider | null => {
    const prefixed = detectPrefixedSessionBackend(trimmedInput || "default");
    if (prefixed === "claude") return "claude";
    if (prefixed === "cursor") return "cursor";
    if (prefixed === "codex") return "codex";
    if (prefixed === "grok") return "grok";
    if (!isBareSessionUuid(trimmedInput)) return null;
    return resolvedBareProvider ?? (bareUuidAmbiguous || bareUuidUnknown ? manualProvider : null);
  }, [trimmedInput, resolvedBareProvider, bareUuidAmbiguous, bareUuidUnknown, manualProvider]);

  const currentBackend = useMemo((): Backend => {
    const prefixed = detectPrefixedSessionBackend(trimmedInput || "default");
    if (prefixed !== "none") return prefixed;
    return externalCliProvider ?? "none";
  }, [trimmedInput, externalCliProvider]);

  const showProviderPicker =
    isBareSessionUuid(trimmedInput) && (bareUuidAmbiguous || bareUuidUnknown);

  async function openSession(event: React.FormEvent) {
    event.preventDefault();
    const input = trimmedInput || "default";
    const backend = currentBackend;
    if (isBareSessionUuid(input) && !externalCliProvider) {
      onError("Pick Claude, Cursor, Codex, or Grok for this chat UUID.");
      return;
    }
    const nextSessionId =
      backend === "claude" || backend === "cursor" || backend === "codex" || backend === "grok"
        ? toExternalCliSessionId(input, externalCliProvider!)
        : input;
    if (needsWorkingDirectory(backend)) {
      const cwd = externalCliCwd.trim() || resolvedCwd?.trim() || "";
      if (!cwd) {
        onError("External CLI sessions need a working directory.");
        return;
      }
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(nextSessionId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        });
        if (!res.ok) {
          onError("Could not save the working directory for this session.");
          return;
        }
      } catch {
        onError("Could not save the working directory for this session.");
        return;
      }
    }
    if (backend === "opencode" && nextSessionId !== "default") {
      try {
        await importSessionById(nextSessionId);
      } catch {
        onError("Could not find that OpenCode session.");
        return;
      }
    }
    if (backend === "t3") {
      try {
        await importSessionById(nextSessionId);
      } catch {
        onError("Could not find that T3 thread on a configured T3 instance.");
        return;
      }
    }
    if (backend === "paseo" || backend === "paseo-chat") {
      try {
        await importSessionById(nextSessionId);
      } catch {
        onError(
          backend === "paseo-chat"
            ? "Could not find that chat on a configured Paseo instance."
            : "Could not find that session on a configured Paseo instance.",
        );
        return;
      }
    }
    onError("");
    void navigate(sessionHrefForId(nextSessionId));
  }

  return (
    <form {...stylex.props(formStyles.sectionBody)} onSubmit={openSession}>
      <div {...stylex.props(formStyles.fieldStack)}>
        <input
          {...stylex.props(controls.textInput)}
          type="text"
          value={sessionInput}
          onChange={(event) => setSessionInput(event.target.value)}
          placeholder="default, ses_…, cc_/cur_/cx_/gr_/t3_/pa_/vo_…, or a chat UUID"
        />
        {showProviderPicker ? (
          <fieldset {...stylex.props(pickerStyles.row)}>
            <legend>Open bare UUID as</legend>
            <label {...stylex.props(pickerStyles.label)}>
              <input
                type="radio"
                name="external-cli-provider"
                checked={manualProvider === "claude"}
                onChange={() => setManualProvider("claude")}
              />
              Claude
            </label>
            <label {...stylex.props(pickerStyles.label)}>
              <input
                type="radio"
                name="external-cli-provider"
                checked={manualProvider === "cursor"}
                onChange={() => setManualProvider("cursor")}
              />
              Cursor
            </label>
            <label {...stylex.props(pickerStyles.label)}>
              <input
                type="radio"
                name="external-cli-provider"
                checked={manualProvider === "codex"}
                onChange={() => setManualProvider("codex")}
              />
              Codex
            </label>
            <label {...stylex.props(pickerStyles.label)}>
              <input
                type="radio"
                name="external-cli-provider"
                checked={manualProvider === "grok"}
                onChange={() => setManualProvider("grok")}
              />
              Grok
            </label>
          </fieldset>
        ) : null}
        {needsWorkingDirectory(currentBackend) && !resolvedCwd ? (
          <input
            {...stylex.props(controls.textInput)}
            type="text"
            value={externalCliCwd}
            onChange={(event) => setExternalCliCwd(event.target.value)}
            placeholder="Working directory, e.g. /home/you/project"
          />
        ) : null}
        {trimmedInput ? (
          <span {...stylex.props(formStyles.status)}>
            {shouldResolveExternalCli(trimmedInput) &&
            !resolvedBareProvider &&
            !bareUuidUnknown &&
            !bareUuidAmbiguous
              ? "Looking up whether this UUID is a Claude, Cursor, Codex, or Grok chat…"
              : resolvedCwd
                ? `${backendHint[currentBackend].replace("needs a working directory.", `using ${resolvedCwd}.`)}`
                : backendHint[currentBackend]}
          </span>
        ) : null}
      </div>
      <div {...stylex.props(composer.actions)}>
        <button {...stylex.props(controls.button)} type="submit">
          Open session
        </button>
      </div>
    </form>
  );
}
