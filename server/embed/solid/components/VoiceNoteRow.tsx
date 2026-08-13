import { createRoot as createStandardRoot, onCleanup as onStandardCleanup } from "solid-js";
// @ts-expect-error -- Solid omits declarations for the direct browser runtime.
import { createRenderEffect, createRoot, createSignal, onCleanup } from "solid-js/dist/solid.js";
import { VoiceNoteAttachments } from "./VoiceNoteAttachments.tsx";
import { VoiceNoteMarkdown } from "./VoiceNoteMarkdown.tsx";
import { VoiceNoteSessionCard } from "./VoiceNoteSessionCard.tsx";
import { VoiceNoteStatusBadge } from "./VoiceNoteStatusBadge.tsx";
import { formatSayToMeTimestamp, type VoiceWidgetUiBaseUrl } from "../voice-widget-content.ts";
import type { VoiceWidgetNote } from "../voice-widget-content.ts";

const COPY_CONFIRMATION_MS = 1_200;
const SVG_NS = "http://www.w3.org/2000/svg";

export type VoiceNoteRowProps = {
  readonly note: VoiceWidgetNote | (() => VoiceWidgetNote | null);
  readonly isPlaying?: boolean | (() => boolean);
  readonly el: HTMLElement;
  readonly uiBaseUrl?: VoiceWidgetUiBaseUrl;
  readonly onPlay?: (noteId: string) => void;
  readonly onStop?: (noteId: string) => void;
};

function icon(kind: "check" | "copy" | "play" | "stop"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("fill", kind === "play" || kind === "stop" ? "currentColor" : "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute(
    "d",
    kind === "check"
      ? "M20 6 9 17l-5-5"
      : kind === "copy"
        ? "M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
        : kind === "play"
          ? "m6 3 14 9-14 9V3z"
          : "M6 6h12v12H6z",
  );
  svg.append(path);
  return svg;
}

export function VoiceNoteRow(props: VoiceNoteRowProps): HTMLElement {
  let dispose = () => {};
  const row = createRoot((rootDispose: () => void) => {
    dispose = rootDispose;
    return createVoiceNoteRow(props);
  });
  onStandardCleanup(dispose);
  return row;
}

