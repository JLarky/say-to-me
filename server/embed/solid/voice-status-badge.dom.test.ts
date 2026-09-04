/** @vitest-environment jsdom */
import { createComponent, type JSX } from "solid-js";
// @ts-expect-error -- Solid omits declarations for the direct browser runtime entry.
import { render } from "solid-js/web/dist/web.js";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { VoiceNoteStatusBadge } from "./components/VoiceNoteStatusBadge.tsx";
import { VoiceSessionWaitingBadge } from "./components/VoiceSessionWaitingBadge.tsx";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});
function mount(view: JSX.Element) {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => view as never, host);
  return host.firstElementChild as HTMLElement;
}

describe("voice status badges", () => {
  it("renders message states, unknown text, and playing override", () => {
    for (const [status, className] of [
      ["queued", "bg-amber-500/15 text-amber-700"],
      ["speaking", "bg-sky-500/15 text-sky-700"],
      ["played", "bg-emerald-500/15 text-emerald-700"],
      ["stopped", "bg-rose-500/15 text-rose-700"],
      ["future-status", "bg-muted/70 text-muted-foreground"],
    ] as const) {
      const badge = mount(createComponent(VoiceNoteStatusBadge, { status }));
      expect(badge.className).toBe(`stm-voice-message-status ${className}`);
      expect(badge.textContent).toBe(status);
    }
    expect(
      mount(createComponent(VoiceNoteStatusBadge, { status: "played", isPlaying: true }))
        .textContent,
    ).toBe("speaking");
  });
  it("preserves played check geometry and decorative semantics", () => {
    const icon = mount(createComponent(VoiceNoteStatusBadge, { status: "played" })).querySelector(
      "svg",
    )!;
    expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon.getAttribute("width")).toBe("12");
    expect(icon.getAttribute("height")).toBe("12");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.querySelector("path")?.getAttribute("d")).toBe("M20 6 9 17l-5-5");
  });
  it("renders waiting labels and classes for known and unknown states", () => {
    for (const [waitingState, label, className] of [
      ["working", "Working", "bg-amber-500/15 text-amber-700"],
      ["needs_answer", "Needs answer", "bg-sky-500/15 text-sky-700"],
      ["can_continue", "Idle", "bg-emerald-500/15 text-emerald-700"],
      ["future_state", "future state", "bg-muted text-muted-foreground"],
      [null, "Unknown", "bg-muted text-muted-foreground"],
    ] as const) {
      const badge = mount(createComponent(VoiceSessionWaitingBadge, { waitingState }));
      expect(badge.className).toBe(`stm-voice-waiting-badge ${className}`);
      expect(badge.textContent).toBe(label);
    }
  });
});
