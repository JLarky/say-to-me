export const VOICE_NOTE_ROW_STYLE_ELEMENT_ID = "say-to-me-widget-note-styles";

export const VOICE_NOTE_ROW_STYLESHEET = `
say-to-me-widget .stm-voice-note-row {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid color-mix(in oklab, var(--border, #e4e4e7) 60%, transparent);
  border-radius: var(--radius-xl, 0.75rem);
  background: color-mix(in oklab, var(--background, #fff) 55%, transparent);
  padding: 0.625rem 0.75rem;
  color: var(--card-foreground, var(--foreground, inherit));
  transition: background-color 150ms ease, border-color 150ms ease;
}
say-to-me-widget .stm-voice-note-row[hidden] { display: none; }
say-to-me-widget .stm-voice-note-row[data-playing="true"] {
  border-color: color-mix(in oklab, var(--color-sky-500, #0ea5e9) 45%, transparent);
  background: color-mix(in oklab, var(--color-sky-500, #0ea5e9) 8%, var(--background, #fff));
}
say-to-me-widget .stm-voice-note-row-body {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
say-to-me-widget .stm-voice-note-row-content {
  min-width: 0;
  flex: 1 1 auto;
}
say-to-me-widget .stm-voice-note-row-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 0.5rem;
  row-gap: 0.25rem;
  color: var(--muted-foreground, #71717a);
  font-size: 0.75rem;
  line-height: 1rem;
}
say-to-me-widget .stm-voice-note-row-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
say-to-me-widget .stm-voice-note-row-author { color: var(--foreground, inherit); font-weight: 500; }
say-to-me-widget .stm-voice-note-row-text {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
  line-height: 1.25rem;
}
say-to-me-widget .stm-voice-note-extra-markdown {
  margin-top: 0.5rem;
  border: 1px solid color-mix(in oklab, var(--border, #e4e4e7) 70%, transparent);
  border-radius: var(--radius-xl, 0.75rem);
  background: color-mix(in oklab, var(--muted, #f4f4f5) 25%, transparent);
  padding: 0.625rem 0.75rem;
}
say-to-me-widget .stm-voice-note-extra-markdown[hidden] { display: none; }
say-to-me-widget .stm-voice-note-extra-markdown-header { display: flex; justify-content: flex-end; }
say-to-me-widget .stm-voice-note-copy-markdown {
  display: inline-flex;
  width: 2rem;
  min-width: 2rem;
  height: 2rem;
  min-height: 2rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md, 0.375rem);
  background: transparent;
  padding: 0;
  color: var(--muted-foreground, #71717a);
  cursor: pointer;
}
say-to-me-widget .stm-voice-note-copy-markdown:hover { color: var(--foreground, inherit); background: var(--muted, #f4f4f5); }
say-to-me-widget .stm-voice-note-copy-markdown:focus-visible { outline: 2px solid var(--ring, currentColor); outline-offset: 2px; }
say-to-me-widget .stm-voice-note-copy-markdown svg { width: 0.75rem; height: 0.75rem; }
say-to-me-widget .stm-voice-note-copy-markdown--copied { color: var(--primary, currentColor); }
say-to-me-widget .stm-voice-note-row-sessions { min-width: 0; }
say-to-me-widget .stm-voice-note-row-attachments { min-width: 0; }
say-to-me-widget .stm-voice-note-row-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.25rem;
}
say-to-me-widget .stm-voice-note-row-actions[hidden] { display: none; }
say-to-me-widget .stm-voice-note-play {
  display: inline-flex;
  min-height: 2rem;
  height: 2rem;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  border: 1px solid var(--border, #e4e4e7);
  border-radius: var(--radius-md, 0.375rem);
  background: var(--background, #fff);
  padding: 0 0.5rem;
  color: var(--foreground, inherit);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
}
say-to-me-widget .stm-voice-note-play:hover { background: var(--muted, #f4f4f5); }
say-to-me-widget .stm-voice-note-play svg { width: 0.75rem; height: 0.75rem; }
say-to-me-widget .stm-voice-note-stop {
  display: inline-flex;
  width: 2rem;
  min-width: 2rem;
  height: 2rem;
  min-height: 2rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md, 0.375rem);
  background: transparent;
  padding: 0;
  color: var(--muted-foreground, #71717a);
  cursor: pointer;
}
say-to-me-widget .stm-voice-note-stop:hover:not(:disabled) { background: var(--muted, #f4f4f5); color: var(--foreground, inherit); }
say-to-me-widget .stm-voice-note-stop:focus-visible,
say-to-me-widget .stm-voice-note-play:focus-visible { outline: 2px solid var(--ring, currentColor); outline-offset: 2px; }
say-to-me-widget .stm-voice-note-stop:disabled { cursor: default; opacity: 0.5; }
say-to-me-widget .stm-voice-note-stop svg { width: 0.75rem; height: 0.75rem; }

say-to-me-widget .stm-voice-note-markdown--compact {
  max-height: 9rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}
@media (max-height: 900px) {
  say-to-me-widget .stm-voice-note-markdown--compact { max-height: 7rem; }
  say-to-me-widget .stm-voice-note-row { border-radius: var(--radius-lg, 0.5rem); padding: 0.375rem; }
  say-to-me-widget .stm-voice-note-row-body { gap: 0.375rem; }
  say-to-me-widget .stm-voice-note-row-meta { column-gap: 0.375rem; row-gap: 0.125rem; font-size: 10px; }
  say-to-me-widget .stm-voice-note-row-text { margin-top: 0.125rem; font-size: 11px; line-height: 1rem; }
  say-to-me-widget .stm-voice-note-extra-markdown { margin-top: 0.25rem; border-radius: var(--radius-lg, 0.5rem); padding: 0.375rem; }
  say-to-me-widget .stm-voice-note-play { min-height: 2rem; height: 2rem; padding: 0 0.375rem; font-size: 10px; }
  say-to-me-widget .stm-voice-note-stop { width: 2rem; min-width: 2rem; height: 2rem; min-height: 2rem; }
}
@media (max-width: 560px) {
  say-to-me-widget .stm-voice-note-row-body { display: block; }
  say-to-me-widget .stm-voice-note-row-actions { justify-content: flex-end; margin-top: 0.5rem; }
}
`;
export function ensureVoiceNoteRowStylesheet(
  doc: Document | null | undefined = typeof document !== "undefined" ? document : undefined,
): HTMLStyleElement | null {
  if (!doc?.head) return null;
  let style = doc.getElementById(VOICE_NOTE_ROW_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = VOICE_NOTE_ROW_STYLE_ELEMENT_ID;
    doc.head.append(style);
  }
  style.textContent = VOICE_NOTE_ROW_STYLESHEET;
  return style;
}
