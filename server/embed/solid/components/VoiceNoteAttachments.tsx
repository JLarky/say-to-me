// @ts-expect-error -- Solid omits declarations for the direct browser runtime entry.
import { createRenderEffect } from "solid-js/dist/solid.js";
import {
  imageAttachmentThumbnail,
  sayToMeAttachmentUrl,
  type VoiceWidgetUiBaseUrl,
} from "../voice-widget-content.ts";

type AttachmentRecord = { readonly id: number; readonly originalName: string };

function attachmentRecord(value: unknown): AttachmentRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === "number" &&
    Number.isInteger(row.id) &&
    typeof row.originalName === "string"
    ? { id: row.id, originalName: row.originalName }
    : null;
}

export function VoiceNoteAttachments(props: {
  readonly attachments: ReadonlyArray<unknown> | (() => ReadonlyArray<unknown>);
  readonly uiBaseUrl?: VoiceWidgetUiBaseUrl;
}): HTMLElement | null {
  const isAccessor = typeof props.attachments === "function";
  const getAttachments: () => ReadonlyArray<unknown> =
    typeof props.attachments === "function"
      ? (props.attachments as () => ReadonlyArray<unknown>)
      : () => props.attachments as ReadonlyArray<unknown>;
  if (!isAccessor && props.attachments.length === 0) return null;

  const container = document.createElement("div");
  container.className = "stm-voice-note-attachments";

  const render = () => {
    const attachments = getAttachments();
    const children: HTMLElement[] = [];
    for (const attachment of attachments) {
      const metadata = attachmentRecord(attachment);
      const thumbnail = imageAttachmentThumbnail(attachment);
      if (!metadata || !thumbnail) continue;

      const attachmentUrl = sayToMeAttachmentUrl(metadata.id, props.uiBaseUrl);
      const link = attachmentUrl ? document.createElement("a") : document.createElement("span");
      link.className = "stm-voice-note-attachment";
      if (attachmentUrl) {
        const anchor = link as HTMLAnchorElement;
        anchor.href = attachmentUrl;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
      link.setAttribute("aria-label", "Open " + metadata.originalName);

      const image = document.createElement("img");
      image.className = "stm-voice-note-attachment-image";
      image.src = thumbnail;
      image.alt = metadata.originalName;
      link.append(image);
      children.push(link);
    }
    container.replaceChildren(...children);
  };

  if (isAccessor) createRenderEffect(render);
  else render();
  return container;
}
