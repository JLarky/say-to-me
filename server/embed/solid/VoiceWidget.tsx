import { createComponent, onCleanup as onStandardCleanup } from "solid-js";
import { render } from "solid-js/web";
// @ts-expect-error -- Solid omits declarations for the direct browser runtime.
import { createRenderEffect, createRoot, createSignal, onCleanup } from "solid-js/dist/solid.js";
import { Widget } from "./components/Widget.tsx";
import { VoiceNoteRow } from "./components/VoiceNoteRow.tsx";
import { enqueueVoiceAudio, resetVoiceAudioQueue } from "./voice-widget-audio.ts";
import { hasAutoplayPermission, playSendDing, warmSendDing } from "./voice-widget-sound.ts";
import {
  VOICE_WIDGET_DEFAULT_STORAGE_KEY,
  VOICE_WIDGET_BANNER_API_VERSION,
  VOICE_WIDGET_INSERT_USAGE_PROMPT_EVENT,
  VOICE_WIDGET_SOURCE,
  VOICE_WIDGET_SPEECH_ENDED_EVENT,
  VOICE_WIDGET_SPEECH_STARTED_EVENT,
  VOICE_WIDGET_VERSION,
  type VoiceWidgetAttributes,
} from "./voice-widget-contract.ts";
import {
  decideVoiceWidgetRevision,
  projectVoiceWidgetNotes,
  sayToMeSessionUrl,
  voiceWidgetUsagePrompt,
  type VoiceWidgetNote,
} from "./voice-widget-content.ts";

const SPEECH_TIMEOUT_MS = 120_000;
const PREFERRED_VOICES = [
  "Microsoft Emma Online (Natural) - English (United States)",
  "Google US English",
];

type SessionState = "loading" | "ready" | "missing" | "unavailable";
type Timer = {
  readonly id: number;
  readonly title: string;
  readonly message: string;
  readonly status: string;
  readonly nextFireAt: number;
  readonly intervalMs: number | null;
  readonly lastFiredAt?: number | null;
  readonly lastError?: string | null;
};

function timerDateTimeValue(timestamp: number): string {
  const offset = new Date(timestamp).getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}
function timerRepeatLabel(intervalMs: number | null): string {
  return intervalMs && intervalMs > 0
    ? `Repeats every ${Math.round(intervalMs / 60_000)}m`
    : "One-shot";
}
type VoiceWidgetProps = {
  readonly attributes: () => VoiceWidgetAttributes;
  readonly el: HTMLElement;
};

function icon(kind: "volume" | "up" | "down" | "clock"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute(
    "d",
    kind === "volume"
      ? "M11 5 6 9H3v6h3l5 4V5zm5.5 3.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"
      : kind === "up"
        ? "m6 15 6-6 6 6"
        : kind === "down"
          ? "m6 9 6 6 6-6"
          : "M12 7v5l3 2M12 3a9 9 0 1 0 9 9",
  );
  svg.append(path);
  return svg;
}

function button(label: string, className: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

function notesUrl(attributes: VoiceWidgetAttributes): string {
  return `${attributes["notes-base-url"].replace(/\/$/, "")}/${encodeURIComponent(attributes["session-id"])}`;
}

function timersUrl(attributes: VoiceWidgetAttributes): string {
  return `${attributes["timers-base-url"] ?? "/api/say-to-me-timers"}?sessionId=${encodeURIComponent(attributes["session-id"])}`;
}

function parsePayload(
  raw: unknown,
): { messages: ReadonlyArray<unknown>; revision?: unknown } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as { messages?: unknown; revision?: unknown };
  return Array.isArray(value.messages)
    ? { messages: value.messages, revision: value.revision }
    : null;
}

function parseSsePayload(raw: string): unknown {
  // SSE payloads are parsed only at the transport boundary and validated immediately by parsePayload.
  // eslint-disable-next-line no-restricted-properties
  return JSON.parse(raw) as unknown;
}

