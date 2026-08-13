import { describe, expect, it } from "vite-plus/test";
import { VOICE_NOTE_MARKDOWN_STYLES } from "./VoiceNoteMarkdown.styles.ts";

describe("VoiceNoteMarkdown styles", () => {
  it("keeps typography, wrapping, compact variants, tokens, and host scope", () => {
    expect(VOICE_NOTE_MARKDOWN_STYLES).toContain("white-space: pre-wrap");
    expect(VOICE_NOTE_MARKDOWN_STYLES).toContain("overflow-wrap: anywhere");
    expect(VOICE_NOTE_MARKDOWN_STYLES).toContain("--foreground");
    expect(VOICE_NOTE_MARKDOWN_STYLES).toContain("max-height: 9rem");
    expect(VOICE_NOTE_MARKDOWN_STYLES).toContain("max-height: 7rem");
    expect(VOICE_NOTE_MARKDOWN_STYLES).toContain(
      "say-to-me-widget .stm-voice-note-markdown--compact",
    );
  });
});