function createVoiceNoteRow(props: VoiceNoteRowProps): HTMLElement {
  const getNote = () => (typeof props.note === "function" ? props.note() : props.note);
  const getIsPlaying = () =>
    typeof props.isPlaying === "function" ? props.isPlaying() : (props.isPlaying ?? false);
  const [isCopied, setIsCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const childDisposers: Array<() => void> = [];

  function mountStandard<T>(factory: () => T): T {
    let disposeChild = () => {};
    const value = createStandardRoot((rootDispose) => {
      disposeChild = rootDispose;
      return factory();
    });
    childDisposers.push(disposeChild);
    return value;
  }

  function disposeChildren(): void {
    while (childDisposers.length > 0) childDisposers.pop()?.();
  }

  const row = document.createElement("article");
  row.className = "stm-voice-note-row";
  row.dataset.testid = "voice-note-row";
  const body = document.createElement("div");
  body.className = "stm-voice-note-row-body";
  const content = document.createElement("div");
  content.className = "stm-voice-note-row-content";
  const meta = document.createElement("div");
  meta.className = "stm-voice-note-row-meta";
  const id = document.createElement("code");
  id.className = "stm-voice-note-row-id";
  const author = document.createElement("span");
  author.className = "stm-voice-note-row-author";
  const time = document.createElement("time");
  time.className = "stm-voice-note-row-time";
  const status = VoiceNoteStatusBadge({
    status: () => getNote()?.status ?? "unknown",
    isPlaying: getIsPlaying,
  });
  meta.append(id, author, time, status);

  const text = document.createElement("p");
  text.className = "stm-voice-note-row-text";

  const extra = document.createElement("div");
  extra.className = "stm-voice-note-extra-markdown";
  extra.dataset.testid = "say-to-me-extra-markdown";
  const extraHeader = document.createElement("div");
  extraHeader.className = "stm-voice-note-extra-markdown-header";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "stm-voice-note-copy-markdown";
  copy.addEventListener("click", () => void copyExtraMarkdown());
  extraHeader.append(copy);
  extra.append(extraHeader);

  const sessions = document.createElement("div");
  sessions.className = "stm-voice-note-row-sessions";
  const attachments = document.createElement("div");
  attachments.className = "stm-voice-note-row-attachments";
  content.append(meta, text, extra, sessions, attachments);

  const actions = document.createElement("div");
  actions.className = "stm-voice-note-row-actions";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "stm-voice-note-play";
  play.dataset.testid = "voice-note-play-button";
  play.addEventListener("click", () => {
    const note = getNote();
    if (note) props.onPlay?.(note.id);
  });
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "stm-voice-note-stop";
  stop.dataset.testid = "voice-note-stop-button";
  stop.append(icon("stop"));
  stop.addEventListener("click", () => {
    const note = getNote();
    if (note) props.onStop?.(note.id);
  });
  actions.append(play, stop);
  body.append(content, actions);
  row.append(body);

  function updateCopy(): void {
    const copied = isCopied();
    copy.replaceChildren(icon(copied ? "check" : "copy"));
    copy.setAttribute("aria-label", copied ? "Copied extra markdown" : "Copy extra markdown");
    copy.title = copied ? "Copied" : "Copy extra markdown";
    copy.classList.toggle("stm-voice-note-copy-markdown--copied", copied);
  }

  async function copyExtraMarkdown(): Promise<void> {
    const markdown = getNote()?.extraMarkdown;
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    if (disposed) return;
    clearTimeout(resetTimer);
    setIsCopied(true);
    updateCopy();
    resetTimer = setTimeout(() => {
      setIsCopied(false);
      updateCopy();
    }, COPY_CONFIRMATION_MS);
  }

  const update = (): void => {
    const note = getNote();
    row.hidden = !note;
    if (!note) {
      row.replaceChildren();
      return;
    }
    row.replaceChildren(body);
    row.dataset.noteId = note.id;
    id.textContent = "#" + note.id;
    author.textContent = note.author;
    time.textContent = formatSayToMeTimestamp(note.time);
    time.dateTime = note.time;
    text.textContent = note.text;

    extra.hidden = !(typeof note.extraMarkdown === "string" && note.extraMarkdown.trim());
    extra.replaceChildren(extraHeader);
    if (extra.hidden === false && note.extraMarkdownHtml) {
      extra.append(mountStandard(() => VoiceNoteMarkdown({ html: note.extraMarkdownHtml })));
    }

    disposeChildren();
    sessions.replaceChildren(
      ...note.sessions.map((session) =>
        mountStandard(() =>
          VoiceNoteSessionCard({ session: session as never, uiBaseUrl: props.uiBaseUrl }),
        ),
      ),
    );
    const attachment = VoiceNoteAttachments({
      attachments: note.attachments,
      uiBaseUrl: props.uiBaseUrl,
    });
    attachments.replaceChildren();
    if (attachment) attachments.append(attachment);
    attachments.hidden = !attachment;

    actions.hidden = note.author !== "agent";
    const playing = getIsPlaying();
    row.dataset.playing = playing ? "true" : "false";
    play.replaceChildren(icon("play"), document.createTextNode(playing ? "Restart" : "Play"));
    play.setAttribute(
      "aria-label",
      (playing ? "Restart" : "Play") + " voice note from " + note.author,
    );
    stop.setAttribute("aria-label", "Stop voice note from " + note.author);
    stop.disabled = !playing;
    updateCopy();
  };

  onCleanup(() => {
    disposed = true;
    clearTimeout(resetTimer);
    disposeChildren();
  });
  createRenderEffect(update);
  return row;
}
