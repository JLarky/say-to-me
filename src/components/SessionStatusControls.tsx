import React, { useEffect, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link, useNavigate } from "react-router";
import { cliResumeCommand } from "@say-to-me/session-utils/cli-resume-command";

import { controls } from "../styles/controls.stylex.ts";
import { badge } from "../styles/feed.stylex.ts";
import { session as sessionStyles } from "../styles/session.stylex.ts";
import type {
  Capabilities,
  ExternalCliActivitySnapshot,
  MessageSessionReference,
  Session,
} from "../types.ts";
import { type OpenCodeStatus } from "../types.ts";
import {
  compactLinkLabel,
  getLastOpenCodeLink,
  type LastOpenCodeLink,
  saveLastOpenCodeLink,
} from "../utils.ts";
import { fetchDashboardPlacement, type DashboardPlacement } from "../spaces-api.ts";
import { AttachSessionDialog } from "./AttachSessionDialog.tsx";

import { sessionListLabel } from "../session-label.ts";

const opencodeStatusBadge = stylex.create({
  idle: { backgroundColor: "#dcfae6", color: "#067647" },
  pending: { backgroundColor: "#fef0c7", color: "#93370d" },
  retrying: { backgroundColor: "#fef3f2", color: "#b42318" },
  error: { backgroundColor: "#fee4e2", color: "#b42318" },
  unavailable: { backgroundColor: "#fee4e2", color: "#b42318" },
  ["voice-only"]: { backgroundColor: "#f0f0f0", color: "#667085" },
});

const externalCliStatusBadge = stylex.create({
  idle: { backgroundColor: "#dcfae6", color: "#067647" },
  busy: { backgroundColor: "#fef0c7", color: "#93370d" },
});

export function OpenCodeStatusBadge({
  status,
  backend,
}: {
  status: OpenCodeStatus;
  backend?: string | null;
}) {
  if (backend === "voice") {
    return (
      <span
        {...stylex.props(badge.base, opencodeStatusBadge["voice-only"])}
        data-opencode-status="voice-only"
        data-session-backend="voice"
      >
        Voice only
      </span>
    );
  }
  return (
    <span {...stylex.props(badge.base, opencodeStatusBadge[status])} data-opencode-status={status}>
      OpenCode {status}
    </span>
  );
}

export function ExternalCliStatusBadge({
  provider,
  busy,
}: {
  provider: "Cursor" | "Claude" | "Codex" | "Grok";
  busy: boolean;
}) {
  const status = busy ? "busy" : "idle";
  return (
    <span
      {...stylex.props(badge.base, externalCliStatusBadge[status])}
      data-external-cli-status={status}
      data-external-cli-provider={provider.toLowerCase()}
    >
      {provider} {status}
    </span>
  );
}

const linksDropdown = stylex.create({
  wrapper: {
    position: "relative",
    display: "inline-flex",
    zIndex: 20,
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 10,
    backgroundColor: "#fff",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#e0c9b0",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
    display: "flex",
    flexDirection: "column",
    width: "14rem",
    maxWidth: "calc(100vw - 2rem)",
    maxHeight: "60vh",
    overflowY: "auto",
    overflowX: "hidden",
  },
  dropdownItem: {
    display: "block",
    width: "100%",
    paddingBlock: "0.75rem",
    paddingInline: "1.1rem",
    color: "#1a1a1a",
    textDecoration: "none",
    fontSize: "0.88rem",
    whiteSpace: "nowrap",
    borderWidth: 0,
    borderRadius: 0,
    textAlign: "left",
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": "#fdf3e7",
    },
  },
  lastUsedTag: {
    marginLeft: "0.4rem",
    fontSize: "0.72rem",
    color: "#888",
    fontWeight: 400,
  },
  recentLinks: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.35rem",
  },
  recentLink: {
    color: "#1a56db",
    display: "-webkit-box",
    fontSize: "0.82rem",
    lineHeight: 1.35,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    maxWidth: "100%",
    overflow: "hidden",
    overflowWrap: "anywhere",
  },
  dashboardError: {
    margin: 0,
    paddingBlock: "0.35rem",
    paddingInline: "1.1rem",
    color: "#b42318",
    fontSize: "0.75rem",
    lineHeight: 1.35,
  },
});

function sessionReferenceLabel(session: MessageSessionReference): string {
  return sessionListLabel({
    id: session.id,
    alias: session.alias,
    opencodeTitle: session.title,
  });
}

