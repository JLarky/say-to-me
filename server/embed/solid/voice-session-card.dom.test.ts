/** @vitest-environment jsdom */
import { createComponent } from "solid-js";
// @ts-expect-error -- Solid omits declarations for the direct browser runtime entry.
import { render } from "solid-js/web/dist/web.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { VoiceNoteSessionCard, type VoiceNoteSession } from "./components/VoiceNoteSessionCard.tsx";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  document.body.replaceChildren();
});

function mount(session: VoiceNoteSession, uiBaseUrl?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => createComponent(VoiceNoteSessionCard, { session, uiBaseUrl }), host);
  // SAFETY: host starts as an empty div and VoiceNoteSessionCard's own return type is
  // HTMLElement (a single root <div>), so after render() the first child is that element.
  return host.firstElementChild as HTMLElement;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function installClipboard(writeText: (value: string) => Promise<void>) {
  const write = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  return write;
}

const baseSession: VoiceNoteSession = {
  id: "ses_123",
  alias: "voice",
  title: "A title",
  summary: "Last update: kept the exact prefix out of the body",
  summaryUpdatedAt: "2026-08-01 12:34:56",
  waitingState: "needs_answer",
  messageCount: 4,
};

describe("VoiceNoteSessionCard", () => {
  it("preserves display fallback, waiting badge, metadata, timestamp, and direct link semantics", async () => {
    const card = mount(baseSession);
    await flush();
    expect(card.querySelector("strong")?.textContent).toBe("voice");
    expect(card.querySelector(".stm-voice-waiting-badge")?.textContent).toBe("Needs answer");
    expect(card.querySelector(".stm-voice-session-card-latest")?.textContent).toContain("Latest:");
    expect(card.querySelector(".stm-voice-session-card-summary")?.textContent).toBe(
      "Last update: kept the exact prefix out of the body",
    );
    expect(card.querySelector(".stm-voice-session-card-id")?.textContent).toBe("ses_123");
    expect(card.querySelector(".stm-voice-session-card-details")?.textContent).toContain(
      "4 messages",
    );
    const open = card.querySelector("a")!;
    expect(open.getAttribute("href")).toBe("https://say.localhost:1311/ses/ses_123");
    expect(open.target).toBe("_blank");
    expect(open.rel).toBe("noreferrer");
    expect(open.hasAttribute("title")).toBe(false);
    expect(open.hasAttribute("aria-label")).toBe(false);
    const copy = card.querySelector("button")!;
    expect(copy.hasAttribute("title")).toBe(false);
    expect(copy.hasAttribute("aria-label")).toBe(false);
  });

  it("copies alias and id-only mentions with live confirmation, timer reset, and cleanup", async () => {
    vi.useFakeTimers();
    let resolveCopy: (() => void) | undefined;
    const write = installClipboard(() => new Promise((resolve) => (resolveCopy = resolve)));
    const card = mount(baseSession);
    await flush();
    const button = card.querySelector("button")!;

    button.click();
    expect(write).toHaveBeenCalledWith("say-to-me(ses_123, voice)");
    expect(button.textContent).toBe("Copy mention");
    resolveCopy!();
    await flush();
    expect(button.textContent).toBe("Copied");
    button.click();
    expect(write).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_999);
    expect(button.textContent).toBe("Copied");
    vi.advanceTimersByTime(1);
    expect(button.textContent).toBe("Copy mention");

    dispose!();
    const before = button.textContent;
    vi.advanceTimersByTime(2_000);
    expect(button.textContent).toBe(before);

    document.body.replaceChildren();
    const idOnly = mount({ id: "ses_id", alias: null });
    await flush();
    const idButton = idOnly.querySelector("button")!;
    const idWrite = installClipboard(() => Promise.resolve());
    idButton.click();
    await flush();
    expect(idWrite).toHaveBeenCalledWith("say-to-me(ses_id)");
  });

  it("does not render a broken Open link without a reachable UI base", async () => {
    const card = mount(baseSession, "");
    await flush();
    const open = card.querySelector<HTMLElement>(".stm-voice-session-card-open");
    expect(open?.hidden).toBe(true);
    expect(open?.hasAttribute("href")).toBe(false);
  });

  it("logs unavailable and rejected clipboard operations without changing labels", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const card = mount(baseSession);
    await flush();
    card.querySelector("button")!.click();
    expect(error).toHaveBeenCalledWith("[say-to-me-widget] Clipboard API unavailable");

    const rejection = new Error("denied");
    installClipboard(() => Promise.reject(rejection));
    card.querySelector("button")!.click();
    await flush();
    expect(card.querySelector("button")?.textContent).toBe("Copy mention");
    expect(error).toHaveBeenCalledWith(
      "[say-to-me-widget] Failed to copy session mention",
      rejection,
    );
  });

  it("updates the waiting badge for changed session state", async () => {
    const card = mount({ ...baseSession, waitingState: "can_continue" });
    await flush();
    expect(card.querySelector(".stm-voice-waiting-badge")?.textContent).toBe("Idle");
  });
});
