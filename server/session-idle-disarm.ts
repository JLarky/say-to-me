import { isSessionIdleRoutine, type Routine } from "@say-to-me/routines/workflow";
import { listWatchingMessagesBySourceMessageId, setCompletionWatchStatus } from "./messages.ts";
import { stopCompletionWatch } from "./opencode/completion-watch.ts";

/** Stop durable + in-memory watches tied to a session_idle routine. Returns sourceMessageId when set. */
export function disarmSessionIdleWatch(routine: Routine): number | null {
  if (!isSessionIdleRoutine(routine)) return null;
  const sourceMessageId = routine.trigger.sourceMessageId;
  if (sourceMessageId == null) return null;
  for (const message of listWatchingMessagesBySourceMessageId(sourceMessageId)) {
    setCompletionWatchStatus(message.id, "cancelled");
    stopCompletionWatch(message.id);
  }
  return sourceMessageId;
}
