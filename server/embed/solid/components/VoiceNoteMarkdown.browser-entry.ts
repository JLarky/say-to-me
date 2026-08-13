import { VoiceNoteMarkdown } from "./VoiceNoteMarkdown.tsx";

if (typeof document !== "undefined") {
  const probe = VoiceNoteMarkdown({ html: null });
  if (!(probe instanceof HTMLElement)) throw new Error("VoiceNoteMarkdown browser import failed");
}
