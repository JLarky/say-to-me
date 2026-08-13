/** Scoped styles for VoiceNoteMarkdown; imported by the future widget entry. */
export const VOICE_NOTE_MARKDOWN_STYLES = `
say-to-me-widget .stm-voice-note-markdown,
:host .stm-voice-note-markdown {
  min-width: 0;
  color: color-mix(in oklab, var(--foreground, #17202a) 80%, transparent);
  font-size: 0.875rem;
  line-height: 1.625;
}
say-to-me-widget .stm-voice-note-markdown > :first-child,
:host .stm-voice-note-markdown > :first-child { margin-top: 0; }
say-to-me-widget .stm-voice-note-markdown > :last-child,
:host .stm-voice-note-markdown > :last-child { margin-bottom: 0; }
say-to-me-widget .stm-voice-note-markdown :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, h5, h6),
:host .stm-voice-note-markdown :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, h5, h6) { margin-block: 0.55rem; }
say-to-me-widget .stm-voice-note-markdown :is(ul, ol),
:host .stm-voice-note-markdown :is(ul, ol) { padding-left: 1.4rem; }
say-to-me-widget .stm-voice-note-markdown table,
:host .stm-voice-note-markdown table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
say-to-me-widget .stm-voice-note-markdown :is(th, td),
:host .stm-voice-note-markdown :is(th, td) { border: 1px solid color-mix(in oklab, var(--foreground, #17202a) 14%, transparent); padding: 0.32rem 0.5rem; text-align: left; }
say-to-me-widget .stm-voice-note-markdown th,
:host .stm-voice-note-markdown th { background: color-mix(in oklab, var(--foreground, #17202a) 6%, transparent); font-weight: 800; }
say-to-me-widget .stm-voice-note-markdown code,
:host .stm-voice-note-markdown code { border-radius: 0.35rem; background: color-mix(in oklab, var(--foreground, #17202a) 8%, transparent); padding: 0.08rem 0.22rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 0.86em; }
say-to-me-widget .stm-voice-note-markdown pre,
:host .stm-voice-note-markdown pre { overflow-x: auto; border-radius: 0.75rem; background: color-mix(in oklab, var(--foreground, #17202a) 92%, transparent); color: var(--background, #fffdf8); padding: 0.7rem; }
say-to-me-widget .stm-voice-note-markdown pre code,
:host .stm-voice-note-markdown pre code { display: block; overflow-wrap: anywhere; white-space: pre-wrap; background: transparent; padding: 0; }
say-to-me-widget .stm-voice-note-markdown a,
:host .stm-voice-note-markdown a { color: var(--color-blue-600, #1a56db); font-weight: 700; }
say-to-me-widget .stm-voice-note-markdown--compact,
say-to-me-widget .stm-voice-note-markdown--compact { max-height: 9rem; overflow-y: auto; overscroll-behavior: contain; }
@media (max-height: 900px) {
  say-to-me-widget .stm-voice-note-markdown--compact,
  say-to-me-widget .stm-voice-note-markdown--compact,
  :host .stm-voice-note-markdown--compact { max-height: 7rem; }
}
`;
