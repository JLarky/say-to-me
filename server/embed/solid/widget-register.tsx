/** @jsxImportSource solid-js */
import { liftSolid, useAttributes } from "@lift-html/solid";
import { onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { VoiceWidget } from "./VoiceWidget.tsx";
import { ensureWidgetStylesheet } from "./widget-styles.ts";
import { ensureVoiceNoteRowStylesheet } from "./voice-note-row-styles.ts";
import { VOICE_NOTE_MARKDOWN_STYLES } from "./components/VoiceNoteMarkdown.styles.ts";
import { VOICE_WIDGET_STYLESHEET } from "./voice-widget-styles.ts";
import { EMBED_WIDGET_TAG } from "./widget-shared.ts";
import { normalizeVoiceWidgetAttributes } from "./voice-widget-contract.ts";

/** Register `<say-to-me-widget>` via `@lift-html/solid`. */
export function registerWidget() {
  ensureWidgetStylesheet();
  ensureVoiceNoteRowStylesheet();
  const markdownStyles = document.getElementById(
    "say-to-me-widget-markdown-styles",
  ) as HTMLStyleElement | null;
  const markdownStyle = markdownStyles ?? document.createElement("style");
  markdownStyle.id = "say-to-me-widget-markdown-styles";
  markdownStyle.textContent = VOICE_NOTE_MARKDOWN_STYLES;
  if (!markdownStyles) document.head.append(markdownStyle);
  const voiceStyles = document.getElementById(
    "say-to-me-widget-voice-styles",
  ) as HTMLStyleElement | null;
  const voiceStyle = voiceStyles ?? document.createElement("style");
  voiceStyle.id = "say-to-me-widget-voice-styles";
  voiceStyle.textContent = VOICE_WIDGET_STYLESHEET;
  if (!voiceStyles) document.head.append(voiceStyle);
  return liftSolid(EMBED_WIDGET_TAG, {
    observedAttributes: [
      "session-id",
      "notes-base-url",
      "ui-base-url",
      "storage-key",
      "timers-base-url",
    ] as const,
    init() {
      const host = this as HTMLElement;
      const attrs = useAttributes(this);
      const attributes = () => {
        try {
          return normalizeVoiceWidgetAttributes({
            "session-id": attrs["session-id"],
            "notes-base-url": attrs["notes-base-url"],
            "ui-base-url": attrs["ui-base-url"],
            "storage-key": attrs["storage-key"],
            "timers-base-url": attrs["timers-base-url"],
          });
        } catch {
          return {
            "session-id": attrs["session-id"]?.trim() ?? "",
            "notes-base-url": attrs["notes-base-url"]?.trim() ?? "",
            "ui-base-url": attrs["ui-base-url"]?.trim() ?? "",
            "storage-key": attrs["storage-key"]?.trim() ?? "",
          };
        }
      };
      const errorMessage =
        "say-to-me-widget: missing required attribute session-id or notes-base-url";
      host.replaceChildren();
      if (attrs["session-id"]?.trim() && attrs["notes-base-url"]?.trim()) {
        host.removeAttribute("data-error");
      } else {
        host.setAttribute("data-error", errorMessage);
      }

      const dispose = render(() => <VoiceWidget attributes={attributes} el={host} />, host);
      onCleanup(dispose);
    },
  });
}
