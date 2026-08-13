import { describe, expect, it } from "vite-plus/test";
import {
  WIDGET_STYLE_ELEMENT_ID,
  WIDGET_STYLE_MARKER,
  WIDGET_STYLESHEET,
  ensureWidgetStylesheet,
} from "./widget-styles.ts";

describe("widget stylesheet", () => {
  it("owns compact toolbar chrome for the widget host", () => {
    expect(WIDGET_STYLESHEET).toContain(WIDGET_STYLE_MARKER);
    expect(WIDGET_STYLESHEET).toContain(":is(.stm-id-btn, .stm-park-btn)");
    expect(WIDGET_STYLESHEET).toContain("border-radius: var(--radius-md, 0.375rem)");
    expect(WIDGET_STYLESHEET).toContain("height: 1.5rem");
    expect(WIDGET_STYLESHEET).toContain("width: 1.5rem");
    expect(WIDGET_STYLESHEET).toContain("font-size: 10px");
    expect(WIDGET_STYLESHEET).toContain("gap: 0.25rem");
    expect(WIDGET_STYLESHEET).toContain("gap: 0.125rem");
    expect(WIDGET_STYLESHEET).toContain("ui-monospace");
    expect(WIDGET_STYLESHEET).toContain(":hover:not(:disabled)");
    expect(WIDGET_STYLESHEET).toContain("@media (max-height: 900px)");
    expect(WIDGET_STYLESHEET).toContain("@media (pointer: coarse)");
    expect(WIDGET_STYLESHEET).toContain("min-width: 44px");
    expect(WIDGET_STYLESHEET).toContain("min-height: 44px");
    expect(WIDGET_STYLESHEET).toContain("height: 1.25rem");
    expect(WIDGET_STYLESHEET).toContain("font-size: 9px");
    expect(WIDGET_STYLESHEET).toContain(":focus-visible");
    expect(WIDGET_STYLESHEET).toContain("background: var(--stm-widget-accent");
    expect(WIDGET_STYLESHEET).not.toContain("data-pressed");
    expect(WIDGET_STYLESHEET).toContain("transition: box-shadow 150ms ease");
    expect(WIDGET_STYLESHEET).toContain(":active");
    expect(WIDGET_STYLESHEET).not.toContain("text-muted-foreground");
    expect(WIDGET_STYLESHEET).not.toContain("hover:text-foreground");
    expect(WIDGET_STYLESHEET).not.toContain("short:");
  });

  it("defaults to theme-neutral host-foreground inheritance", () => {
    expect(WIDGET_STYLESHEET).toContain("color: inherit");
    expect(WIDGET_STYLESHEET).toContain(
      "color: var(--stm-widget-muted, var(--muted-foreground, color-mix(in srgb, currentColor 55%, transparent)))",
    );
    expect(WIDGET_STYLESHEET).toContain(
      "--stm-widget-focus-ring: 0 0 0 1px var(--background, transparent),",
    );
    expect(WIDGET_STYLESHEET).toContain("0 0 0 3px var(--ring, currentColor);");
    expect(WIDGET_STYLESHEET).not.toContain("0 0 0 4px currentColor");
    expect(WIDGET_STYLESHEET).toContain("color: var(--stm-widget-fg, var(--foreground, inherit))");
    expect(WIDGET_STYLESHEET).toContain("width: 0.875rem");
    expect(WIDGET_STYLESHEET).toContain("width: 0.75rem");
    expect(WIDGET_STYLESHEET).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("injects one idempotent style node and refreshes content", () => {
    expect(ensureWidgetStylesheet(null)).toBeNull();

    const doc = new (class {
      head = { append: (_node: unknown) => undefined } as unknown as HTMLHeadElement;
      private style: HTMLStyleElement | null = null;
      getElementById(id: string) {
        return id === WIDGET_STYLE_ELEMENT_ID ? this.style : null;
      }
      createElement(tag: string) {
        expect(tag).toBe("style");
        this.style = { id: "", textContent: "" } as HTMLStyleElement;
        return this.style;
      }
    })() as unknown as Document;

    const first = ensureWidgetStylesheet(doc);
    expect(first?.id).toBe(WIDGET_STYLE_ELEMENT_ID);
    expect(first?.textContent).toBe(WIDGET_STYLESHEET);
    expect(ensureWidgetStylesheet(doc)).toBe(first);
  });
});
