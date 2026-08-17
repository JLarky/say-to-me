import { VoiceNoteMarkdown } from "./VoiceNoteMarkdown.tsx";

// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Environment guard: detects whether a DOM `document` global exists (SSR/Node safety).
if (typeof document !== "undefined") {
  const probe = VoiceNoteMarkdown({ html: null });
  if (!(probe instanceof HTMLElement)) throw new Error("VoiceNoteMarkdown browser import failed");
}