function timerRelativeLabel(nextFireAt: number, now: number): string {
  const seconds = Math.round((nextFireAt - now) / 1000);
  if (seconds <= 0) return "due now";
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve([]);
  const current = window.speechSynthesis.getVoices();
  if (current.length > 0) return Promise.resolve(current);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      window.clearTimeout(timeout);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish);
    const timeout = window.setTimeout(finish, 1_000);
  });
}

function chooseVoice(voices: ReadonlyArray<SpeechSynthesisVoice>): SpeechSynthesisVoice | null {
  return (
    PREFERRED_VOICES.map((name) => voices.find((voice) => voice.name === name)).find(
      (voice): voice is SpeechSynthesisVoice => Boolean(voice),
    ) ?? null
  );
}

function readCollapsed(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(storageKey: string, value: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // Storage can be unavailable in restricted embeds; the live state remains usable.
  }
}

export function VoiceWidget(props: VoiceWidgetProps): HTMLElement {
  let dispose = () => {};
  const root = createRoot((rootDispose: () => void) => {
    dispose = rootDispose;
    return createOwnedWidget(props);
  });
  onStandardCleanup(dispose);
  return root;
}

function createOwnedWidget(props: VoiceWidgetProps): HTMLElement {
  const attributes = props.attributes();
  const sessionId = attributes["session-id"];
  const hasConfig = Boolean(sessionId && attributes["notes-base-url"]);
  const [notes, setNotes] = createSignal<ReadonlyArray<VoiceWidgetNote>>([]);
  const [sessionState, setSessionState] = createSignal<SessionState>("loading");
  const [loaded, setLoaded] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [reloadToken, setReloadToken] = createSignal(0);
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  let timerBusy = false;
  let timerFormOpen = false;
  let editingTimerId: number | null = null;
  let timerTitle = "Check in";
  let timerMessage = "Please check in with me and report what needs attention.";
  let timerDueAt = timerDateTimeValue(Date.now() + 15 * 60_000);
  let timerRepeatMinutes = "";
  const [collapsed, setCollapsed] = createSignal(
    readCollapsed(attributes["storage-key"] ?? VOICE_WIDGET_DEFAULT_STORAGE_KEY),
  );
  const [timersOpen, setTimersOpen] = createSignal(false);
  const [timers, setTimers] = createSignal<ReadonlyArray<Timer>>([]);
  const [timerNow, setTimerNow] = createSignal(Date.now());
  const [showEnableSound, setShowEnableSound] = createSignal(false);
  props.el.dataset.bannerApiVersion = String(VOICE_WIDGET_BANNER_API_VERSION);
  let revision = -1;
  let disposed = false;
  let eventSource: EventSource | null = null;
  let playRequest = 0;
  let speechEventNoteId: string | null = null;
  let autoplayLock = false;
  const autoplayClaimed = new Set<string>();
  const rowDisposers: Array<() => void> = [];
  let timerRefresh: ReturnType<typeof setInterval> | undefined;
  let timerClock: ReturnType<typeof setInterval> | undefined;

  const root = document.createElement("section");
  root.className = "stm-voice-widget";
  root.dataset.testid = "say-to-me-banner";
  root.setAttribute("aria-label", "Say To Me");
  const toolbar = document.createElement("div");
  toolbar.className = "stm-voice-widget-toolbar";
  const toolbarMount = document.createElement("div");
  toolbarMount.className = "stm-voice-widget-toolbar-buttons";
  const toolbarDispose = render(
    () => createComponent(Widget, { sessionId, el: props.el }),
    toolbarMount,
  );
  const speaker = button("", "stm-voice-speaker");
  speaker.append(icon("volume"));
  const title = document.createElement("a");
  title.className = "stm-voice-widget-title";
  title.textContent = "Say To Me";
  title.target = "_blank";
  title.rel = "noreferrer";
  const timerButton = button("", "stm-voice-timer-toggle");
  timerButton.append(icon("clock"));
  const collapseButton = button("", "stm-voice-collapse");
  toolbar.append(speaker, title, toolbarMount, timerButton, collapseButton);
  const soundPrompt = document.createElement("div");
  soundPrompt.className = "stm-voice-sound-prompt";
  const soundText = document.createElement("span");
  soundText.textContent = "Enable sound to hear Say To Me notifications.";
  const enableSound = button("Enable sound", "stm-voice-enable-sound");
  soundPrompt.append(soundText, enableSound);
  const timerPanel = document.createElement("div");
  timerPanel.className = "stm-voice-timer-panel";
  const content = document.createElement("div");
  content.className = "stm-voice-widget-content";
  root.append(toolbar, soundPrompt, timerPanel, content);

  const emitUsagePrompt = () => {
    props.el.dispatchEvent(
      new CustomEvent(VOICE_WIDGET_INSERT_USAGE_PROMPT_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          source: VOICE_WIDGET_SOURCE,
          version: VOICE_WIDGET_VERSION,
          type: "insert-usage-prompt",
          prompt: voiceWidgetUsagePrompt(sessionId),
        },
      }),
    );
  };
  const updateStatus = (noteId: string, status: "speaking" | "played" | "stopped") => {
    setNotes((current: ReadonlyArray<VoiceWidgetNote>) =>
      current.map((note: VoiceWidgetNote) => (note.id === noteId ? { ...note, status } : note)),
    );
    if (!loaded() || !/^[0-9]+$/.test(noteId)) return;
    void fetch(`${notesUrl(attributes)}/messages/${encodeURIComponent(noteId)}/status`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => undefined);
  };
  const emitSpeech = (type: "speech-started" | "speech-ended", noteId: string) => {
    props.el.dataset.speechActive = type === "speech-started" ? "true" : "false";
    props.el.dispatchEvent(
      new CustomEvent(
        type === "speech-started"
          ? VOICE_WIDGET_SPEECH_STARTED_EVENT
          : VOICE_WIDGET_SPEECH_ENDED_EVENT,
        {
          bubbles: true,
          composed: true,
          detail: { source: VOICE_WIDGET_SOURCE, version: VOICE_WIDGET_VERSION, type, noteId },
        },
      ),
    );
  };
  const stop = () => {
    const active = playingId();
    playRequest += 1;
    autoplayLock = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    setPlayingId(null);
    if (speechEventNoteId) {
      emitSpeech("speech-ended", speechEventNoteId);
      speechEventNoteId = null;
    }
    if (active) updateStatus(active, "stopped");
  };
  const stopAll = () => {
    for (const note of notes()) {
      if (note.author === "agent" && note.status === "queued" && !autoplayClaimed.has(note.id)) {
        autoplayClaimed.add(note.id);
        updateStatus(note.id, "stopped");
      }
    }
    stop();
  };
  const play = (note: VoiceWidgetNote) => {
    stop();
    const request = playRequest;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      updateStatus(note.id, "played");
      autoplayLock = false;
      return;
    }
    void loadVoices().then((voices) => {
      if (disposed || request !== playRequest) return;
      const utterance = new SpeechSynthesisUtterance(note.text);
      const voice = chooseVoice(voices);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || "en-US";
      } else utterance.lang = "en-US";
      updateStatus(note.id, "speaking");
      emitSpeech("speech-started", note.id);
      speechEventNoteId = note.id;
      const finish = (status: "played" | "stopped") => {
        if (request !== playRequest) return;
        setPlayingId(null);
        autoplayLock = false;
        emitSpeech("speech-ended", note.id);
        speechEventNoteId = null;
        updateStatus(note.id, status);
      };
      utterance.onend = () => finish("played");
      utterance.onerror = (event) => {
        finish("stopped");
        if (event.error === "not-allowed") setShowEnableSound(true);
      };
      setPlayingId(note.id);
      void enqueueVoiceAudio(
        () =>
          new Promise<void>((resolve) => {
            if (request !== playRequest) {
              resolve();
              return;
            }
            utterance.addEventListener("end", () => resolve(), { once: true });
            utterance.addEventListener("error", () => resolve(), { once: true });
            window.speechSynthesis.speak(utterance);
          }),
        SPEECH_TIMEOUT_MS,
      );
    });
  };
  const playById = (id: string) => {
    const note = notes().find((item: VoiceWidgetNote) => item.id === id);
    if (note) play(note);
  };
  const onSpeaker = () => {
    if (playingId()) stopAll();
    else {
      const note = notes()[0];
      if (note) play(note);
    }
  };

  speaker.addEventListener("click", onSpeaker);
  timerButton.addEventListener("click", () => setTimersOpen((value: boolean) => !value));
  collapseButton.addEventListener("click", () => {
    const value = !collapsed();
    setCollapsed(value);
    writeCollapsed(attributes["storage-key"] ?? VOICE_WIDGET_DEFAULT_STORAGE_KEY, value);
  });
  enableSound.addEventListener("click", async () => {
    try {
      const warmed = await warmSendDing();
      const played = await playSendDing({ volumeScale: 0.01 });
      if (warmed || played || hasAutoplayPermission()) setShowEnableSound(false);
      else setShowEnableSound(true);
    } catch {
      setShowEnableSound(true);
    }
  });

  const clearRows = () => {
    while (rowDisposers.length) rowDisposers.pop()?.();
  };
  const renderRows = (items: ReadonlyArray<VoiceWidgetNote>) => {
    clearRows();
    content.replaceChildren();
    for (const note of items) {
      const mount = document.createElement("div");
      mount.className = "stm-voice-note-row-mount";
      const disposeRow = render(
        () =>
          createComponent(VoiceNoteRow, {
            note,
            isPlaying: () => playingId() === note.id,
            el: props.el,
            uiBaseUrl: attributes["ui-base-url"],
            onPlay: playById,
            onStop: stop,
          }),
        mount,
      );
      rowDisposers.push(disposeRow);
      content.append(mount);
    }
  };
  const timerAction = async (
    timer: Timer,
    action: "pause" | "resume" | "trigger" | "cancel",
  ): Promise<void> => {
    timerBusy = true;
    renderState();
    try {
      await fetch(
        `${(attributes["timers-base-url"] ?? "/api/say-to-me-timers").replace(/\/$/, "")}/${timer.id}/actions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      await loadTimers();
    } finally {
      timerBusy = false;
      renderState();
    }
  };
  const removeTimer = async (timer: Timer): Promise<void> => {
    timerBusy = true;
    renderState();
    try {
      await fetch(
        `${(attributes["timers-base-url"] ?? "/api/say-to-me-timers").replace(/\/$/, "")}/${timer.id}`,
        { method: "DELETE", credentials: "include" },
      );
      await loadTimers();
    } finally {
      timerBusy = false;
      renderState();
    }
  };
  const openTimerForm = (timer: Timer | null): void => {
    editingTimerId = timer?.id ?? null;
    timerFormOpen = true;
    timerTitle = timer?.title ?? "Check in";
    timerMessage = timer?.message ?? "Please check in with me and report what needs attention.";
    timerDueAt = timerDateTimeValue(timer?.nextFireAt ?? Date.now() + 15 * 60_000);
    timerRepeatMinutes = timer?.intervalMs ? String(Math.round(timer.intervalMs / 60_000)) : "";
    renderState();
  };
  const closeTimerForm = (): void => {
    timerFormOpen = false;
    editingTimerId = null;
    renderState();
  };
  const saveTimer = async (): Promise<void> => {
    const dueAt = new Date(timerDueAt).getTime();
    const intervalMs = timerRepeatMinutes.trim() ? Number(timerRepeatMinutes) * 60_000 : null;
    if (
      !timerTitle.trim() ||
      !timerMessage.trim() ||
      !Number.isFinite(dueAt) ||
      (intervalMs !== null && intervalMs < 60_000)
    )
      return;
    timerBusy = true;
    renderState();
    const base = (attributes["timers-base-url"] ?? "/api/say-to-me-timers").replace(/\/$/, "");
    const editing = editingTimerId !== null;
    try {
      await fetch(editing ? `${base}/${editingTimerId}` : base, {
        method: editing ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          title: timerTitle.trim(),
          message: timerMessage.trim(),
          dueAt,
          intervalMs,
        }),
      });
      timerFormOpen = false;
      editingTimerId = null;
      await loadTimers();
    } finally {
      timerBusy = false;
      renderState();
    }
  };
  const renderTimerPanel = (items: ReadonlyArray<Timer>) => {
    timerPanel.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "stm-voice-timer-heading";
    heading.textContent = "Scheduled timers";
    timerPanel.append(heading);
    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "stm-voice-timer-empty";
      empty.textContent = "No timers scheduled.";
      timerPanel.append(empty);
    }
    for (const timer of items) {
      const row = document.createElement("div");
      row.className = "stm-voice-timer-row";
      const name = document.createElement("strong");
      name.textContent = timer.title;
      const state = document.createElement("span");
      state.textContent = timer.status;
      const due = document.createElement("span");
      due.textContent = timerRelativeLabel(timer.nextFireAt, timerNow());
      const repeat = document.createElement("span");
      repeat.textContent = timerRepeatLabel(timer.intervalMs);
      row.append(name, state, due, repeat);
      const actions = document.createElement("div");
      actions.className = "stm-voice-timer-actions";
      const add = (label: string, disabled: boolean, handler: () => void) => {
        const control = button(label, "stm-voice-action");
        control.disabled = timerBusy || disabled;
        control.setAttribute("aria-label", `${label} timer ${timer.title}`);
        control.addEventListener("click", handler);
        actions.append(control);
      };
      add("Trigger now", timer.status !== "active", () => void timerAction(timer, "trigger"));
      add(
        "Pause",
        timer.status !== "active" && timer.status !== "firing",
        () => void timerAction(timer, "pause"),
      );
      add("Resume", timer.status !== "paused", () => void timerAction(timer, "resume"));
      add("Edit", timer.status === "completed" || timer.status === "cancelled", () =>
        openTimerForm(timer),
      );
      add(
        "Stop",
        timer.status === "cancelled" || timer.status === "completed",
        () => void timerAction(timer, "cancel"),
      );
      add("Delete", false, () => void removeTimer(timer));
      row.append(actions);
      timerPanel.append(row);
      if (timer.lastFiredAt) {
        const last = document.createElement("span");
        last.textContent = `Last fired ${new Date(timer.lastFiredAt).toLocaleString()}`;
        row.append(last);
      }
      if (timer.lastError) {
        const error = document.createElement("span");
        error.textContent = timer.lastError;
        row.append(error);
      }
    }
    const footer = document.createElement("div");
    footer.className = "stm-voice-timer-footer";
    if (!timerFormOpen) {
      const create = button("Create new timer", "stm-voice-action");
      create.addEventListener("click", () => openTimerForm(null));
      footer.append(create);
    } else {
      const heading = document.createElement("p");
      heading.textContent = editingTimerId === null ? "Create new timer" : "Edit timer";
      footer.append(heading);
      const title = document.createElement("input");
      title.type = "text";
      title.value = timerTitle;
      title.placeholder = "Timer title";
      title.setAttribute("aria-label", "Timer title");
      title.addEventListener("input", () => {
        timerTitle = title.value;
      });
      const message = document.createElement("textarea");
      message.rows = 2;
      message.value = timerMessage;
      message.placeholder = "Message to send";
      message.setAttribute("aria-label", "Timer message");
      message.addEventListener("input", () => {
        timerMessage = message.value;
      });
      const due = document.createElement("input");
      due.type = "datetime-local";
      due.value = timerDueAt;
      due.setAttribute("aria-label", "Timer due time");
      due.addEventListener("input", () => {
        timerDueAt = due.value;
      });
      const repeat = document.createElement("input");
      repeat.type = "number";
      repeat.min = "1";
      repeat.value = timerRepeatMinutes;
      repeat.placeholder = "Repeat minutes (optional)";
      repeat.setAttribute("aria-label", "Timer repeat minutes");
      repeat.addEventListener("input", () => {
        timerRepeatMinutes = repeat.value;
      });
      const save = button(
        editingTimerId === null ? "Create timer" : "Save timer",
        "stm-voice-action",
      );
      save.disabled = timerBusy || !timerTitle.trim() || !timerMessage.trim();
      save.addEventListener("click", () => void saveTimer());
      const close = button("Close", "stm-voice-action");
      close.disabled = timerBusy;
      close.addEventListener("click", closeTimerForm);
      footer.append(title, message, due, repeat, save, close);
    }
    timerPanel.append(footer);
  };
  const renderState = () => {
    const isCollapsed = collapsed();
    root.dataset.collapsed = String(isCollapsed);
    props.el.dataset.speechActive = playingId() ? "true" : "false";
    root.classList.toggle("stm-voice-widget--collapsed", isCollapsed);
    speaker.setAttribute(
      "aria-label",
      playingId() ? "Stop all speech" : "Play most recent voice note",
    );
    speaker.title = playingId() ? "Stop all speech" : "Play most recent voice note";
    speaker.dataset.speaking = playingId() ? "true" : "false";
    const sessionUrl = sayToMeSessionUrl(sessionId, attributes["ui-base-url"]);
    if (sessionUrl) title.href = sessionUrl;
    else title.removeAttribute("href");
    timerButton.setAttribute("aria-label", "Show timers");
    timerButton.title = "Show timers";
    collapseButton.setAttribute("aria-expanded", String(!isCollapsed));
    collapseButton.setAttribute(
      "aria-label",
      isCollapsed ? "Expand Say To Me" : "Collapse Say To Me",
    );
    collapseButton.title = isCollapsed ? "Expand Say To Me" : "Collapse Say To Me";
    collapseButton.replaceChildren(
      icon(isCollapsed ? "down" : "up"),
      document.createTextNode(isCollapsed ? "Expand" : "Collapse"),
    );
    soundPrompt.hidden = !showEnableSound();
    timerPanel.hidden = !timersOpen() || isCollapsed;
    if (isCollapsed) {
      content.hidden = true;
    } else {
      content.hidden = false;
    }
    content.replaceChildren();
    if (sessionState() === "missing") {
      const message = document.createElement("p");
      message.textContent = "No voice session exists for this thread yet.";
      message.className = "stm-voice-widget-missing";
      const create = button(
        creating() ? "Creating..." : "Create voice session",
        "stm-voice-action",
      );
      create.disabled = creating();
      create.addEventListener("click", createSession);
      content.append(message, create);
    } else if (sessionState() === "unavailable") {
      const message = document.createElement("p");
      message.textContent = "Say To Me is unavailable.";
      message.className = "stm-voice-widget-unavailable";
      const retry = button("Retry", "stm-voice-action");
      retry.addEventListener("click", () => {
        setSessionState("loading");
        setLoaded(false);
        setReloadToken((value: number) => value + 1);
      });
      content.append(message, retry);
    } else if (!loaded()) {
      const message = document.createElement("p");
      message.textContent = "Loading voice notes...";
      content.append(message);
    } else if (notes().length === 0) {
      const message = document.createElement("p");
      message.textContent = "No voice notes yet.";
      const usage = button("Tell your agent how to use Say To Me", "stm-voice-action");
      usage.addEventListener("click", emitUsagePrompt);
      content.append(message, usage);
    } else {
      renderRows(notes());
    }
    renderTimerPanel(timers());
  };
  async function createSession(): Promise<void> {
    setCreating(true);
    try {
      const response = await fetch(notesUrl(attributes), {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        setSessionState("unavailable");
        return;
      }
      setSessionState("loading");
      setReloadToken((value: number) => value + 1);
    } catch {
      setSessionState("unavailable");
    } finally {
      setCreating(false);
    }
  }
  async function loadTimers(): Promise<void> {
    try {
      const response = await fetch(timersUrl(attributes), { credentials: "include" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { timers?: Timer[] };
      setTimers(Array.isArray(payload.timers) ? payload.timers : []);
    } catch {
      setTimers([]);
    } finally {
    }
  }
  createRenderEffect(() => {
    renderState();
  });
  createRenderEffect(() => {
    reloadToken();
    let cancelled = false;
    eventSource?.close();
    eventSource = null;
    setSessionState("loading");
    setLoaded(false);
    revision = -1;
    if (!hasConfig) {
      setSessionState("unavailable");
      return;
    }
    const apply = (raw: unknown) => {
      const payload = parsePayload(raw);
      if (!payload || cancelled) return;
      const decision = decideVoiceWidgetRevision(revision, payload.revision);
      if (!decision.accepted) return;
      revision = decision.revision;
      setNotes(projectVoiceWidgetNotes(payload as Parameters<typeof projectVoiceWidgetNotes>[0]));
      setLoaded(true);
    };
    void fetch(notesUrl(attributes), { credentials: "include" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 404) {
          setSessionState("missing");
          return;
        }
        if (!response.ok) {
          setSessionState("unavailable");
          return;
        }
        setSessionState("ready");
        apply(await response.json());
        if (typeof EventSource !== "undefined") {
          eventSource = new EventSource(`${notesUrl(attributes)}/events`, {
            withCredentials: true,
          });
          const handler = (event: MessageEvent<string>) => {
            try {
              apply(parseSsePayload(event.data));
            } catch {
              /* reconnect/catch-up remains EventSource-owned */
            }
          };
          eventSource.addEventListener("snapshot", handler);
          eventSource.addEventListener("message", handler);
        }
      })
      .catch(() => {
        if (!cancelled) setSessionState("unavailable");
      });
    onCleanup(() => {
      cancelled = true;
      eventSource?.close();
      eventSource = null;
    });
  });
  createRenderEffect(() => {
    const current = notes();
    if (!loaded() || playingId() || autoplayLock) return;
    const next = current
      .slice()
      .reverse()
      .find(
        (note: VoiceWidgetNote) =>
          note.author === "agent" && note.status === "queued" && !autoplayClaimed.has(note.id),
      );
    if (!next) return;
    autoplayClaimed.add(next.id);
    autoplayLock = true;
    play(next);
  });
  const storageKey = attributes["storage-key"] ?? VOICE_WIDGET_DEFAULT_STORAGE_KEY;
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey && event.newValue !== null)
      setCollapsed(event.newValue === "true");
  };
  window.addEventListener("storage", onStorage);
  if (hasConfig) void loadTimers();
  timerRefresh = setInterval(() => {
    void loadTimers();
    setTimerNow(Date.now());
  }, 15_000);
  timerClock = setInterval(() => setTimerNow(Date.now()), 1_000);
  onCleanup(() => {
    playRequest += 1;
    resetVoiceAudioQueue();
    disposed = true;
    window.removeEventListener("storage", onStorage);
    clearInterval(timerRefresh);
    clearInterval(timerClock);
    eventSource?.close();
    clearRows();
    toolbarDispose();
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
  });
  return root;
}
