import { safeResponseJson } from "@say-to-me/runtime-validation";
import { ErrorPayload, NoteContentPayload } from "../types.ts";
import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { card, misc, text as textStyles } from "../styles/chrome.stylex.ts";
import { composer, controls } from "../styles/controls.stylex.ts";
import { badge, messageMeta, queue, thread } from "../styles/feed.stylex.ts";
import { session as sessionStyles } from "../styles/session.stylex.ts";
import { PageShell } from "./PageShell.tsx";
import { sessionListLabel, showSessionIdSubline } from "../session-label.ts";
import type { NoteRecord, Session } from "../types.ts";
import { formatMessageTime, projectIdentity } from "../utils.ts";

const noteStyles = stylex.create({
  preview: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "#555",
    fontSize: "0.9rem",
    marginTop: "0.25rem",
    marginRight: "0",
    marginBottom: "0.5rem",
    marginLeft: "0",
  },
  content: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "inherit",
    fontSize: "1rem",
    lineHeight: 1.6,
    padding: "1rem",
    backgroundColor: "#fff",
    borderRadius: "6px",
    margin: 0,
  },
});

export function NotesPageContent({
  initialNotes,
  initialSession,
  sessionId,
}: {
  initialNotes: NoteRecord[];
  initialSession: Session | null;
  sessionId: string | undefined;
}) {
  const draftKey = sessionId ? `say-to-me-notes-draft-${sessionId}` : null;
  const [notes, setNotes] = useState<NoteRecord[]>(initialNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const headingLabel = initialSession ? sessionListLabel(initialSession) : sessionId || "Notes";
  const opencodeTitle = initialSession?.opencodeTitle ?? null;
  const identity = projectIdentity({
    id: initialSession?.id ?? sessionId ?? "default",
    opencodeTitle,
  });

  const [text, setText] = useState(() => {
    if (draftKey) {
      const draft = localStorage.getItem(draftKey);
      if (draft !== null) return draft;
    }
    return initialNotes[0]?.content ?? "";
  });

  useEffect(() => {
    document.title = `Notes — ${headingLabel} — Say To Me`;
  }, [headingLabel]);

  const prevDraftKeyRef = useRef(draftKey);
  useEffect(() => {
    if (!draftKey) return;
    const prevKey = prevDraftKeyRef.current;
    prevDraftKeyRef.current = draftKey;
    if (prevKey !== draftKey) return;
    if (text) {
      localStorage.setItem(draftKey, text);
    } else {
      localStorage.removeItem(draftKey);
    }
  }, [draftKey, text]);

  async function saveNote() {
    if (!sessionId || !text.trim()) return;
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await fetch(`/api/sessions/${sessionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        const data = await safeResponseJson(res, ErrorPayload);
        setError(data.error || "Failed to save note.");
        return;
      }
      const data = await safeResponseJson(res, NoteContentPayload);
      setNotes((prev) => [data.note, ...prev].slice(0, 10));
      setSavedMsg("Saved.");
      setTimeout(() => setSavedMsg(""), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(noteId: number) {
    if (!sessionId) return;
    setError("");
    const res = await fetch(`/api/sessions/${sessionId}/notes/${noteId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await safeResponseJson(res, ErrorPayload);
      setError(data.error || "Failed to delete note.");
      return;
    }
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
  }

  return (
    <PageShell
      identity={identity}
      currentSessionId={sessionId}
      eyebrow="Notes"
      backTo={sessionId ? `/ses/${sessionId}` : "/"}
      backLabel="Back to session"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title, sessionStyles.title)}>{headingLabel}</h1>
          {initialSession && showSessionIdSubline(initialSession) && sessionId ? (
            <p {...stylex.props(sessionStyles.idSub)}>{sessionId}</p>
          ) : null}
        </>
      }
    >
      <form
        {...stylex.props(card.base, composer.root)}
        onSubmit={(e) => {
          e.preventDefault();
          void saveNote();
        }}
      >
        <textarea
          {...stylex.props(controls.textarea)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write notes about this session…"
          rows={10}
        />
        <div {...stylex.props(composer.actions)}>
          <button
            {...stylex.props(controls.button)}
            type="submit"
            disabled={saving || !text.trim() || text === notes[0]?.content}
          >
            Save
          </button>
          {savedMsg ? <span {...stylex.props(badge.base)}>{savedMsg}</span> : null}
        </div>
      </form>

      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}

      {notes.length > 0 ? (
        <section {...stylex.props(card.base, queue.panel)}>
          <div {...stylex.props(queue.heading)}>
            <h2 {...stylex.props(queue.headingH2)}>Saved notes</h2>
            <span {...stylex.props(queue.headingCount)}>{notes.length}</span>
          </div>
          <ol {...stylex.props(thread.list)}>
            {notes.map((note) => (
              <li {...stylex.props(thread.item)} key={note.id}>
                <div {...stylex.props(messageMeta.root)}>
                  <span>#{note.id}</span>
                  <span {...stylex.props(queue.badges)}>
                    <span {...stylex.props(badge.base)}>{formatMessageTime(note.createdAt)}</span>
                  </span>
                </div>
                <p {...stylex.props(noteStyles.preview)}>
                  {note.content.slice(0, 120)}
                  {note.content.length > 120 ? "…" : ""}
                </p>
                <div {...stylex.props(messageMeta.actions)}>
                  <button
                    type="button"
                    {...stylex.props(messageMeta.actionLink)}
                    disabled={text === note.content}
                    onClick={() => setText(note.content)}
                  >
                    Restore
                  </button>
                  <Link
                    to={`/ses/${sessionId}/notes/${note.id}`}
                    {...stylex.props(messageMeta.actionLink)}
                  >
                    View
                  </Link>
                  <button
                    type="button"
                    {...stylex.props(controls.button, controls.danger)}
                    onClick={() => void deleteNote(note.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </PageShell>
  );
}

export function NoteSavePageContent() {
  const { sessionId, noteId } = useParams();
  const [note, setNote] = useState<NoteRecord | null>(null);
  const [error, setError] = useState("");
  const identity = projectIdentity({ id: sessionId ?? "default", opencodeTitle: null });

  useEffect(() => {
    if (!sessionId || !noteId) return;
    void (async () => {
      const res = await fetch(`/api/sessions/${sessionId}/notes/${noteId}`);
      if (!res.ok) {
        setError("Note not found.");
        return;
      }
      const data = await safeResponseJson(res, NoteContentPayload);
      setNote(data.note);
    })();
  }, [sessionId, noteId]);

  return (
    <PageShell
      identity={identity}
      currentSessionId={sessionId}
      eyebrow="Saved note"
      backTo={sessionId ? `/ses/${sessionId}/notes` : "/"}
      backLabel="Back to notes"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title, sessionStyles.title)}>Note #{noteId}</h1>
          {note ? (
            <p {...stylex.props(sessionStyles.idSub)}>{formatMessageTime(note.createdAt)}</p>
          ) : null}
        </>
      }
    >
      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}

      {note ? (
        <section {...stylex.props(card.base, queue.panel)}>
          <pre {...stylex.props(noteStyles.content)}>{note.content}</pre>
        </section>
      ) : !error ? (
        <p {...stylex.props(misc.empty)}>Loading…</p>
      ) : null}
    </PageShell>
  );
}
