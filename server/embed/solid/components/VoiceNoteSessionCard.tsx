import { createRenderEffect, createSignal, onCleanup } from "solid-js";
import { VoiceSessionWaitingBadge } from "./VoiceSessionWaitingBadge.tsx";
import {
  formatSayToMeTimestamp,
  sayToMeSessionUrl,
  type VoiceWidgetUiBaseUrl,
  voiceWidgetSessionDisplayName,
} from "../voice-widget-content.ts";

const COPY_CONFIRMATION_MS = 2_000;

export type VoiceNoteSession = {
  readonly id: string;
  readonly alias?: string | null;
  readonly title?: string | null;
  readonly summary?: string | null;
  readonly summaryUpdatedAt?: string | null;
  readonly waitingState?: string | null;
  readonly latestActivity?: string | null;
  readonly messageCount?: number | null;
};

export function VoiceNoteSessionCard(props: {
  readonly session: VoiceNoteSession | (() => VoiceNoteSession);
  readonly uiBaseUrl?: VoiceWidgetUiBaseUrl;
}): HTMLElement {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- props.session is the declared `VoiceNoteSession | (() => VoiceNoteSession)` union; typeof narrows the already-typed union.
  const getSession = () => (typeof props.session === "function" ? props.session() : props.session);
  const [isCopied, setIsCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const card = document.createElement("div");
  card.className = "stm-voice-session-card";
  const header = document.createElement("div");
  header.className = "stm-voice-session-card-header";
  const name = document.createElement("strong");
  name.className = "stm-voice-session-card-name";
  const waiting = VoiceSessionWaitingBadge({ waitingState: () => getSession().waitingState });
  const latest = document.createElement("span");
  latest.className = "stm-voice-session-card-latest";
  header.append(name, waiting, latest);
  const actions = document.createElement("div");
  actions.className = "stm-voice-session-card-actions";
  const open = document.createElement("a");
  open.className = "stm-voice-session-card-open";
  open.textContent = "Open";
  open.target = "_blank";
  open.rel = "noreferrer";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "stm-voice-session-card-copy";
  actions.append(open, copy);
  const summary = document.createElement("p");
  summary.className = "stm-voice-session-card-summary";
  const details = document.createElement("details");
  details.className = "stm-voice-session-card-details";
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = "Details";
  const id = document.createElement("p");
  id.className = "stm-voice-session-card-id";
  const messages = document.createElement("p");
  details.append(detailsSummary, id, messages);
  card.append(header, actions, summary, details);

  onCleanup(() => {
    disposed = true;
    clearTimeout(resetTimer);
  });

  const updateSession = () => {
    const session = getSession();
    name.textContent = voiceWidgetSessionDisplayName(session);
    const sessionUrl = sayToMeSessionUrl(session.id, props.uiBaseUrl);
    if (sessionUrl) {
      open.href = sessionUrl;
      open.hidden = false;
    } else {
      open.removeAttribute("href");
      open.hidden = true;
    }
    const latestActivity = session.latestActivity ?? session.summaryUpdatedAt;
    latest.textContent = latestActivity ? `Latest: ${formatSayToMeTimestamp(latestActivity)}` : "";
    latest.hidden = !latestActivity;
    summary.hidden = !session.summary;
    summary.textContent = session.summary
      ? `Last update: ${session.summary.replace(/^Last update:\s*/i, "")}`
      : "";
    id.textContent = session.id;
    messages.hidden = session.messageCount === null || session.messageCount === undefined;
    messages.textContent = messages.hidden ? "" : `${session.messageCount} messages`;
  };
  updateSession();
  createRenderEffect(updateSession);

  async function copyMention(): Promise<void> {
    const session = getSession();
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      console.error("[say-to-me-widget] Clipboard API unavailable");
      return;
    }
    const mention = session.alias
      ? `say-to-me(${session.id}, ${session.alias})`
      : `say-to-me(${session.id})`;
    try {
      await clipboard.writeText(mention);
      if (disposed) return;
      clearTimeout(resetTimer);
      setIsCopied(true);
      updateCopy();
      resetTimer = setTimeout(() => {
        setIsCopied(false);
        updateCopy();
      }, COPY_CONFIRMATION_MS);
    } catch (error) {
      console.error("[say-to-me-widget] Failed to copy session mention", error);
    }
  }
  copy.addEventListener("click", () => void copyMention());
  const updateCopy = () => {
    const label = isCopied() ? "Copied" : "Copy mention";
    copy.textContent = label;
  };
  updateCopy();
  createRenderEffect(updateCopy);
  return card;
}
