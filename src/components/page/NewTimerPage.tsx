import { safeResponseJson } from "@say-to-me/runtime-validation";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { PageShell } from "../PageShell.tsx";
import {
  TimerDraftFields,
  dueAtFromDraft,
  emptyTimerDraft,
  intervalFromDraft,
  type TimerDraft,
} from "../JarvisTimers.tsx";
import { ErrorPayload } from "../../types.ts";
import { useSessions } from "../../use-sessions.ts";
import { card, misc, text as textStyles } from "../../styles/chrome.stylex.ts";
import { controls } from "../../styles/controls.stylex.ts";
import { badge } from "../../styles/feed.stylex.ts";

const mobile = "@media (max-width: 680px)" as const;

const timerPage = stylex.create({
  layout: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
      [mobile]: "minmax(0, 1fr)",
    },
    rowGap: "1rem",
    columnGap: "1rem",
    alignItems: "start",
    minWidth: 0,
  },
  formCard: {
    minWidth: 0,
    maxWidth: "100%",
    padding: {
      default: "1.35rem",
      [mobile]: "1rem",
    },
  },
  previewCard: {
    minWidth: 0,
    maxWidth: "100%",
    padding: {
      default: "1.2rem",
      [mobile]: "1rem",
    },
    position: {
      default: "sticky",
      [mobile]: "static",
    },
    top: "1rem",
  },
  previewEyebrow: {
    margin: 0,
    color: "#8a4b20",
    fontSize: "0.76rem",
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  previewTitle: {
    marginTop: "0.35rem",
    marginBottom: "0.35rem",
    color: "#17202a",
    fontSize: "1.35rem",
    lineHeight: 1.05,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  previewMeta: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.45rem",
    marginTop: "0.75rem",
    minWidth: 0,
  },
  previewBadge: {
    alignItems: "flex-start",
    boxSizing: "border-box",
    lineHeight: 1.25,
    maxWidth: "100%",
    minHeight: "1.85rem",
    minWidth: 0,
    overflowWrap: "anywhere",
    paddingBlock: "0.34rem",
    width: {
      [mobile]: "100%",
    },
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
  previewTargetBlock: {
    alignContent: "start",
    boxSizing: "border-box",
    display: "grid",
    rowGap: "0.28rem",
    columnGap: "0.28rem",
    maxWidth: "100%",
    minHeight: "5.35rem",
    minWidth: 0,
    overflow: "visible",
    borderRadius: "16px",
    backgroundColor: "#e4e7ec",
    color: "#344054",
    paddingBlock: "0.78rem",
    paddingInline: "0.78rem",
    width: {
      [mobile]: "100%",
    },
  },
  previewTargetLabel: {
    color: "#667085",
    fontSize: "0.72rem",
    fontWeight: 800,
    letterSpacing: "0.08em",
    lineHeight: 1.1,
    textTransform: "uppercase",
  },
  previewTargetValue: {
    color: "#344054",
    fontSize: "0.9rem",
    fontWeight: 700,
    lineHeight: 1.25,
    maxWidth: "100%",
    minWidth: 0,
    overflow: {
      default: "hidden",
      [mobile]: "visible",
    },
    overflowWrap: "anywhere",
    textOverflow: {
      default: "ellipsis",
      [mobile]: "clip",
    },
    whiteSpace: {
      default: "nowrap",
      [mobile]: "normal",
    },
    wordBreak: "break-word",
  },
  previewMessage: {
    maxWidth: "100%",
    minWidth: 0,
    marginTop: "1rem",
    marginBottom: 0,
    borderRadius: "16px",
    backgroundColor: "rgba(245, 240, 232, 0.62)",
    color: "#344054",
    padding: "0.85rem",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  submitRow: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    justifyContent: "space-between",
    marginTop: "1.25rem",
    minWidth: 0,
  },
  submitActions: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    alignItems: "center",
    minWidth: 0,
  },
});

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message || fallback;
  try {
    return ErrorPayload.assert(value).error || fallback;
  } catch {
    return fallback;
  }
}

function previewTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Invalid fire time";
  return new Date(timestamp).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NewTimerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("sessionId");
  const { sessions } = useSessions({ includeCachedStatus: true, live: true });
  const [draft, setDraft] = useState<TimerDraft>(() => {
    const initialDraft = emptyTimerDraft([]);
    if (requestedSessionId) initialDraft.sessionId = requestedSessionId;
    return initialDraft;
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const targetSession = sessions.find((session) => session.id === draft.sessionId);
  const targetLabel = targetSession?.alias || targetSession?.opencodeTitle || draft.sessionId;
  const repeatLabel = draft.repeatMinutes.trim()
    ? `Repeats every ${draft.repeatMinutes.trim()}m`
    : "One-shot routine";

  useEffect(() => {
    document.title = "Create Routine | Say To Me";
  }, []);

  useEffect(() => {
    setDraft((current) =>
      requestedSessionId
        ? { ...current, sessionId: requestedSessionId }
        : current.sessionId === "default" && sessions[0]?.id
          ? { ...current, sessionId: sessions[0].id }
          : current,
    );
  }, [requestedSessionId, sessions]);

  async function createRoutine(event: FormEvent) {
    event.preventDefault();
    const dueAt = dueAtFromDraft(draft);
    if (!Number.isFinite(dueAt)) {
      setError("Choose a valid next fire time.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/routines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerSessionId: draft.sessionId,
          title: draft.title,
          trigger: {
            kind: "schedule",
            dueAt,
            intervalMs: intervalFromDraft(draft),
          },
          action: {
            kind: "deliver_prompt",
            title: draft.title,
            message: draft.message,
          },
        }),
      });
      const payload = await safeResponseJson(response, ErrorPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to create routine."));
      await navigate(requestedSessionId ? `/ses/${requestedSessionId}/timers` : "/jarvis");
    } catch (err) {
      setError(errorMessage(err, "Unable to create routine."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <PageShell
      eyebrow="Jarvis"
      backTo={requestedSessionId ? `/ses/${requestedSessionId}/timers` : "/jarvis"}
      backLabel={requestedSessionId ? "Back to routines" : "Back to Jarvis"}
      hero={
        <>
          <h1 {...stylex.props(textStyles.title)}>Create routine</h1>
          <p {...stylex.props(textStyles.lede)}>
            Schedule a one-shot or repeating prompt for a target session.
          </p>
        </>
      }
    >
      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}
      <div {...stylex.props(timerPage.layout)}>
        <section {...stylex.props(card.base, timerPage.formCard)}>
          <form onSubmit={createRoutine}>
            <TimerDraftFields draft={draft} onChange={setDraft} sessions={sessions} />
            <div {...stylex.props(timerPage.submitRow)}>
              <span {...stylex.props(badge.base, timerPage.previewBadge)}>
                Blank repeat means one-shot
              </span>
              <div {...stylex.props(timerPage.submitActions)}>
                <button {...stylex.props(controls.button)} type="submit" disabled={creating}>
                  {creating ? "Creating..." : "Create routine"}
                </button>
              </div>
            </div>
          </form>
        </section>
        <aside {...stylex.props(card.base, timerPage.previewCard)} aria-label="Routine preview">
          <p {...stylex.props(timerPage.previewEyebrow)}>Preview</p>
          <h2 {...stylex.props(timerPage.previewTitle)}>{draft.title || "Untitled routine"}</h2>
          <div {...stylex.props(timerPage.previewMeta)}>
            <div {...stylex.props(timerPage.previewTargetBlock)}>
              <span {...stylex.props(timerPage.previewTargetLabel)}>Target session</span>
              <span {...stylex.props(timerPage.previewTargetValue)} title={targetLabel}>
                {targetLabel}
              </span>
            </div>
            <span {...stylex.props(badge.base, timerPage.previewBadge, badge.pending)}>
              {previewTime(draft.nextFireAt)}
            </span>
            <span {...stylex.props(badge.base, timerPage.previewBadge)}>{repeatLabel}</span>
          </div>
          <p {...stylex.props(timerPage.previewMessage)}>
            {draft.message.trim() || "Routine message preview will appear here."}
          </p>
        </aside>
      </div>
    </PageShell>
  );
}
