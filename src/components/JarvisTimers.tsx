import { safeResponseJson } from "@say-to-me/runtime-validation";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { ErrorPayload, JarvisTimersPayload, type JarvisTimer, type Session } from "../types.ts";
import { card, misc } from "../styles/chrome.stylex.ts";
import { controls } from "../styles/controls.stylex.ts";
import { badge, messageMeta, queue, thread } from "../styles/feed.stylex.ts";
import { session as sessionStyles } from "../styles/session.stylex.ts";
import {
  canEditTimer,
  canStopTimer,
  draftFromTimer,
  dueAtFromDraft,
  errorMessage,
  formatTimerTime,
  intervalFromDraft,
  isExpiredPausedTimer,
  repeatLabel,
  timerCountdownLabel,
  timerNeedsClock,
  timerScheduleLabel,
  timerSortTime,
  timerStatusLabel,
  type TimerDraft,
} from "../jarvis-timer-utils.ts";

export {
  emptyTimerDraft,
  dueAtFromDraft,
  intervalFromDraft,
  timerCountdownLabel,
  type TimerDraft,
} from "../jarvis-timer-utils.ts";

const mobile = "@media (max-width: 680px)" as const;

const styles = stylex.create({
  compactTimerInfo: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.45rem",
    minWidth: 0,
    paddingTop: "0.35rem",
  },
  compactTimerLink: {
    color: "inherit",
    fontWeight: 700,
    textDecoration: "none",
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.45rem",
    marginTop: "0.5rem",
    minWidth: 0,
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
  timerGrid: {
    display: "grid",
    rowGap: "0.85rem",
    columnGap: "0.85rem",
    minWidth: 0,
  },
  timerForm: {
    display: "grid",
    rowGap: "1rem",
    columnGap: "1rem",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      [mobile]: "minmax(0, 1fr)",
    },
    minWidth: 0,
  },
  timerField: {
    display: "grid",
    rowGap: "0.4rem",
    columnGap: "0.4rem",
    color: "#344054",
    fontSize: "0.92rem",
    fontWeight: 700,
    minWidth: 0,
  },
  timerFieldControl: {
    boxSizing: "border-box",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.16)",
    borderRadius: "16px",
    backgroundColor: "#fffdf8",
    minWidth: 0,
    maxWidth: "100%",
    width: "100%",
    paddingBlock: "0.78rem",
    paddingInline: "0.9rem",
  },
  timerFieldHelp: {
    color: "#667085",
    fontSize: "0.82rem",
    fontWeight: 500,
  },
  timerTextarea: {
    minHeight: "9rem",
    resize: "vertical",
  },
  timerWide: {
    gridColumnStart: "1",
    gridColumnEnd: "-1",
  },
  overviewRow: {
    display: "block",
    textDecoration: "none",
  },
  timerActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.45rem",
    minWidth: 0,
    marginTop: "0.7rem",
    paddingTop: "0.25rem",
  },
  timerBadge: {
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
  timerList: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    rowGap: "1rem",
    columnGap: "1rem",
    listStyle: "none",
    margin: 0,
    minWidth: 0,
    padding: 0,
  },
  timerItem: {
    minWidth: 0,
    maxWidth: "100%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.1)",
    borderRadius: "24px",
    backgroundColor: "#fffdf8",
    boxShadow: "0 12px 34px rgba(23, 32, 42, 0.07)",
    padding: {
      default: "1.2rem",
      [mobile]: "0.9rem",
    },
  },
  timerCard: {
    display: "grid",
    rowGap: "0.9rem",
    columnGap: "0.9rem",
    minWidth: 0,
  },
  timerCardHeader: {
    alignItems: "flex-start",
    display: "flex",
    justifyContent: "space-between",
    rowGap: "1rem",
    columnGap: "1rem",
    flexWrap: {
      [mobile]: "wrap",
    },
    minWidth: 0,
  },
  timerTitle: {
    color: "#17202a",
    fontSize: "1.1rem",
    fontWeight: 800,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  timerSchedule: {
    color: "#8a4b20",
    fontSize: "0.9rem",
    fontWeight: 700,
    overflowWrap: "anywhere",
  },
  timerMessage: {
    maxWidth: "100%",
    minWidth: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.08)",
    borderRadius: "16px",
    backgroundColor: "rgba(245, 240, 232, 0.54)",
    color: "#344054",
    margin: 0,
    padding: "0.85rem",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  timerTargetLink: {
    boxSizing: "border-box",
    display: "grid",
    rowGap: "0.12rem",
    columnGap: "0.12rem",
    maxWidth: "100%",
    minWidth: 0,
    borderRadius: "16px",
    backgroundColor: "#e4e7ec",
    color: "#344054",
    paddingBlock: "0.48rem",
    paddingInline: "0.68rem",
    textDecoration: "none",
    width: {
      [mobile]: "100%",
    },
  },
  timerTargetLabel: {
    color: "#667085",
    fontSize: "0.72rem",
    fontWeight: 800,
    letterSpacing: "0.08em",
    lineHeight: 1.1,
    textTransform: "uppercase",
  },
  timerTargetValue: {
    color: "#344054",
    fontSize: "0.9rem",
    fontWeight: 700,
    lineHeight: 1.25,
    maxWidth: "100%",
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  timerHeaderActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.45rem",
    marginTop: "1rem",
    marginBottom: "1rem",
  },
});

function useTimerNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [enabled]);
  return now;
}

export function SessionTimerSummary({
  createHref,
  sessionId,
  setError,
  timersHref,
}: {
  createHref: string;
  sessionId: string | undefined;
  setError: (error: string) => void;
  timersHref: string;
}) {
  const [timers, setTimers] = useState<JarvisTimer[]>([]);
  const now = useTimerNow(timers.some(timerNeedsClock));

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    async function refreshTimers() {
      const response = await fetch(
        `/api/jarvis-timers?sessionId=${encodeURIComponent(sessionId!)}`,
      );
      const payload = await safeResponseJson(response, JarvisTimersPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to load timers."));
      if (!cancelled) setTimers(payload.timers);
    }
    void refreshTimers().catch((err) => setError(errorMessage(err, "Unable to load timers.")));
    const interval = window.setInterval(() => {
      void refreshTimers().catch((err) => setError(errorMessage(err, "Unable to load timers.")));
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionId, setError]);

  if (!sessionId) return null;

  const visibleTimers = timers
    .filter(
      (timer) =>
        timer.status === "active" || timer.status === "firing" || timer.status === "paused",
    )
    .sort((a, b) => a.nextFireAt - b.nextFireAt);

  return (
    <div {...stylex.props(styles.compactTimerInfo)}>
      {timers.length === 0 ? (
        <Link
          {...stylex.props(badge.base, styles.timerBadge, styles.compactTimerLink)}
          to={createHref}
        >
          + Timer
        </Link>
      ) : visibleTimers.length ? (
        visibleTimers.map((timer) => (
          <Link
            key={timer.id}
            {...stylex.props(
              badge.base,
              styles.timerBadge,
              timer.status === "active" && badge.pending,
              isExpiredPausedTimer(timer, now) && badge.pending,
              styles.compactTimerLink,
            )}
            to={timersHref}
          >
            {timer.title} {timerCountdownLabel(timer, now)}
          </Link>
        ))
      ) : (
        <Link
          {...stylex.props(badge.base, styles.timerBadge, styles.compactTimerLink)}
          to={timersHref}
        >
          No active timers
        </Link>
      )}
    </div>
  );
}

export function JarvisTimersOverview({
  createHref = "/jarvis/timers/new",
  sessions,
  setError,
}: {
  createHref?: string;
  sessions: Session[];
  setError: (error: string) => void;
}) {
  const [timers, setTimers] = useState<JarvisTimer[]>([]);
  const now = useTimerNow(timers.some(timerNeedsClock));

  useEffect(() => {
    let cancelled = false;
    async function refreshTimers() {
      const response = await fetch("/api/jarvis-timers");
      const payload = await safeResponseJson(response, JarvisTimersPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to load timers."));
      if (!cancelled) setTimers(payload.timers);
    }
    void refreshTimers().catch((err) => setError(errorMessage(err, "Unable to load timers.")));
    const interval = window.setInterval(() => {
      void refreshTimers().catch((err) => setError(errorMessage(err, "Unable to load timers.")));
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [setError]);

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const timersBySession = new Map<string, JarvisTimer[]>();
  for (const timer of timers) {
    const group = timersBySession.get(timer.sessionId) ?? [];
    group.push(timer);
    timersBySession.set(timer.sessionId, group);
  }
  const sessionGroups = [...timersBySession.entries()]
    .map(([sessionId, sessionTimers]) => ({
      session: sessionsById.get(sessionId),
      sessionId,
      timers: sessionTimers.sort((a, b) => timerSortTime(a) - timerSortTime(b)),
    }))
    .sort((a, b) => timerSortTime(a.timers[0]!) - timerSortTime(b.timers[0]!));

  return (
    <section {...stylex.props(card.base, queue.panel)}>
      <div {...stylex.props(queue.heading)}>
        <div>
          <h2 {...stylex.props(queue.headingH2)}>Timers</h2>
          <p {...stylex.props(styles.summary)}>Scheduled prompts grouped by session.</p>
        </div>
        <span {...stylex.props(queue.headingCount)}>{timers.length}</span>
      </div>
      <div {...stylex.props(styles.timerHeaderActions)}>
        <Link {...stylex.props(controls.button)} to={createHref}>
          Create timer
        </Link>
      </div>
      {sessionGroups.length ? (
        <ol {...stylex.props(thread.list, styles.sectionStack)}>
          {sessionGroups.map(({ session, sessionId, timers: sessionTimers }) => {
            const title = session?.alias || session?.opencodeTitle || sessionId;
            return (
              <li key={sessionId} {...stylex.props(thread.item)}>
                <Link
                  {...stylex.props(styles.overviewRow, styles.compactTimerLink)}
                  to={`/ses/${sessionId}/timers`}
                >
                  <div {...stylex.props(thread.projectItemContent)}>
                    <div {...stylex.props(messageMeta.root)}>
                      <div {...stylex.props(sessionStyles.titleRow)}>
                        <span {...stylex.props(sessionStyles.titleCluster)}>{title}</span>
                      </div>
                      <span {...stylex.props(queue.badges)}>
                        <span {...stylex.props(badge.base, styles.timerBadge)}>
                          {sessionTimers.length} timers
                        </span>
                      </span>
                    </div>
                    <div {...stylex.props(styles.compactTimerInfo)}>
                      {sessionTimers.map((timer) => (
                        <span
                          key={timer.id}
                          {...stylex.props(
                            badge.base,
                            styles.timerBadge,
                            timer.status === "active" && badge.pending,
                            isExpiredPausedTimer(timer, now) && badge.pending,
                            timer.status === "cancelled" && badge.failed,
                          )}
                        >
                          {timer.title} {timerCountdownLabel(timer, now)}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <p {...stylex.props(misc.empty)}>No timers scheduled.</p>
      )}
    </section>
  );
}

export function TimerDraftFields({
  draft,
  onChange,
  sessions,
}: {
  draft: TimerDraft;
  onChange: (draft: TimerDraft) => void;
  sessions: Session[];
}) {
  return (
    <div {...stylex.props(styles.timerForm)}>
      <label {...stylex.props(styles.timerField)}>
        Target session
        <select
          {...stylex.props(controls.textInput, styles.timerFieldControl)}
          value={draft.sessionId}
          onChange={(event) => onChange({ ...draft, sessionId: event.target.value })}
        >
          <option value="default">default</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.alias || session.opencodeTitle || session.id}
            </option>
          ))}
        </select>
        <span {...stylex.props(styles.timerFieldHelp)}>
          The prompt will be sent to this session.
        </span>
      </label>
      <label {...stylex.props(styles.timerField)}>
        Title
        <input
          {...stylex.props(controls.textInput, styles.timerFieldControl)}
          maxLength={80}
          type="text"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
        />
        <span {...stylex.props(styles.timerFieldHelp)}>Short label shown in timer lists.</span>
      </label>
      <label {...stylex.props(styles.timerField)}>
        Next fire time
        <input
          {...stylex.props(controls.textInput, styles.timerFieldControl)}
          type="datetime-local"
          value={draft.nextFireAt}
          onChange={(event) => onChange({ ...draft, nextFireAt: event.target.value })}
        />
        <span {...stylex.props(styles.timerFieldHelp)}>Use your browser's local time.</span>
      </label>
      <label {...stylex.props(styles.timerField)}>
        Repeat minutes
        <input
          {...stylex.props(controls.textInput, styles.timerFieldControl)}
          min={1}
          placeholder="one-shot"
          type="number"
          value={draft.repeatMinutes}
          onChange={(event) => onChange({ ...draft, repeatMinutes: event.target.value })}
        />
        <span {...stylex.props(styles.timerFieldHelp)}>Leave blank for a one-shot timer.</span>
      </label>
      <label {...stylex.props(styles.timerField, styles.timerWide)}>
        Message sent when timer fires
        <textarea
          {...stylex.props(controls.textInput, styles.timerFieldControl, styles.timerTextarea)}
          rows={5}
          value={draft.message}
          onChange={(event) => onChange({ ...draft, message: event.target.value })}
        />
        <span {...stylex.props(styles.timerFieldHelp)}>
          This text is delivered as a user message when the timer fires.
        </span>
      </label>
    </div>
  );
}

export function JarvisTimersPanel({
  createHref = "/jarvis/timers/new",
  emptyText = "No timers scheduled.",
  sessionId,
  sessions,
  setError,
  summary = "Scheduled prompts that will be sent to their target sessions.",
  title = "Timers",
}: {
  createHref?: string;
  emptyText?: string;
  sessionId?: string;
  sessions: Session[];
  setError: (error: string) => void;
  summary?: string;
  title?: string;
}) {
  const [timers, setTimers] = useState<JarvisTimer[]>([]);
  const [editingTimerId, setEditingTimerId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<TimerDraft | null>(null);
  const [timerBusy, setTimerBusy] = useState(false);
  const now = useTimerNow(timers.some(timerNeedsClock));

  async function refreshTimers() {
    const response = await fetch(
      sessionId
        ? `/api/jarvis-timers?sessionId=${encodeURIComponent(sessionId)}`
        : "/api/jarvis-timers",
    );
    const payload = await safeResponseJson(response, JarvisTimersPayload);
    if (!response.ok) throw new Error(errorMessage(payload, "Unable to load timers."));
    setTimers(payload.timers);
  }

  useEffect(() => {
    void refreshTimers().catch((err) => setError(errorMessage(err, "Unable to load timers.")));
    const interval = window.setInterval(() => {
      void refreshTimers().catch((err) => setError(errorMessage(err, "Unable to load timers.")));
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [sessionId, setError]);

  async function saveEditedTimer(event: FormEvent) {
    event.preventDefault();
    if (!editingTimerId || !editDraft) return;
    const dueAt = dueAtFromDraft(editDraft);
    if (!Number.isFinite(dueAt)) {
      setError("Choose a valid next fire time.");
      return;
    }
    setTimerBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/jarvis-timers/${editingTimerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: editDraft.sessionId,
          title: editDraft.title,
          message: editDraft.message,
          dueAt,
          intervalMs: intervalFromDraft(editDraft),
        }),
      });
      const payload = await safeResponseJson(response, ErrorPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to save timer."));
      setEditingTimerId(null);
      setEditDraft(null);
      await refreshTimers();
    } catch (err) {
      setError(errorMessage(err, "Unable to save timer."));
    } finally {
      setTimerBusy(false);
    }
  }

  async function runTimerAction(
    timer: JarvisTimer,
    action: "trigger" | "pause" | "resume" | "cancel",
  ) {
    if (action === "resume" && timer.nextFireAt <= Date.now()) {
      setError("This timer is in the past. Edit it before resuming.");
      return;
    }
    setTimerBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/jarvis-timers/${timer.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await safeResponseJson(response, ErrorPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to update timer."));
      await refreshTimers();
    } catch (err) {
      setError(errorMessage(err, "Unable to update timer."));
    } finally {
      setTimerBusy(false);
    }
  }

  async function deleteTimer(timer: JarvisTimer) {
    setTimerBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/jarvis-timers/${timer.id}`, { method: "DELETE" });
      const payload = await safeResponseJson(response, ErrorPayload);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to delete timer."));
      if (editingTimerId === timer.id) {
        setEditingTimerId(null);
        setEditDraft(null);
      }
      await refreshTimers();
    } catch (err) {
      setError(errorMessage(err, "Unable to delete timer."));
    } finally {
      setTimerBusy(false);
    }
  }

  return (
    <section {...stylex.props(card.base, queue.panel)}>
      <div {...stylex.props(queue.heading)}>
        <div>
          <h2 {...stylex.props(queue.headingH2)}>{title}</h2>
          <p {...stylex.props(styles.summary)}>{summary}</p>
        </div>
        <span {...stylex.props(queue.headingCount)}>{timers.length}</span>
      </div>
      <div {...stylex.props(styles.timerHeaderActions)}>
        <Link {...stylex.props(controls.button)} to={createHref}>
          Create timer
        </Link>
      </div>
      {timers.length ? (
        <ol {...stylex.props(styles.timerList)}>
          {timers.map((timer) => (
            <JarvisTimerRow
              key={timer.id}
              editDraft={editingTimerId === timer.id ? editDraft : null}
              editing={editingTimerId === timer.id}
              onCancelEdit={() => {
                setEditingTimerId(null);
                setEditDraft(null);
              }}
              onEdit={() => {
                setEditingTimerId(timer.id);
                setEditDraft(draftFromTimer(timer));
              }}
              onEditDraft={setEditDraft}
              onDelete={deleteTimer}
              onRunAction={runTimerAction}
              onSaveEdit={saveEditedTimer}
              sessions={sessions}
              timer={timer}
              timerBusy={timerBusy}
              now={now}
            />
          ))}
        </ol>
      ) : (
        <p {...stylex.props(misc.empty)}>{emptyText}</p>
      )}
    </section>
  );
}

function JarvisTimerRow({
  editDraft,
  editing,
  onCancelEdit,
  onEdit,
  onEditDraft,
  onDelete,
  onRunAction,
  onSaveEdit,
  sessions,
  timer,
  timerBusy,
  now,
}: {
  editDraft: TimerDraft | null;
  editing: boolean;
  onCancelEdit: () => void;
  onEdit: () => void;
  onEditDraft: (draft: TimerDraft) => void;
  onDelete: (timer: JarvisTimer) => void;
  onRunAction: (timer: JarvisTimer, action: "trigger" | "pause" | "resume" | "cancel") => void;
  onSaveEdit: (event: FormEvent) => void;
  sessions: Session[];
  timer: JarvisTimer;
  timerBusy: boolean;
  now: number;
}) {
  const target = sessions.find((session) => session.id === timer.sessionId);
  return (
    <li {...stylex.props(styles.timerItem)}>
      <div {...stylex.props(styles.timerCard)}>
        <div {...stylex.props(styles.timerCardHeader)}>
          <div>
            <div {...stylex.props(styles.timerTitle)}>{timer.title}</div>
            <div {...stylex.props(styles.timerSchedule)}>{timerScheduleLabel(timer)}</div>
          </div>
          <span
            {...stylex.props(
              badge.base,
              styles.timerBadge,
              timer.status === "active" && badge.pending,
            )}
          >
            {timerStatusLabel(timer)}
          </span>
        </div>
        <div {...stylex.props(styles.meta)}>
          <Link {...stylex.props(styles.timerTargetLink)} to={`/ses/${timer.sessionId}`}>
            <span {...stylex.props(styles.timerTargetLabel)}>Target session</span>
            <span {...stylex.props(styles.timerTargetValue)}>
              {target?.alias || target?.opencodeTitle || timer.sessionId}
            </span>
          </Link>
          <span
            {...stylex.props(
              badge.base,
              styles.timerBadge,
              timer.status === "active" && badge.pending,
              isExpiredPausedTimer(timer, now) && badge.pending,
            )}
          >
            {timerCountdownLabel(timer, now)}
          </span>
          <span {...stylex.props(badge.base, styles.timerBadge)}>{repeatLabel(timer)}</span>
          {timer.lastFiredAt ? (
            <span {...stylex.props(badge.base, styles.timerBadge)}>
              Last fired {formatTimerTime(timer.lastFiredAt)}
            </span>
          ) : null}
          {timer.lastError ? (
            <span {...stylex.props(badge.base, styles.timerBadge, badge.failed)}>
              {timer.lastError}
            </span>
          ) : null}
        </div>
        {editing && editDraft ? (
          <form {...stylex.props(styles.timerGrid)} onSubmit={onSaveEdit}>
            <TimerDraftFields draft={editDraft} onChange={onEditDraft} sessions={sessions} />
            <div {...stylex.props(styles.timerActions)}>
              <button {...stylex.props(controls.button)} type="submit" disabled={timerBusy}>
                Save Timer
              </button>
              <button
                {...stylex.props(controls.button, controls.secondary)}
                type="button"
                onClick={onCancelEdit}
              >
                Cancel Edit
              </button>
            </div>
          </form>
        ) : (
          <>
            <p {...stylex.props(styles.timerMessage)}>{timer.message}</p>
            <div {...stylex.props(styles.timerActions)}>
              <button
                {...stylex.props(controls.button)}
                type="button"
                disabled={timerBusy || timer.status !== "active"}
                onClick={() => onRunAction(timer, "trigger")}
              >
                Trigger Now
              </button>
              <button
                {...stylex.props(controls.button, controls.secondary)}
                type="button"
                disabled={timerBusy || (timer.status !== "active" && timer.status !== "firing")}
                onClick={() => onRunAction(timer, "pause")}
              >
                Pause
              </button>
              <button
                {...stylex.props(controls.button, controls.secondary)}
                type="button"
                disabled={timerBusy || timer.status !== "paused"}
                onClick={() => onRunAction(timer, "resume")}
              >
                Resume
              </button>
              <button
                {...stylex.props(controls.button, controls.secondary)}
                type="button"
                disabled={timerBusy || !canEditTimer(timer)}
                onClick={onEdit}
              >
                Edit
              </button>
              <button
                {...stylex.props(controls.button, controls.secondary)}
                type="button"
                disabled={timerBusy || !canStopTimer(timer)}
                onClick={() => onRunAction(timer, "cancel")}
              >
                Stop
              </button>
              <button
                {...stylex.props(controls.button, controls.danger)}
                type="button"
                disabled={timerBusy}
                onClick={() => onDelete(timer)}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}
