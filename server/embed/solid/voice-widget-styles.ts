/** Dedicated stylesheet for the future <say-to-me-widget> host. */
export const VOICE_WIDGET_STYLE_MARKER = "/* say-to-me-widget-styles:session-card */";

export const VOICE_WIDGET_STYLESHEET = `${VOICE_WIDGET_STYLE_MARKER}
say-to-me-widget {
  --stm-voice-amber-bg: color-mix(in oklab, var(--color-amber-500, #f59e0b) 15%, transparent);
  --stm-voice-sky-bg: color-mix(in oklab, var(--color-sky-500, #0ea5e9) 15%, transparent);
  --stm-voice-emerald-bg: color-mix(in oklab, var(--color-emerald-500, #10b981) 15%, transparent);
  --stm-voice-rose-bg: color-mix(in oklab, var(--color-rose-500, #f43f5e) 15%, transparent);
  --stm-voice-muted-bg: var(--muted, #f4f4f5);
  --stm-voice-muted-bg-soft: color-mix(in oklab, var(--muted, #f4f4f5) 70%, transparent);
  --stm-voice-amber-fg: var(--color-amber-700, #b45309);
  --stm-voice-sky-fg: var(--color-sky-700, #0369a1);
  --stm-voice-emerald-fg: var(--color-emerald-700, #047857);
  --stm-voice-rose-fg: var(--color-rose-700, #be123c);
  --stm-voice-muted-fg: var(--muted-foreground, #71717a);
}

:host {
  --stm-voice-amber-bg: color-mix(in oklab, var(--color-amber-500, #f59e0b) 15%, transparent);
  --stm-voice-sky-bg: color-mix(in oklab, var(--color-sky-500, #0ea5e9) 15%, transparent);
  --stm-voice-emerald-bg: color-mix(in oklab, var(--color-emerald-500, #10b981) 15%, transparent);
  --stm-voice-rose-bg: color-mix(in oklab, var(--color-rose-500, #f43f5e) 15%, transparent);
  --stm-voice-muted-bg: var(--muted, #f4f4f5);
  --stm-voice-muted-bg-soft: color-mix(in oklab, var(--muted, #f4f4f5) 70%, transparent);
  --stm-voice-amber-fg: var(--color-amber-700, #b45309);
  --stm-voice-sky-fg: var(--color-sky-700, #0369a1);
  --stm-voice-emerald-fg: var(--color-emerald-700, #047857);
  --stm-voice-rose-fg: var(--color-rose-700, #be123c);
  --stm-voice-muted-fg: var(--muted-foreground, #71717a);
}

.dark say-to-me-widget,
say-to-me-widget[data-theme="dark"] {
  --stm-voice-amber-fg: var(--color-amber-300, #fcd34d);
  --stm-voice-sky-fg: var(--color-sky-300, #7dd3fc);
  --stm-voice-emerald-fg: var(--color-emerald-300, #6ee7b7);
  --stm-voice-rose-fg: var(--color-rose-300, #fda4af);
}

:host(.dark),
:host([data-theme="dark"]) {
  --stm-voice-amber-fg: var(--color-amber-300, #fcd34d);
  --stm-voice-sky-fg: var(--color-sky-300, #7dd3fc);
  --stm-voice-emerald-fg: var(--color-emerald-300, #6ee7b7);
  --stm-voice-rose-fg: var(--color-rose-300, #fda4af);
}

say-to-me-widget [class~="bg-amber-500/15"],
:host [class~="bg-amber-500/15"] {
  background: var(--stm-voice-amber-bg);
}
say-to-me-widget [class~="bg-sky-500/15"],
:host [class~="bg-sky-500/15"] {
  background: var(--stm-voice-sky-bg);
}
say-to-me-widget [class~="bg-emerald-500/15"],
:host [class~="bg-emerald-500/15"] {
  background: var(--stm-voice-emerald-bg);
}
say-to-me-widget [class~="bg-rose-500/15"],
:host [class~="bg-rose-500/15"] {
  background: var(--stm-voice-rose-bg);
}
say-to-me-widget [class~="bg-muted"],
:host [class~="bg-muted"] {
  background: var(--stm-voice-muted-bg);
}
say-to-me-widget [class~="bg-muted/70"],
:host [class~="bg-muted/70"] {
  background: var(--stm-voice-muted-bg-soft);
}

say-to-me-widget [class~="text-amber-700"],
:host [class~="text-amber-700"] {
  color: var(--stm-voice-amber-fg);
}
say-to-me-widget [class~="text-sky-700"],
:host [class~="text-sky-700"] {
  color: var(--stm-voice-sky-fg);
}
say-to-me-widget [class~="text-emerald-700"],
:host [class~="text-emerald-700"] {
  color: var(--stm-voice-emerald-fg);
}
say-to-me-widget [class~="text-rose-700"],
:host [class~="text-rose-700"] {
  color: var(--stm-voice-rose-fg);
}
say-to-me-widget [class~="text-muted-foreground"],
:host [class~="text-muted-foreground"] {
  color: var(--stm-voice-muted-fg);
}

say-to-me-widget .stm-voice-note-attachments,
:host .stm-voice-note-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

say-to-me-widget .stm-voice-note-attachment-image,
:host .stm-voice-note-attachment-image {
  max-height: 8rem;
  max-width: 12rem;
  border: 1px solid color-mix(in oklab, var(--border, #e4e4e7) 60%, transparent);
  border-radius: var(--radius-lg, 0.5rem);
  object-fit: contain;
}


say-to-me-widget .stm-voice-message-status,
:host .stm-voice-message-status {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 9999px;
  padding: 0.125rem 0.375rem;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

say-to-me-widget .stm-voice-waiting-badge,
:host .stm-voice-waiting-badge {
  display: inline-block;
  border-radius: 9999px;
  padding: 0.125rem 0.375rem;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

say-to-me-widget .stm-voice-message-status svg,
:host .stm-voice-message-status svg {
  display: block;
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
}

@media (max-height: 900px) {
  say-to-me-widget .stm-voice-note-attachments,
  :host .stm-voice-note-attachments {
    gap: 0.375rem;
    margin-top: 0.25rem;
  }

  say-to-me-widget .stm-voice-note-attachment-image,
  :host .stm-voice-note-attachment-image {
    max-height: 4rem;
    max-width: 6rem;
    border-radius: var(--radius-md, 0.375rem);
  }
  say-to-me-widget .stm-voice-message-status,
  :host .stm-voice-message-status,
  say-to-me-widget .stm-voice-waiting-badge,
  :host .stm-voice-waiting-badge {
    font-size: 9px;
  }

  say-to-me-widget .stm-voice-message-status svg,
  :host .stm-voice-message-status svg {
    width: 0.625rem;
    height: 0.625rem;
  }
}

say-to-me-widget .stm-voice-session-card, :host .stm-voice-session-card { box-sizing: border-box; margin-top: .5rem; border: 1px solid color-mix(in oklab, var(--border, #e4e4e7) 70%, transparent); border-radius: var(--radius-xl, 0.75rem); background: color-mix(in oklab, var(--background, #fff) 70%, transparent); padding: .625rem; color: var(--foreground, inherit); }
say-to-me-widget .stm-voice-session-card-header, :host .stm-voice-session-card-header { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: .5rem; row-gap: .25rem; }
say-to-me-widget .stm-voice-session-card-name, :host .stm-voice-session-card-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .875rem; line-height: 1.25rem; }
say-to-me-widget :is(.stm-voice-session-card-latest, .stm-voice-session-card-summary, .stm-voice-session-card-details), :host :is(.stm-voice-session-card-latest, .stm-voice-session-card-summary, .stm-voice-session-card-details) { color: var(--muted-foreground, #71717a); font-size: .75rem; line-height: 1rem; }
say-to-me-widget .stm-voice-session-card-actions, :host .stm-voice-session-card-actions { display: flex; flex-wrap: wrap; gap: .375rem; margin-top: .5rem; }
say-to-me-widget .stm-voice-session-card-summary, :host .stm-voice-session-card-summary { display: -webkit-box; margin: .5rem 0 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
say-to-me-widget .stm-voice-session-card-details, :host .stm-voice-session-card-details { margin-top: .375rem; }
say-to-me-widget .stm-voice-session-card-details summary, :host .stm-voice-session-card-details summary { cursor: pointer; font-weight: 500; }
say-to-me-widget .stm-voice-session-card-details summary:hover, :host .stm-voice-session-card-details summary:hover { color: var(--foreground, inherit); }
say-to-me-widget .stm-voice-session-card-id, :host .stm-voice-session-card-id { margin-top: .25rem; overflow-wrap: anywhere; }

/* Preservation overrides: Open mirrors its T3 anchor utilities; Copy mirrors Button xs/outline. */
say-to-me-widget .stm-voice-session-card-open,
:host .stm-voice-session-card-open {
  display: inline-flex;
  position: static;
  height: 1.75rem;
  align-items: center;
  border: 1px solid var(--border, #e4e4e7);
  border-radius: var(--radius-md, 0.375rem);
  background: var(--background, #fff);
  padding: 0 0.5rem;
  color: var(--foreground, inherit);
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
  text-decoration: none;
  cursor: pointer;
}

say-to-me-widget .stm-voice-session-card-open:hover,
:host .stm-voice-session-card-open:hover {
  background: var(--muted, #f4f4f5);
}

say-to-me-widget .stm-voice-session-card-copy,
:host .stm-voice-session-card-copy {
  box-sizing: border-box;
  position: relative;
  display: inline-flex;
  height: 1.75rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  border: 1px solid var(--input, var(--border, #e4e4e7));
  border-radius: var(--radius-md, 0.375rem);
  background: var(--popover, var(--background, #fff));
  padding: 0 7px;
  color: var(--foreground, inherit);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition: box-shadow 150ms ease;
}

say-to-me-widget .stm-voice-session-card-copy::before,
:host .stm-voice-session-card-copy::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: calc(var(--radius-md, 0.375rem) - 1px);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--color-black, #000) 4%, transparent);
}

say-to-me-widget .stm-voice-session-card-copy:hover,
:host .stm-voice-session-card-copy:hover {
  background: color-mix(in srgb, var(--accent, #f4f4f5) 50%, transparent);
}

.dark say-to-me-widget .stm-voice-session-card-copy:hover,
say-to-me-widget[data-theme="dark"] .stm-voice-session-card-copy:hover,
:host(.dark) .stm-voice-session-card-copy:hover,
:host([data-theme="dark"]) .stm-voice-session-card-copy:hover {
  background: color-mix(in srgb, var(--input, #27272a) 64%, transparent);
}

say-to-me-widget .stm-voice-session-card-copy:active,
:host .stm-voice-session-card-copy:active {
  box-shadow: none;
}

say-to-me-widget .stm-voice-session-card-copy:focus-visible,
:host .stm-voice-session-card-copy:focus-visible {
  box-shadow: 0 0 0 1px var(--background, transparent), 0 0 0 3px var(--ring, currentColor);
}

say-to-me-widget .stm-voice-session-card-copy:disabled,
:host .stm-voice-session-card-copy:disabled {
  pointer-events: none;
  opacity: 0.64;
}

say-to-me-widget .stm-voice-session-card-summary,
:host .stm-voice-session-card-summary {
  line-height: 1rem;
}

say-to-me-widget .stm-voice-session-card-id,
:host .stm-voice-session-card-id {
  word-break: break-all;
  overflow-wrap: normal;
}


say-to-me-widget:not(.dark):not([data-theme="dark"]) .stm-voice-session-card-copy,
:host(:not(.dark):not([data-theme="dark"])) .stm-voice-session-card-copy {
  background-clip: padding-box;
}

say-to-me-widget .stm-voice-session-card-copy:not(:disabled):not(:active),
:host .stm-voice-session-card-copy:not(:disabled):not(:active) {
  box-shadow: 0 1px 2px 0 color-mix(in srgb, var(--color-black, #000) 5%, transparent);
}

say-to-me-widget .stm-voice-session-card-copy:disabled,
say-to-me-widget .stm-voice-session-card-copy:active,
:host .stm-voice-session-card-copy:disabled,
:host .stm-voice-session-card-copy:active {
  box-shadow: none;
}

.dark say-to-me-widget .stm-voice-session-card-copy,
say-to-me-widget[data-theme="dark"] .stm-voice-session-card-copy,
:host(.dark) .stm-voice-session-card-copy,
:host([data-theme="dark"]) .stm-voice-session-card-copy {
  background: color-mix(in srgb, var(--input, #27272a) 32%, transparent);
}

.dark say-to-me-widget .stm-voice-session-card-copy::before,
say-to-me-widget[data-theme="dark"] .stm-voice-session-card-copy::before,
:host(.dark) .stm-voice-session-card-copy::before,
:host([data-theme="dark"]) .stm-voice-session-card-copy::before {
  box-shadow: 0 -1px 0 color-mix(in srgb, var(--color-white, #fff) 2%, transparent);
}

.dark say-to-me-widget .stm-voice-session-card-copy:not(:disabled):not(:active)::before,
say-to-me-widget[data-theme="dark"] .stm-voice-session-card-copy:not(:disabled):not(:active)::before,
:host(.dark) .stm-voice-session-card-copy:not(:disabled):not(:active)::before,
:host([data-theme="dark"]) .stm-voice-session-card-copy:not(:disabled):not(:active)::before {
  box-shadow: 0 -1px 0 color-mix(in srgb, var(--color-white, #fff) 6%, transparent);
}
@media (min-width: 640px) {
  say-to-me-widget .stm-voice-session-card-copy,
  :host .stm-voice-session-card-copy {
    height: 1.5rem;
    font-size: 0.75rem;
    line-height: 1rem;
  }
}

@media (max-height: 900px) {
  say-to-me-widget .stm-voice-session-card,
  :host .stm-voice-session-card {
    margin-top: 0.25rem;
    border-radius: var(--radius-lg, 0.5rem);
    padding: 0.375rem;
  }

  say-to-me-widget .stm-voice-session-card-name,
  :host .stm-voice-session-card-name {
    font-size: 11px;
    line-height: 1.25rem;
  }

  say-to-me-widget :is(.stm-voice-session-card-latest, .stm-voice-session-card-summary, .stm-voice-session-card-details),
  :host :is(.stm-voice-session-card-latest, .stm-voice-session-card-summary, .stm-voice-session-card-details) {
    font-size: 10px;
    line-height: 1rem;
  }

  say-to-me-widget .stm-voice-session-card-actions,
  :host .stm-voice-session-card-actions {
    gap: 0.25rem;
    margin-top: 0.25rem;
  }

  say-to-me-widget .stm-voice-session-card-open,
  :host .stm-voice-session-card-open {
    height: 1.5rem;
    padding: 0 0.375rem;
    font-size: 10px;
    line-height: 1rem;
  }
}
@media (pointer: coarse) {
  say-to-me-widget .stm-voice-session-card-copy::after,
  :host .stm-voice-session-card-copy::after {
    content: "";
    position: absolute;
    min-width: 44px;
    min-height: 44px;
  }
}

say-to-me-widget { position: relative; display: block; width: 100%; min-width: 0; color: var(--foreground, #18181b); line-height: 1.25; }
say-to-me-widget[hidden] { display: none !important; }
.stm-voice-widget [hidden] { display: none !important; }
.stm-voice-widget { box-sizing: border-box; display: grid; gap: 0.75rem; width: 100%; max-width: 100%; min-width: 0; padding: 0.875rem; border: 1px solid color-mix(in oklab, var(--border, #d4d4d8) 60%, transparent); border-radius: 0.75rem; background: var(--background, #fff); color: var(--foreground, #18181b); line-height: 1.25; }
.stm-voice-widget.stm-voice-widget--collapsed { position: absolute; top: 0.5rem; right: 10px; z-index: 30; width: min(calc(100% - 20px), 32rem); pointer-events: auto; }
.stm-voice-widget-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; min-width: 0; line-height: 1.25; }
.stm-voice-widget-toolbar-buttons { display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
.stm-voice-widget-title { min-width: 0; flex: 1 1 auto; overflow: hidden; color: inherit; font-weight: 600; line-height: 1.25; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.stm-voice-widget-toolbar-buttons .stm-id-btn,
.stm-voice-widget-toolbar-buttons .stm-park-btn { width: 2rem; min-width: 2rem; height: 2rem; min-height: 2rem; }
.stm-voice-widget-title:hover { text-decoration: underline; }
.stm-voice-speaker, .stm-voice-timer-toggle, .stm-voice-collapse { display: inline-flex; align-items: center; justify-content: center; min-height: 2rem; gap: 0.25rem; border: 1px solid color-mix(in oklab, var(--border, #d4d4d8) 60%, transparent); border-radius: 0.375rem; background: transparent; color: inherit; padding: 0.35rem 0.5rem; cursor: pointer; }
.stm-voice-widget-content { display: grid; gap: 0.75rem; min-width: 0; max-height: 24rem; overflow: auto; }
.stm-voice-note-row-mount { min-width: 0; }
.stm-voice-timer-panel { display: grid; gap: 0.5rem; padding: 0.625rem; border: 1px solid color-mix(in oklab, var(--border, #d4d4d8) 60%, transparent); border-radius: 0.5rem; background: var(--muted, #f4f4f5); }
.stm-voice-timer-row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
.stm-voice-action { border: 1px solid color-mix(in oklab, var(--border, #d4d4d8) 60%, transparent); border-radius: 0.375rem; background: var(--background, #fff); color: inherit; padding: 0.4rem 0.6rem; cursor: pointer; }
.stm-voice-sound-prompt { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; color: var(--muted-foreground, #71717a); }
.stm-voice-widget[data-collapsed="true"] .stm-voice-widget-content { display: none; }
@media (max-width: 560px) {
  .stm-voice-widget { padding: 0.625rem; }
  .stm-voice-widget-toolbar { align-items: stretch; }
  .stm-voice-widget.stm-voice-widget--collapsed .stm-voice-widget-toolbar {
    align-items: center;
    flex-wrap: nowrap;
    gap: 0.375rem;
  }
  .stm-voice-widget.stm-voice-widget--collapsed .stm-voice-widget-toolbar-buttons {
    flex: 0 0 auto;
  }
  .stm-voice-widget-content { max-height: 18rem; }
}
@media (max-height: 560px) { .stm-voice-widget-content { max-height: 9rem; } }

`;

export const VOICE_WIDGET_STYLE_ELEMENT_ID = "say-to-me-widget-styles";

export function ensureVoiceWidgetStylesheet(
  doc: Document | null | undefined = typeof document !== "undefined" ? document : undefined,
): HTMLStyleElement | null {
  if (!doc?.head) return null;
  let style = doc.getElementById(VOICE_WIDGET_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = VOICE_WIDGET_STYLE_ELEMENT_ID;
    doc.head.append(style);
  }
  style.textContent = VOICE_WIDGET_STYLESHEET;
  return style;
}
