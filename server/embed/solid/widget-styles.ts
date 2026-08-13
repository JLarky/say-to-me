/**
 * Injected stylesheet for `<say-to-me-widget>`.
 * Self-owned compact toolbar chrome; hosts must not supply Tailwind classes.
 */

export const WIDGET_STYLE_ELEMENT_ID = "say-to-me-widget-styles";
export const WIDGET_STYLE_MARKER = "/* say-to-me-widget-styles:compact-toolbar */";

export const WIDGET_STYLESHEET = `${WIDGET_STYLE_MARKER}
say-to-me-widget {
  --stm-widget-focus-ring: 0 0 0 1px var(--background, transparent),
    0 0 0 3px var(--ring, currentColor);
  display: inline-flex;
  gap: 0.25rem;
  vertical-align: middle;
  line-height: 0;
  color: inherit;
}

say-to-me-widget :is(.stm-id-btn, .stm-park-btn) {
  appearance: none;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 1.5rem;
  width: 1.5rem;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: var(--radius-md, 0.375rem);
  background: transparent;
  /* currentColor on \`color\` resolves to the inherited host foreground. */
  color: var(--stm-widget-muted, var(--muted-foreground, color-mix(in srgb, currentColor 55%, transparent)));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  position: relative;
  transition: box-shadow 150ms ease;
}

say-to-me-widget .stm-id-btn svg {
  display: block;
  width: 0.875rem;
  height: 0.875rem;
}

say-to-me-widget :is(.stm-id-btn, .stm-park-btn):hover:not(:disabled) {
  background: var(--stm-widget-accent, var(--accent, color-mix(in srgb, currentColor 12%, transparent)));
  color: var(--stm-widget-fg, var(--foreground, inherit));
}

say-to-me-widget :is(.stm-id-btn, .stm-park-btn):active {
  background: var(--stm-widget-accent, var(--accent, color-mix(in srgb, currentColor 12%, transparent)));
}

say-to-me-widget :is(.stm-id-btn, .stm-park-btn):disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

say-to-me-widget :is(.stm-id-btn, .stm-park-btn):focus-visible {
  outline: none;
  box-shadow: var(--stm-widget-focus-ring);
}

@media (max-height: 900px) {
  say-to-me-widget {
    gap: 0.125rem;
  }

  say-to-me-widget :is(.stm-id-btn, .stm-park-btn) {
    height: 1.25rem;
    width: 1.25rem;
    font-size: 9px;
  }

  say-to-me-widget .stm-id-btn svg {
    width: 0.75rem;
    height: 0.75rem;
  }
}

@media (pointer: coarse) {
  say-to-me-widget :is(.stm-id-btn, .stm-park-btn)::after {
    content: "";
    position: absolute;
    min-width: 44px;
    min-height: 44px;
  }
}
`;

/** Ensure exactly one stylesheet node and refresh it across HMR re-registration. */
export function ensureWidgetStylesheet(
  doc: Document | null | undefined = typeof document !== "undefined" ? document : undefined,
): HTMLStyleElement | null {
  if (!doc?.head) return null;
  let style = doc.getElementById(WIDGET_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = WIDGET_STYLE_ELEMENT_ID;
    doc.head.append(style);
  }
  style.textContent = WIDGET_STYLESHEET;
  return style;
}