const canned = stylex.create({
  section: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "#e0c9b0",
    paddingTop: "0.5rem",
    paddingBottom: "0.75rem",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
  },
  label: {
    fontSize: "0.75rem",
    color: "#888",
    margin: 0,
    marginBottom: "0.4rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.4rem",
    columnGap: "0.4rem",
  },
  chip: {
    paddingTop: "0.3rem",
    paddingBottom: "0.3rem",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    borderRadius: "999px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#ccc",
    color: "#1a1a1a",
    fontSize: "0.82rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
    width: "auto",
    textAlign: "left",
    backgroundColor: {
      default: "transparent",
      ":hover": "#fdf3e7",
    },
  },
});

export {
  OpenCodeAgentModelBadge,
  OpenCodeModelSelect,
  openCodeSessionModelLabel,
} from "./SessionModelControls.tsx";
export { ReasoningEffortSelect } from "./ReasoningEffortSelect.tsx";

export function SessionLinks({
  localUrl,
  tailscaleUrl,
  sessionId,
  onCannedMessage = () => {},
  recentLinks = [],
  recentSessions = [],
  cliResumeCommand,
}: {
  localUrl: string | null;
  tailscaleUrl: string | null;
  sessionId: string | undefined;
  onCannedMessage?: (text: string) => void;
  recentLinks?: string[];
  recentSessions?: MessageSessionReference[];
  cliResumeCommand?: string | null;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [lastUsed, setLastUsed] = useState<LastOpenCodeLink | null>(null);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [attachPlacement, setAttachPlacement] = useState<DashboardPlacement | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const winRef = useRef<Window | null>(null);

  useEffect(() => {
    setLastUsed(getLastOpenCodeLink());
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node | null)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function openLink(url: string, which: LastOpenCodeLink) {
    if (winRef.current && !winRef.current.closed) {
      winRef.current.focus();
    } else {
      winRef.current = window.open(url, `opencode-${sessionId}`);
    }
    saveLastOpenCodeLink(which);
    setLastUsed(which);
    setOpen(false);
  }

  async function openDashboard() {
    if (!sessionId || dashboardBusy) return;
    setDashboardBusy(true);
    setDashboardError(null);
    try {
      const placement = await fetchDashboardPlacement(sessionId);
      if (!placement.placementPossible) {
        setDashboardError(
          placement.placementBlockReason === "no-spaces"
            ? "Create a space from Dashboard first."
            : placement.placementBlockReason === "cwd-deleted"
              ? "Session working directory no longer exists."
              : "Dashboard placement is not available for this session.",
        );
        setDashboardBusy(false);
        return;
      }
      if (placement.needsChooser) {
        setOpen(false);
        setAttachPlacement(placement);
        setDashboardBusy(false);
        return;
      }
      if (placement.canonicalDashboardPath) {
        setOpen(false);
        setDashboardBusy(false);
        // SPA navigate — avoid full document reload (especially painful after HMR).
        void navigate(placement.canonicalDashboardPath);
        return;
      }
      setDashboardError("Dashboard placement is not available for this session.");
      setDashboardBusy(false);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Unable to open Dashboard.");
      setDashboardBusy(false);
    }
  }

  return (
    <span {...stylex.props(linksDropdown.wrapper)} ref={ref}>
      <button
        {...stylex.props(controls.button, controls.secondary, controls.compact)}
        type="button"
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
      >
        Links
      </button>
      {open ? (
        <div {...stylex.props(linksDropdown.dropdown)}>
          <button
            type="button"
            {...stylex.props(linksDropdown.dropdownItem)}
            disabled={dashboardBusy || !sessionId}
            onClick={() => void openDashboard()}
          >
            {dashboardBusy ? "Dashboard…" : "Dashboard"}
          </button>
          {dashboardError ? (
            <p {...stylex.props(linksDropdown.dashboardError)}>{dashboardError}</p>
          ) : null}
          <Link
            to={sessionId ? `/organize?session=${encodeURIComponent(sessionId)}` : "/organize"}
            {...stylex.props(linksDropdown.dropdownItem)}
            onClick={() => setOpen(false)}
          >
            Organize
          </Link>
          {cliResumeCommand ? (
            <button
              type="button"
              {...stylex.props(linksDropdown.dropdownItem)}
              onClick={() => {
                navigator.clipboard.writeText(cliResumeCommand).catch(() => {});
                setOpen(false);
              }}
            >
              Copy CLI
            </button>
          ) : null}
          {localUrl ? (
            <a
              href={localUrl}
              {...stylex.props(linksDropdown.dropdownItem)}
              data-opencode-link="local"
              data-last-used={lastUsed === "local" ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                openLink(localUrl, "local");
              }}
            >
              Open local
              {lastUsed === "local" ? (
                <span {...stylex.props(linksDropdown.lastUsedTag)}>(last used)</span>
              ) : null}
            </a>
          ) : null}
          {tailscaleUrl ? (
            <a
              href={tailscaleUrl}
              {...stylex.props(linksDropdown.dropdownItem)}
              data-opencode-link="tailscale"
              data-last-used={lastUsed === "tailscale" ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                openLink(tailscaleUrl, "tailscale");
              }}
            >
              Open Tailscale
              {lastUsed === "tailscale" ? (
                <span {...stylex.props(linksDropdown.lastUsedTag)}>(last used)</span>
              ) : null}
            </a>
          ) : null}
          <div {...stylex.props(canned.section)}>
            <p {...stylex.props(canned.label)}>Quick messages</p>
            <div {...stylex.props(canned.chips)}>
              <button
                type="button"
                {...stylex.props(canned.chip)}
                onClick={() => {
                  onCannedMessage(
                    "Keep in mind that I don't see the full opencode session; I only see the messages you sent me over voice. In light of that, get me up to speed since you sent your last voice message; be brief",
                  );
                  setOpen(false);
                }}
              >
                remind about voice
              </button>
              <button
                type="button"
                {...stylex.props(canned.chip)}
                onClick={() => {
                  onCannedMessage(
                    "Start by running date command to get wall clock. Every once in a while run date command again, if more than a couple of minutes passed send me a voice message with short status update",
                  );
                  setOpen(false);
                }}
              >
                wall clock
              </button>
              <button
                type="button"
                {...stylex.props(canned.chip)}
                onClick={() => {
                  onCannedMessage(
                    "please run say-to-me cli and internalize how you can best use this tool to notify me about your progress using TTS technology that gives you ability to talk with me using voice at times where I might not be able to read your text replies",
                  );
                  setOpen(false);
                }}
              >
                how to use say to me
              </button>
            </div>
          </div>
          {recentLinks.length > 0 ? (
            <div {...stylex.props(canned.section)}>
              <p {...stylex.props(canned.label)}>Recent links</p>
              <div {...stylex.props(linksDropdown.recentLinks)}>
                {recentLinks.map((link) => (
                  <a
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link}
                    {...stylex.props(linksDropdown.recentLink)}
                    onClick={() => setOpen(false)}
                  >
                    {compactLinkLabel(link)}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          {recentSessions.length > 0 ? (
            <div {...stylex.props(canned.section)}>
              <p {...stylex.props(canned.label)}>Sessions</p>
              <div {...stylex.props(linksDropdown.recentLinks)}>
                {recentSessions.map((session) => (
                  <Link
                    key={session.id}
                    to={`/ses/${session.id}`}
                    title={session.id}
                    {...stylex.props(linksDropdown.recentLink)}
                    onClick={() => setOpen(false)}
                  >
                    {sessionReferenceLabel(session)}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {attachPlacement ? (
        <AttachSessionDialog
          sessionId={sessionId!}
          initialPlacement={attachPlacement}
          returnFocusTo={buttonRef.current}
          onClose={() => setAttachPlacement(null)}
        />
      ) : null}
    </span>
  );
}

/** @deprecated Use SessionLinks instead */
export const OpenCodeLinks = SessionLinks;

export function SessionStatusControls({
  session,
  sessionId,
  onStopOpenCode = () => {},
  onStopCursor = () => {},
  onStopClaude = () => {},
  onStopCodex = () => {},
  onStopGrok = () => {},
  capabilities = {},
  externalCliActivity = null,
  onCannedMessage = () => {},
  recentLinks = [],
  recentSessions = [],
}: {
  session: Session | null;
  sessionId: string | undefined;
  onStopOpenCode?: () => void;
  onStopCursor?: () => void;
  onStopClaude?: () => void;
  onStopCodex?: () => void;
  onStopGrok?: () => void;
  capabilities?: Partial<Capabilities>;
  externalCliActivity?: ExternalCliActivitySnapshot | null;
  onCannedMessage?: (text: string) => void;
  recentLinks?: string[];
  recentSessions?: MessageSessionReference[];
}) {
  const isCursorSession = session?.backend === "cursor";
  const isClaudeSession = session?.backend === "claude";
  const isCodexSession = session?.backend === "codex";
  const isGrokSession = session?.backend === "grok";
  const isVoiceSession = session?.backend === "voice";
  const externalCliBusy = Boolean(externalCliActivity?.busy);
  const shouldReserve = !session?.opencodeStatus && session?.backend === "opencode";
  const showStatus = isVoiceSession || session?.opencodeStatus || shouldReserve;
  const status = session?.opencodeStatus || "unavailable";
  const { opencodeLocalBase, opencodeTailscaleBase, opencodeDirB64: capDirB64 } = capabilities;
  const opencodeDirB64 = session?.opencodeDirB64 || capDirB64;
  const hasOpenCodeLinks =
    session?.backend === "opencode" &&
    opencodeDirB64 &&
    (opencodeLocalBase || opencodeTailscaleBase);
  // Show the Links dropdown for any session — the OpenCode "Open local/Tailscale"
  // entries are gated by hasOpenCodeLinks, while the quick messages, recent links,
  // and recent sessions are useful on default and Claude sessions too.
  const showLinks = Boolean(sessionId);

  function makeUrl(base: string) {
    return `${base}/${opencodeDirB64}/session/${sessionId}`;
  }

  return (
    <>
      {showLinks ? (
        <SessionLinks
          localUrl={hasOpenCodeLinks && opencodeLocalBase ? makeUrl(opencodeLocalBase) : null}
          tailscaleUrl={
            hasOpenCodeLinks && opencodeTailscaleBase ? makeUrl(opencodeTailscaleBase) : null
          }
          sessionId={sessionId}
          onCannedMessage={onCannedMessage}
          recentLinks={recentLinks}
          recentSessions={recentSessions}
          cliResumeCommand={cliResumeCommand(session, sessionId)}
        />
      ) : null}
      {showStatus ? (
        <span
          {...stylex.props(
            sessionStyles.statusControls,
            shouldReserve && sessionStyles.statusControlsReserved,
          )}
          data-session-status-controls
          data-reserved={shouldReserve || undefined}
        >
          <OpenCodeStatusBadge status={status} backend={session?.backend} />
          {session?.opencodeStatus === "pending" || session?.opencodeStatus === "retrying" ? (
            <button
              {...stylex.props(controls.button, controls.danger, controls.compact)}
              type="button"
              onClick={onStopOpenCode}
            >
              Stop OpenCode
            </button>
          ) : null}
        </span>
      ) : null}
      {isCursorSession && externalCliBusy ? (
        <span {...stylex.props(sessionStyles.statusControls)} data-session-status-controls>
          <ExternalCliStatusBadge provider="Cursor" busy />
          <button
            {...stylex.props(controls.button, controls.danger, controls.compact)}
            type="button"
            onClick={onStopCursor}
          >
            Stop Cursor
          </button>
        </span>
      ) : null}
      {isClaudeSession && externalCliBusy ? (
        <span {...stylex.props(sessionStyles.statusControls)} data-session-status-controls>
          <ExternalCliStatusBadge provider="Claude" busy />
          <button
            {...stylex.props(controls.button, controls.danger, controls.compact)}
            type="button"
            onClick={onStopClaude}
          >
            Stop Claude
          </button>
        </span>
      ) : null}
      {isCodexSession && externalCliBusy ? (
        <span {...stylex.props(sessionStyles.statusControls)} data-session-status-controls>
          <ExternalCliStatusBadge provider="Codex" busy />
          <button
            {...stylex.props(controls.button, controls.danger, controls.compact)}
            type="button"
            onClick={onStopCodex}
          >
            Stop Codex
          </button>
        </span>
      ) : null}
      {isGrokSession && externalCliBusy ? (
        <span {...stylex.props(sessionStyles.statusControls)} data-session-status-controls>
          <ExternalCliStatusBadge provider="Grok" busy />
          <button
            {...stylex.props(controls.button, controls.danger, controls.compact)}
            type="button"
            onClick={onStopGrok}
          >
            Stop Grok
          </button>
        </span>
      ) : null}
    </>
  );
}
