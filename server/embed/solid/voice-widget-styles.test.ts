import { describe, expect, it } from "vite-plus/test";
import { VOICE_WIDGET_STYLE_MARKER, VOICE_WIDGET_STYLESHEET } from "./voice-widget-styles.ts";

function section(start: string, end: string): string {
  const startIndex = VOICE_WIDGET_STYLESHEET.indexOf(start);
  const endIndex = VOICE_WIDGET_STYLESHEET.indexOf(end, startIndex + start.length);
  return VOICE_WIDGET_STYLESHEET.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}

describe("voice widget attachment stylesheet", () => {
  it("keeps thumbnails host-scoped with T3 spacing, object fit, interaction, compact rules, and radius tokens", () => {
    expect(VOICE_WIDGET_STYLESHEET).toContain(".stm-voice-note-attachments");
    expect(VOICE_WIDGET_STYLESHEET).toContain("gap: 0.5rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("margin-top: 0.5rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("max-height: 8rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("max-width: 12rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("object-fit: contain");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--radius-lg, 0.5rem)");
    expect(VOICE_WIDGET_STYLESHEET).not.toContain("line-height: 0");
    expect(VOICE_WIDGET_STYLESHEET).toContain("max-height: 4rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("max-width: 6rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--radius-md, 0.375rem)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("say-to-me-widget .stm-voice-note");
  });
});

describe("collapsed voice widget shell", () => {
  it("keeps the floating shell contained and interactive", () => {
    expect(VOICE_WIDGET_STYLESHEET).toContain(
      "position: absolute; top: 0.5rem; right: 10px; z-index: 30",
    );
    expect(VOICE_WIDGET_STYLESHEET).toContain("width: min(calc(100% - 20px), 32rem)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("pointer-events: auto");
    expect(VOICE_WIDGET_STYLESHEET).toContain("line-height: 1.25");
    expect(VOICE_WIDGET_STYLESHEET).toContain(
      "say-to-me-widget[hidden] { display: none !important; }",
    );
    expect(VOICE_WIDGET_STYLESHEET).toContain("min-width: 2rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("min-height: 2rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("say-to-me-widget { position: relative");
  });

  it("keeps the collapsed mobile header in one shrink-to-fit row", () => {
    const collapsedMobile = section(
      ".stm-voice-widget.stm-voice-widget--collapsed .stm-voice-widget-toolbar {",
      ".stm-voice-widget-content { max-height: 18rem;",
    );
    expect(collapsedMobile).toContain("flex-wrap: nowrap");
    expect(collapsedMobile).toContain("align-items: center");
    expect(collapsedMobile).toContain("gap: 0.375rem");
    expect(collapsedMobile).toContain("flex: 0 0 auto");
  });
});

describe("voice widget badge stylesheet", () => {
  it("targets only the registered voice-widget host and supports shadow context", () => {
    expect(VOICE_WIDGET_STYLESHEET).toContain(VOICE_WIDGET_STYLE_MARKER);
    expect(VOICE_WIDGET_STYLESHEET).toContain('say-to-me-widget [class~="bg-amber-500/15"]');
    expect(VOICE_WIDGET_STYLESHEET).toContain("say-to-me-widget .stm-voice-message-status");
    expect(VOICE_WIDGET_STYLESHEET).toContain(":host .stm-voice-message-status");
    expect(VOICE_WIDGET_STYLESHEET).toContain("say-to-me-widget .stm-voice-message-status");
    expect(VOICE_WIDGET_STYLESHEET).toContain("say-to-me-widget [class~=");
  });

  it("uses exact T3 palette fallbacks and oklab opacity mixing", () => {
    expect(VOICE_WIDGET_STYLESHEET).toContain(
      "color-mix(in oklab, var(--color-amber-500, #f59e0b) 15%, transparent)",
    );
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--color-amber-700, #b45309)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--color-sky-500, #0ea5e9)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--color-emerald-500, #10b981)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--color-rose-500, #f43f5e)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--muted-foreground, #71717a)");
    expect(VOICE_WIDGET_STYLESHEET).not.toContain("dark:text-");
  });

  it("has real dark-theme selectors for document and shadow hosts", () => {
    expect(VOICE_WIDGET_STYLESHEET).toContain(".dark say-to-me-widget");
    expect(VOICE_WIDGET_STYLESHEET).toContain('say-to-me-widget[data-theme="dark"]');
    expect(VOICE_WIDGET_STYLESHEET).toContain(":host(.dark)");
    expect(VOICE_WIDGET_STYLESHEET).toContain(':host([data-theme="dark"])');
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--color-amber-300, #fcd34d)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--color-sky-300, #7dd3fc)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--color-emerald-300, #6ee7b7)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("var(--color-rose-300, #fda4af)");
  });

  it("keeps status and waiting badge chrome mechanically distinct", () => {
    const status = section(":host .stm-voice-message-status {", ":host .stm-voice-waiting-badge {");
    const waiting = section(
      ":host .stm-voice-waiting-badge {",
      ":host .stm-voice-message-status svg {",
    );
    expect(status).toContain("display: inline-flex");
    expect(status).toContain("align-items: center");
    expect(status).toContain("gap: 0.25rem");
    expect(status).not.toContain("line-height");
    expect(waiting).toContain("display: inline-block");
    expect(waiting).not.toContain("inline-flex");
    expect(waiting).not.toContain("align-items");
    expect(waiting).not.toContain("gap:");
    expect(waiting).not.toContain("line-height");
  });

  it("preserves played icon and compact short-height sizing", () => {
    expect(VOICE_WIDGET_STYLESHEET).toContain("say-to-me-widget .stm-voice-message-status svg");
    expect(VOICE_WIDGET_STYLESHEET).toContain("@media (max-height: 900px)");
    expect(VOICE_WIDGET_STYLESHEET).toContain("font-size: 9px");
    expect(VOICE_WIDGET_STYLESHEET).toContain("width: 0.625rem");
    expect(VOICE_WIDGET_STYLESHEET).toContain("height: 0.625rem");
  });
});
