/** @vitest-environment jsdom */
import { createComponent } from "solid-js";
// @ts-expect-error -- Solid omits declarations for the direct browser runtime entry.
import { render } from "solid-js/web/dist/web.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderExtraMarkdownHtml } from "../../../markdown/extra-markdown-html.ts";
import { VoiceNoteRow } from "./VoiceNoteRow.tsx";
import type { VoiceWidgetNote } from "../voice-widget-content.ts";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
  document.body.replaceChildren();
});

function note(): VoiceWidgetNote {
  return {
    id: "42",
    author: "agent",
    time: "2026-08-02T12:00:00Z",
    text: "Production voice note",
    extraMarkdown: "**copied source**",
    extraMarkdownHtml: renderExtraMarkdownHtml(
      "**rendered HTML**\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    ),
    status: "played",
    attachments: [
      {
        id: 7,
        mimeType: "image/png",
        originalName: "fixture.png",
        thumbnailDataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    ],
    sessions: [],
  };
}

describe("VoiceNoteRow production composition", () => {
  it("renders the T3 note slice and copies raw Markdown with exact timing/labels", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const fixture = note();
    dispose = render(() => createComponent(VoiceNoteRow, { note: fixture, el: host }), host);

    expect(host.querySelector(".stm-voice-note-row-id")?.textContent).toBe("#42");
    expect(host.querySelector(".stm-voice-note-row-text")?.textContent).toBe(
      "Production voice note",
    );
    expect(host.querySelector(".stm-voice-note-extra-markdown")).not.toBeNull();
    expect(host.querySelector(".stm-voice-note-markdown strong")?.textContent).toBe(
      "rendered HTML",
    );
    expect(host.querySelector(".stm-voice-note-markdown table")).not.toBeNull();
    expect(host.querySelector(".stm-voice-note-attachment")).not.toBeNull();

    vi.useFakeTimers();
    const copy = host.querySelector<HTMLButtonElement>(
      "[data-testid=say-to-me-extra-markdown] button",
    )!;
    expect(copy.getAttribute("aria-label")).toBe("Copy extra markdown");
    expect(copy.title).toBe("Copy extra markdown");
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("**copied source**");
    expect(copy.querySelector("svg")).not.toBeNull();
    expect(copy.getAttribute("aria-label")).toBe("Copied extra markdown");
    vi.advanceTimersByTime(1_199);
    expect(copy.querySelector("svg")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(copy.querySelector("svg")).not.toBeNull();
    expect(copy.getAttribute("aria-label")).toBe("Copy extra markdown");
  });

  it("preserves React paragraph whitespace collapsing semantics", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const fixture = { ...note(), text: "first   line\\nsecond    line" };
    dispose = render(() => createComponent(VoiceNoteRow, { note: fixture, el: host }), host);

    const text = host.querySelector<HTMLElement>(".stm-voice-note-row-text")!;
    expect(text.textContent).toBe("first   line\\nsecond    line");
    expect(text.style.whiteSpace).toBe("");
  });

  it("invokes owned play and stop callbacks without host events", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const played: string[] = [];
    const stopped: string[] = [];
    const fixture = note();
    dispose = render(
      () =>
        createComponent(VoiceNoteRow, {
          note: fixture,
          el: host,
          onPlay: (id: string) => played.push(id),
          onStop: (id: string) => stopped.push(id),
          isPlaying: true,
        }),
      host,
    );
    const play = host.querySelector<HTMLButtonElement>("[data-testid=voice-note-play-button]")!;
    const stop = host.querySelector<HTMLButtonElement>("[data-testid=voice-note-stop-button]")!;
    expect(play.textContent).toBe("Restart");
    expect(stop.disabled).toBe(false);
    play.click();
    stop.click();
    expect(played).toEqual([fixture.id]);
    expect(stopped).toEqual([fixture.id]);
  });
});
