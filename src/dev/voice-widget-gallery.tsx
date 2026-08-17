import { createComponent } from "solid-js";
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- Development gallery records arbitrary computed-style observations for diagnostics. */
// @ts-expect-error -- Solid omits declarations for the direct browser runtime.
import { createRoot as createBrowserSolidRoot } from "solid-js/dist/solid.js";
import { render } from "solid-js/web";
import { Widget } from "../../server/embed/solid/components/Widget.tsx";
import { VoiceNoteRow } from "../../server/embed/solid/components/VoiceNoteRow.tsx";
import { VoiceWidget } from "../../server/embed/solid/VoiceWidget.tsx";
import { registerWidget } from "../../server/embed/solid/widget-register.tsx";
import { VoiceNoteAttachments } from "../../server/embed/solid/components/VoiceNoteAttachments.tsx";
import { VoiceNoteMarkdown } from "../../server/embed/solid/components/VoiceNoteMarkdown.tsx";
import { VOICE_NOTE_MARKDOWN_STYLES } from "../../server/embed/solid/components/VoiceNoteMarkdown.styles.ts";
import { VoiceNoteSessionCard } from "../../server/embed/solid/components/VoiceNoteSessionCard.tsx";
import { VoiceNoteStatusBadge } from "../../server/embed/solid/components/VoiceNoteStatusBadge.tsx";
import { VoiceSessionWaitingBadge } from "../../server/embed/solid/components/VoiceSessionWaitingBadge.tsx";
import {
  WIDGET_STYLESHEET,
  ensureWidgetStylesheet,
} from "../../server/embed/solid/widget-styles.ts";
import {
  VOICE_WIDGET_STYLESHEET,
  ensureVoiceWidgetStylesheet,
} from "../../server/embed/solid/voice-widget-styles.ts";
import "./voice-widget-gallery.css";

const image = (id: number, originalName: string) => ({
  id,
  mimeType: "image/png",
  originalName,
  thumbnailDataUrl:
    "data:image/png;base64,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",
});

export const GALLERY_ATTACHMENT_FIXTURES = {
  single: [image(101, "single.png")],
  multiple: [image(102, "first.png"), image(103, "second.png")],
  filtered: [
    { id: 104, mimeType: "audio/mpeg", originalName: "audio.mp3" },
    { id: 105, mimeType: "image/png", originalName: "missing-thumbnail.png", thumbnailDataUrl: "" },
    image(106, "kept.png"),
  ],
  malformed: [
    null,
    "not-an-attachment",
    { id: "bad", originalName: "bad.png" },
    image(107, "valid.png"),
  ],
} as const;

export const GALLERY_EXTRA_MARKDOWN_SOURCE = `**voice note**\n\n| A | B |\n|---|---|\n| true | false |\n\n[docs](https://example.com)\n\n<script>alert('xss')</script>[bad](javascript:alert('xss'))`;

export const GALLERY_COMPONENTS = {
  VoiceNoteRow,
  VoiceWidget,
  VoiceNoteAttachments,
  VoiceNoteMarkdown,
  VoiceNoteSessionCard,
  VoiceNoteStatusBadge,
  VoiceSessionWaitingBadge,
} as const;

