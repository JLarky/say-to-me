// @ts-expect-error -- Solid omits declarations for the direct browser runtime.
import { createRenderEffect } from "solid-js/dist/solid.js";
import { voiceWidgetStatusPresentation } from "../voice-widget-content.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

type StatusValue = string | (() => string);
type PlayingValue = boolean | (() => boolean);

export function VoiceNoteStatusBadge(props: { status: StatusValue; isPlaying?: PlayingValue }) {
  const getStatus = () =>
    (typeof props.isPlaying === "function" ? props.isPlaying() : props.isPlaying)
      ? "speaking"
      : typeof props.status === "function"
        ? props.status()
        : props.status;
  const badge = document.createElement("span");
  const update = () => {
    const status = getStatus();
    const presentation = voiceWidgetStatusPresentation(status);
    badge.className = `stm-voice-message-status ${presentation.className}`;
    badge.dataset.status = status;
    badge.replaceChildren();
    if (status === "played") {
      const icon = document.createElementNS(SVG_NS, "svg");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("width", "12");
      icon.setAttribute("height", "12");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M20 6 9 17l-5-5");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      icon.append(path);
      badge.append(icon);
    }
    badge.append(status);
  };
  update();
  createRenderEffect(update);
  return badge;
}
