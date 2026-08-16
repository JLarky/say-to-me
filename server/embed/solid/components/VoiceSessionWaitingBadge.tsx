import { createRenderEffect } from "solid-js";
import { voiceWidgetWaitingClass, voiceWidgetWaitingLabel } from "../voice-widget-content.ts";

function resolveMaybeAccessor<T>(value: T | (() => T)): T {
  return value instanceof Function ? value() : value;
}

export function VoiceSessionWaitingBadge(props: {
  waitingState: string | null | undefined | (() => string | null | undefined);
}) {
  const getWaitingState = () => resolveMaybeAccessor(props.waitingState);
  const badge = document.createElement("span");
  const update = () => {
    const waitingState = getWaitingState();
    badge.className = `stm-voice-waiting-badge ${voiceWidgetWaitingClass(waitingState)}`;
    badge.dataset.waitingState = waitingState ?? "";
    badge.textContent = voiceWidgetWaitingLabel(waitingState);
  };
  update();
  createRenderEffect(update);
  return badge;
}
