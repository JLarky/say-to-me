import {
  claimIdleWorkUnit,
  parseVoiceWidgetEvent,
  VOICE_WIDGET_QUEUE_IDLE_EVENT,
} from "./voice-widget-contract.ts";
import { enqueueVoiceAudio } from "./voice-widget-audio.ts";
import { IDLE_COMPLETION_DING_DURATION_MS, playIdleCompletionDing } from "./voice-widget-sound.ts";

const IDLE_DING_QUEUE_TIMEOUT_MS = IDLE_COMPLETION_DING_DURATION_MS + 2_000;

/** Listen for host idle events and play the chime on the widget speech queue. */
export function bindVoiceWidgetIdleQueue(host: HTMLElement): () => void {
  const seen = new Set<string>();
  const onQueueIdle = (event: Event) => {
    const detail = parseVoiceWidgetEvent(event);
    if (!detail || detail.type !== "queue-idle") return;
    const workUnitId = claimIdleWorkUnit(seen, detail.workUnitId);
    if (!workUnitId) return;
    host.dataset.lastQueuedIdleWorkUnit = workUnitId;
    void enqueueVoiceAudio(async () => {
      await playIdleCompletionDing();
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, IDLE_COMPLETION_DING_DURATION_MS);
      });
    }, IDLE_DING_QUEUE_TIMEOUT_MS);
  };
  host.addEventListener(VOICE_WIDGET_QUEUE_IDLE_EVENT, onQueueIdle);
  return () => host.removeEventListener(VOICE_WIDGET_QUEUE_IDLE_EVENT, onQueueIdle);
}