function heading(tag: "h1" | "h2" | "h3", text: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function story(title: string, description: string, content: HTMLElement): HTMLElement {
  const element = document.createElement("article");
  element.className = "stm-gallery-story";
  element.append(heading("h3", title));
  const copy = document.createElement("p");
  copy.textContent = description;
  element.append(copy, content);
  return element;
}

function frame(...classes: string[]): HTMLElement {
  const element = document.createElement("div");
  element.className = ["stm-gallery-frame", ...classes].filter(Boolean).join(" ");
  if (classes.includes("stm-gallery-frame--dark")) element.dataset.theme = "dark";
  return element;
}

export type GalleryGeometryViolation = { label: string; reason: string };
export function galleryGeometryViolations(root: HTMLElement): GalleryGeometryViolation[] {
  const violations: GalleryGeometryViolation[] = [];
  const rect = (element: Element) => element.getBoundingClientRect();
  const contains = (outer: DOMRect, inner: DOMRect) =>
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom;
  const widgets = [...root.querySelectorAll(".stm-gallery-story")].flatMap((story) => {
    const widget = story.querySelector("say-to-me-widget");
    const frame = story.querySelector(".stm-gallery-frame");
    return widget && frame
      ? [{ label: story.querySelector("h3")?.textContent ?? "whole widget", widget, frame }]
      : [];
  });
  for (const item of widgets) {
    const frameRect = rect(item.frame);
    const widgetRect = rect(item.widget);
    if (!contains(frameRect, widgetRect))
      violations.push({ label: item.label, reason: "widget escapes frame" });
    for (const control of item.widget.querySelectorAll("button, a, input, textarea"))
      if (!contains(widgetRect, rect(control)))
        violations.push({ label: item.label, reason: "control escapes widget" });
    const text = item.widget.querySelector(".stm-voice-widget-content");
    if (
      text &&
      text.scrollHeight > text.clientHeight &&
      getComputedStyle(text).overflowY === "hidden"
    )
      violations.push({ label: item.label, reason: "content is clipped" });
  }
  for (let left = 0; left < widgets.length; left += 1)
    for (let right = left + 1; right < widgets.length; right += 1) {
      const a = rect(widgets[left]!.frame);
      const b = rect(widgets[right]!.frame);
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
        violations.push({
          label: `${widgets[left]!.label} / ${widgets[right]!.label}`,
          reason: "fixture rectangles intersect",
        });
    }
  return violations;
}

type GallerySection = { root: HTMLElement; grid: HTMLElement };

function section(title: string, description: string): GallerySection {
  const root = document.createElement("section");
  root.className = "stm-gallery-section";
  root.append(heading("h2", title));
  const copy = document.createElement("p");
  copy.textContent = description;
  root.append(copy);
  const grid = document.createElement("div");
  grid.className = "stm-gallery-grid stm-gallery-grid--two";
  root.append(grid);
  return { root, grid };
}

let widgetRegistered = false;
let galleryLiveMode = false;
function ensureRegisteredWidget(): void {
  if (widgetRegistered) return;
  registerWidget();
  widgetRegistered = true;
}

function appendToolbar(parent: HTMLElement, sessionId: string | null): void {
  const host = document.createElement("div");
  host.className = "stm-gallery-toolbar";
  render(() => createComponent(Widget, { sessionId, el: host }), host);
  parent.append(host);
}

export function galleryStorageKey(sessionId: string, fixtureId = sessionId): string {
  return `stm-gallery-fixture-collapsed:${fixtureId}`;
}

function appendActualWidget(
  parent: HTMLElement,
  sessionId: string,
  fixtureId = sessionId,
): HTMLElement {
  ensureRegisteredWidget();
  const host = document.createElement("say-to-me-widget");
  host.className = "stm-gallery-production-widget";
  parent.classList.add("stm-gallery-frame--whole-widget");
  host.setAttribute("session-id", sessionId);
  host.setAttribute(
    "notes-base-url",
    galleryLiveMode ? "/api/voice-notes" : "/dev/voice-notes-fixture",
  );
  host.setAttribute(
    "timers-base-url",
    galleryLiveMode ? "/api/say-to-me-timers" : "/dev/say-to-me-timers-fixture",
  );
  host.dataset.testid = "whole-widget-fixture";
  host.setAttribute("ui-base-url", "https://say.localhost:1311");
  host.setAttribute("storage-key", galleryStorageKey(sessionId, fixtureId));
  parent.append(host);
  return host;
}

function mountSolid<T>(factory: () => T): T {
  return factory();
}

function mountBrowserSolid<T>(factory: () => T): T {
  return createBrowserSolidRoot(() => factory());
}

function appendBadge(parent: HTMLElement, badge: HTMLElement): void {
  parent.append(badge);
}
function appendSessionCard(parent: HTMLElement, session: Record<string, unknown>): HTMLElement {
  const card = mountSolid(() => VoiceNoteSessionCard({ session: session as never }));
  parent.append(card);
  return card;
}

function appendAttachments(parent: HTMLElement, attachments: ReadonlyArray<unknown>): void {
  const element = mountBrowserSolid(() => VoiceNoteAttachments({ attachments }));
  if (element) parent.append(element);
  else parent.append(document.createTextNode("null (empty input)"));
}

function appendMarkdown(parent: HTMLElement, html: string, compact = false): void {
  parent.append(mountSolid(() => VoiceNoteMarkdown({ html, compact })));
}

function knownDifferences(): HTMLElement {
  const panel = document.createElement("aside");
  panel.className = "stm-gallery-known";
  panel.append(heading("h2", "Known differences / unchecked"));
  const list = document.createElement("ul");
  for (const text of [
    "Gallery frames provide inspection layout only; production widget CSS remains component-owned.",
    "Raw HTML and unsafe URL examples are intentionally shown as sanitized output, not executable markup.",
    "Visual parity against T3 screenshots is not checked here; compare hover, pressed, focus-visible, and compact-height states manually.",
    "Attachment thumbnails use local data URLs and cannot prove a live attachment endpoint from this fixture page.",
  ]) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  panel.append(list);
  return panel;
}

function installGalleryFixtureTransport(markdownHtml: string): void {
  const originalFetch = window.fetch.bind(window);
  const note = {
    id: 9001,
    author: "agent",
    createdAt: "2026-08-02 12:00:00",
    text: "A complete STM-owned voice note with collapsed   whitespace.",
    extraMarkdown: GALLERY_EXTRA_MARKDOWN_SOURCE,
    extraMarkdownHtml: markdownHtml,
    status: "played",
    attachments: GALLERY_ATTACHMENT_FIXTURES.multiple,
    sessions: [
      {
        id: "ses_note_fixture",
        alias: "Note session",
        summary: "Session summary",
        waitingState: "needs_answer",
        messageCount: 6,
      },
    ],
  };
  const createdFixtureSessions = new Set<string>();
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    if (url.includes("/dev/voice-notes-fixture/")) {
      const fixtureSession = decodeURIComponent(
        url.split("/dev/voice-notes-fixture/")[1]?.split("/")[0] ?? "",
      );
      if (init?.method === "POST" && url.includes("/status"))
        return Promise.resolve(new Response("{}", { status: 200 }));
      if (init?.method === "POST") {
        createdFixtureSessions.add(fixtureSession);
        return Promise.resolve(new Response("{}", { status: 201 }));
      }
      if (fixtureSession.includes("unavailable"))
        return Promise.resolve(new Response("", { status: 503 }));
      if (fixtureSession.includes("missing") && !createdFixtureSessions.has(fixtureSession))
        return Promise.resolve(new Response("", { status: 404 }));
      if (fixtureSession.includes("empty"))
        return Promise.resolve(
          new Response(JSON.stringify({ messages: [], revision: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      const response = new Response(JSON.stringify({ messages: [note], revision: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      return fixtureSession.includes("loading")
        ? new Promise((resolve) => setTimeout(() => resolve(response), 150))
        : Promise.resolve(response);
    }
    if (url.includes("/dev/say-to-me-timers-fixture"))
      return Promise.resolve(
        new Response(JSON.stringify({ timers: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    return originalFetch(input, init);
  };
  class GalleryEventSource extends EventTarget {
    static readonly instances: GalleryEventSource[] = [];
    readonly url: string;
    readonly withCredentials = true;
    constructor(url: string) {
      super();
      this.url = url;
      GalleryEventSource.instances.push(this);
    }
    close(): void {
      this.dispatchEvent(new Event("close"));
    }
  }
  (window as Window & typeof globalThis).EventSource =
    GalleryEventSource as unknown as typeof EventSource;
}
export function mountVoiceWidgetGallery(
  root: HTMLElement | null,
  options: {
    includeToolbar?: boolean;
    includeProductionNote?: boolean;
    markdownHtml?: string;
    mode?: "fixture" | "live";
  } = {},
): void {
  if (!root) return;
  galleryLiveMode = options.mode === "live";
  if (!galleryLiveMode) installGalleryFixtureTransport(options.markdownHtml ?? "");
  ensureWidgetStylesheet();
  const voiceStyles = document.createElement("style");
  voiceStyles.dataset.stmGalleryStyles = "voice-widget";
  ensureVoiceWidgetStylesheet();
  voiceStyles.textContent = VOICE_WIDGET_STYLESHEET + "\n" + VOICE_NOTE_MARKDOWN_STYLES;
  document.head.append(voiceStyles);
  const widgetStyleMarker = document.createElement("meta");
  widgetStyleMarker.name = "stm-gallery-production-style-source";
  widgetStyleMarker.content = WIDGET_STYLESHEET.slice(0, 50);
  document.head.append(widgetStyleMarker);

  root.replaceChildren();
  const gallery = document.createElement("div");
  gallery.className = "stm-gallery";
  const header = document.createElement("header");
  header.className = "stm-gallery-header";
  header.append(heading("h1", "STM Voice Widget preservation gallery"));
  const intro = document.createElement("p");
  intro.innerHTML =
    "Development-only manual gallery at <code>/dev/voice-widget-components</code>. These are the current main-branch Solid components, mounted directly with fixed fixtures.";
  const instructions = document.createElement("p");
  instructions.className = "stm-gallery-instruction";
  instructions.textContent =
    "Check every focusable control with Tab, inspect hover and pressed states, open Details, click the ID control to see the copied icon, and resize each frame to compare desktop, narrow, short-height, light, and dark contexts.";
  header.append(intro, instructions);
  gallery.append(header);
  const states = section(
    "Whole widget state machine",
    "Each fixture is one complete registered say-to-me-widget: loading, missing/create, unavailable/retry, empty/usage, and ready.",
  );
  states.grid.className = "stm-gallery-grid stm-gallery-grid--three";
  for (const [label, sessionId, description] of [
    ["Loading", "t3_gallery_loading", "Initial transport pending."],
    [
      "Missing / Create session",
      "t3_gallery_missing",
      "404 renders only Create voice session; click it to transition to ready.",
    ],
    ["Unavailable / Retry", "t3_gallery_unavailable", "Non-OK transport renders only Retry."],
    ["Empty / usage prompt", "t3_gallery_empty", "Ready empty list renders only the usage prompt."],
    ["Ready", "t3_gallery_ready", "Loaded note list with one SSE."],
  ] as const) {
    const stateFrame = frame(label.includes("Unavailable") ? "stm-gallery-frame--dark" : "");
    appendActualWidget(stateFrame, sessionId);
    states.grid.append(story(label, description, stateFrame));
  }
  gallery.append(states.root);

  if (options.includeToolbar !== false) {
    const toolbar = section(
      "Generic ID / Park toolbar",
      "Actual registered Widget composition: IdButton and ParkButton; clipboard payload and copied state remain production behavior.",
    );
    toolbar.grid.className = "stm-gallery-grid stm-gallery-grid--two";
    const toolbarLight = frame();
    appendToolbar(toolbarLight, "ses_gallery_toolbar");
    toolbar.grid.append(
      story(
        "Light / active",
        "Focus and click ID; the copied SVG should replace only the idle label for 2 seconds.",
        toolbarLight,
      ),
    );
    const toolbarDark = frame("stm-gallery-frame--dark", "stm-gallery-frame--narrow");
    appendToolbar(toolbarDark, null);
    toolbar.grid.append(
      story(
        "Dark / disabled",
        "The actual empty-session disabled state; Park remains independently mounted.",
        toolbarDark,
      ),
    );
    gallery.append(toolbar.root);
  }

  const statuses = section(
    "VoiceNoteStatusBadge",
    "All status fixtures plus the isPlaying override.",
  );
  statuses.grid.className = "stm-gallery-grid stm-gallery-grid--three";
  for (const status of ["queued", "speaking", "played", "stopped", "unknown"]) {
    const content = frame();
    appendBadge(
      content,
      mountBrowserSolid(() => VoiceNoteStatusBadge({ status })),
    );
    statuses.grid.append(story(status, `status="${status}"`, content));
  }
  const playing = frame();
  appendBadge(
    playing,
    mountBrowserSolid(() => VoiceNoteStatusBadge({ status: "played", isPlaying: true })),
  );
  statuses.grid.append(
    story("isPlaying override", "status=played, isPlaying=true → speaking", playing),
  );
  gallery.append(statuses.root);

  const waiting = section(
    "VoiceSessionWaitingBadge",
    "Waiting-state labels and classes from the current component contract.",
  );
  waiting.grid.className = "stm-gallery-grid stm-gallery-grid--three";
  for (const state of ["working", "needs_answer", "can_continue", "unknown"]) {
    const content = frame();
    appendBadge(
      content,
      mountSolid(() => VoiceSessionWaitingBadge({ waitingState: state })),
    );
    waiting.grid.append(
      story(
        state === "can_continue" ? "idle / can_continue" : state,
        `waitingState="${state}"`,
        content,
      ),
    );
  }
  gallery.append(waiting.root);

  const cards = section(
    "VoiceNoteSessionCard",
    "Alias/title/id fallback fixtures, copy mention behavior, details state, counts, and compact layout.",
  );
  cards.grid.className = "stm-gallery-grid stm-gallery-grid--wide";
  const cardsNormal = frame();
  appendSessionCard(cardsNormal, {
    id: "ses_alias_fixture",
    alias: "Morgan",
    title: "Hidden title",
    summary: "Alias wins",
    waitingState: "needs_answer",
    latestActivity: "2026-08-02T12:00:00Z",
    messageCount: 4,
  });
  appendSessionCard(cardsNormal, {
    id: "ses_title_fixture",
    title: "Title fallback",
    summary: "Title is shown",
    waitingState: "can_continue",
    messageCount: 0,
  });
  appendSessionCard(cardsNormal, {
    id: "ses_id_fixture",
    summary: "ID fallback",
    waitingState: "unknown",
    messageCount: 12,
  });
  cards.grid.append(
    story(
      "Normal / closed details",
      "Three actual cards; open Details and test each copy control.",
      cardsNormal,
    ),
  );
  const cardsCompact = frame(
    "stm-gallery-frame--compact",
    "stm-gallery-frame--short",
    "stm-gallery-frame--dark",
  );
  const compactCard = appendSessionCard(cardsCompact, {
    id: "ses_compact_fixture",
    alias: "Compact alias",
    summary: "Compact card fixture",
    waitingState: "working",
    messageCount: 1,
  });
  compactCard.querySelector("details")?.setAttribute("open", "");
  cards.grid.append(
    story(
      "Compact / dark / open",
      "Short-height frame with details forced open for preservation review.",
      cardsCompact,
    ),
  );
  gallery.append(cards.root);

  const attachments = section(
    "VoiceNoteAttachments",
    "Single, multiple, filtered, and malformed records; only safe image thumbnails should render.",
  );
  attachments.grid.className = "stm-gallery-grid stm-gallery-grid--two";
  for (const [name, fixture] of Object.entries(GALLERY_ATTACHMENT_FIXTURES)) {
    const content = frame(name === "multiple" ? "stm-gallery-frame--narrow" : "");
    appendAttachments(content, fixture);
    attachments.grid.append(
      story(name, `fixture=${name}; exact records=${fixture.length}`, content),
    );
  }
  gallery.append(attachments.root);

  const markdownSection = section(
    "VoiceNoteMarkdown",
    "Representative GFM, raw HTML, and unsafe URL/XSS fixtures. Sanitized output is the preservation contract.",
  );
  markdownSection.grid.className = "stm-gallery-grid stm-gallery-grid--wide";
  const markdownNormal = frame();
  const markdownHtml = options.markdownHtml ?? "";
  appendMarkdown(markdownNormal, markdownHtml);
  markdownSection.grid.append(
    story(
      "Normal / light",
      "Paragraphs, heading, emphasis, tasks, table, blockquote, links, inline/fenced code, raw HTML, unsafe URL.",
      markdownNormal,
    ),
  );
  const markdownCompact = frame(
    "stm-gallery-frame--compact",
    "stm-gallery-frame--short",
    "stm-gallery-frame--dark",
    "stm-gallery-frame--narrow",
  );
  appendMarkdown(markdownCompact, markdownHtml, true);
  markdownSection.grid.append(
    story(
      "Compact / dark / narrow",
      "compact=true with a short-height narrow frame.",
      markdownCompact,
    ),
  );
  gallery.append(markdownSection.root);

  if (options.includeProductionNote === false) {
    gallery.append(knownDifferences());
    root.append(gallery);
    return;
  }

  const note = section(
    "Note-like production composition",
    "Exactly one registered say-to-me-widget is the complete STM-owned banner; transport, speech, timers, and row state are owned by STM.",
  );
  note.grid.className = "stm-gallery-grid stm-gallery-grid--wide";
  const _noteFixture = {
    id: "note_gallery_1",
    author: "agent",
    time: "2026-08-02 12:00:00",
    text: "A production-composed voice note row.",
    extraMarkdown: GALLERY_EXTRA_MARKDOWN_SOURCE,
    extraMarkdownHtml: markdownHtml,
    status: "played",
    attachments: GALLERY_ATTACHMENT_FIXTURES.multiple,
    sessions: [
      {
        id: "ses_note_fixture",
        alias: "Note session",
        title: "Fallback title",
        summary: "Session summary remains below the note text.",
        waitingState: "needs_answer",
        latestActivity: "2026-08-02T12:00:00Z",
        messageCount: 6,
      },
    ],
  };
  const noteLight = frame();
  appendActualWidget(noteLight, "ses_gallery_note", "note-light");
  note.grid.append(
    story(
      "Light / played",
      "Registered say-to-me-widget with STM-owned transport, speech, timers, and note state; click Play/Stop and Copy markdown.",
      noteLight,
    ),
  );
  const noteLightPlaying = frame();
  appendActualWidget(noteLightPlaying, "ses_gallery_note", "note-light-playing");
  note.grid.append(
    story(
      "Light / playing",
      "The same production row with STM-owned playback state; use the actual Play control to verify the light playing highlight.",
      noteLightPlaying,
    ),
  );
  const noteDark = frame(
    "stm-gallery-frame--dark",
    "stm-gallery-frame--compact",
    "stm-gallery-frame--narrow",
    "stm-gallery-frame--short",
  );
  const darkHost = appendActualWidget(noteDark, "ses_gallery_note", "note-dark");
  darkHost.setAttribute("data-theme", "dark");
  note.grid.append(
    story(
      "Dark / compact / narrow / playing",
      "STM owns the list and Play/Stop controls in this deterministic fixture.",
      noteDark,
    ),
  );
  gallery.append(note.root, knownDifferences());
  root.append(gallery);
}
