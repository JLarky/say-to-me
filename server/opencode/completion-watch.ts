import { Effect, Fiber, Layer } from "effect";
import {
  CompletionWatchEffects,
  CompletionWatchEffectsError,
  type CompletionWatchEffectsService,
  CompletionWatchOpenCode,
  type CompletionWatchOpenCodeService,
  CompletionWatchStore,
  CompletionWatchStoreError,
  type CompletionWatchStoreService,
  DEFAULT_COMPLETION_WATCH_POLL_MS,
  runCompletionWatchTickEffect,
} from "@say-to-me/completion-watch/workflow";
import { broadcastQueueEffect } from "../broadcast.ts";
import {
  getMessage,
  insertForwardMessageRow,
  insertMessageRow,
  listActiveCompletionWatches,
  listQueuedSourceCompletionNotifications,
  markCompletionWorkSeen,
  setCompletionSourceNotification,
  setCompletionTargetNotification,
  setCompletionWatchNextCheckAt,
  setCompletionWatchStatus,
  updateMessageText,
  updateOpencodeDelivery,
} from "../messages.ts";
import {
  enqueueSourceCompletionNotice,
  getSessionWorkStatus,
} from "../external-cli/session-work-status.ts";
import { detectSessionBackend } from "../session-id.ts";
import { getOpenCodeStatus } from "./client.ts";
import { openCodeBaseUrl } from "./http.ts";
import {
  completeSessionIdleRoutine,
  findActiveSessionIdleRoutineBySourceMessageId,
  findSessionIdleRoutineBySourceMessageId,
} from "../routines.ts";

export {
  CompletionWatchEffects,
  CompletionWatchEffectsError,
  type CompletionWatchEffectsService,
  CompletionWatchOpenCode,
  type CompletionWatchOpenCodeService,
  CompletionWatchStore,
  CompletionWatchStoreError,
  type CompletionWatchStoreService,
  DEFAULT_COMPLETION_WATCH_POLL_MS,
  runCompletionWatchTickEffect,
  type CompletionWatchEnv,
  type OpenCodeSessionStatus,
  type WatchedMessage,
} from "@say-to-me/completion-watch/workflow";

function tryWatchStore<A>(try_: () => A): Effect.Effect<A, CompletionWatchStoreError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new CompletionWatchStoreError({ cause }),
  });
}

function tryWatchEffects<A>(try_: () => A): Effect.Effect<A, CompletionWatchEffectsError> {
  return Effect.try({
    try: try_,
    catch: (cause) => new CompletionWatchEffectsError({ cause }),
  });
}
const POLL_MS = Number(
  process.env.SAY_TO_ME_COMPLETION_WATCH_POLL_MS || DEFAULT_COMPLETION_WATCH_POLL_MS,
);
const activePollers = new Map<number, Fiber.RuntimeFiber<void, never>>();
const activeBaseUrls = new Map<number, string>();
let autoPollCompletionWatches = true;

export const CompletionWatchOpenCodeLive = Layer.succeed(CompletionWatchOpenCode, {
  getStatus: (sessionId, options) =>
    Effect.tryPromise(async () => {
      if (detectSessionBackend(sessionId) === "opencode") {
        return await getOpenCodeStatus(sessionId, options);
      }
      const status = await getSessionWorkStatus(sessionId);
      return status === "unavailable" ? null : status;
    }).pipe(Effect.orElseSucceed(() => null)),
} satisfies CompletionWatchOpenCodeService);

export const CompletionWatchStoreLive = Layer.succeed(CompletionWatchStore, {
  getMessage: (id) => tryWatchStore(() => getMessage(id)),
  insertMessageRow: (input) => tryWatchStore(() => insertMessageRow(input)),
  insertForwardMessageRow: (input) => tryWatchStore(() => insertForwardMessageRow(input)),
  listQueuedSourceCompletionNotifications: (sourceSessionId, targetSessionId) =>
    tryWatchStore(() => listQueuedSourceCompletionNotifications(sourceSessionId, targetSessionId)),
  updateMessageText: (id, text) => tryWatchStore(() => updateMessageText(id, text)),
  updateOpencodeDelivery: (id, status, error, opencodeMessageId) =>
    tryWatchStore(() => updateOpencodeDelivery(id, status, error, opencodeMessageId)),
  setCompletionTargetNotification: (id, notificationId) =>
    tryWatchStore(() => setCompletionTargetNotification(id, notificationId)),
  setCompletionSourceNotification: (id, notificationId) =>
    tryWatchStore(() => setCompletionSourceNotification(id, notificationId)),
  setCompletionWatchNextCheckAt: (id, nextCheckAt) =>
    tryWatchStore(() => setCompletionWatchNextCheckAt(id, nextCheckAt)),
  setCompletionWatchStatus: (id, status, nextCheckAt) =>
    tryWatchStore(() => setCompletionWatchStatus(id, status, nextCheckAt)),
  markCompletionWorkSeen: (id) => tryWatchStore(() => markCompletionWorkSeen(id)),
} satisfies CompletionWatchStoreService);

export function stopCompletionWatch(messageId: number): void {
  const poller = activePollers.get(messageId);
  if (poller) {
    Effect.runFork(Fiber.interrupt(poller));
    activePollers.delete(messageId);
  }
  activeBaseUrls.delete(messageId);
}

export const CompletionWatchEffectsLive = Layer.succeed(CompletionWatchEffects, {
  // Await refresh + session-list fan-out so status reads after broadcast see a warm cache.
  broadcastQueue: (sessionId) => broadcastQueueEffect(sessionId),
  getSessionWorkStatus: (sessionId) =>
    Effect.tryPromise({
      try: () => getSessionWorkStatus(sessionId),
      catch: (cause) => new CompletionWatchEffectsError({ cause }),
    }),
  enqueueSourceCompletionNotice: (input) =>
    tryWatchEffects(() => enqueueSourceCompletionNotice(input)),
  stopWatch: (messageId) => tryWatchEffects(() => stopCompletionWatch(messageId)),
  getActiveBaseUrl: (messageId) => tryWatchEffects(() => activeBaseUrls.get(messageId)),
  getSessionIdleGate: (sourceMessageId) =>
    tryWatchEffects(() => {
      if (sourceMessageId == null) return "continue";
      if (findActiveSessionIdleRoutineBySourceMessageId(sourceMessageId)) return "continue";
      const routine = findSessionIdleRoutineBySourceMessageId(sourceMessageId);
      // Cancelled / fired / failed waits must not notify again. No row = legacy path.
      return routine ? "stop" : "continue";
    }),
  completeSessionIdle: (input) =>
    tryWatchEffects(() => {
      if (input.sourceMessageId == null) return;
      const routine =
        findActiveSessionIdleRoutineBySourceMessageId(input.sourceMessageId) ??
        findSessionIdleRoutineBySourceMessageId(input.sourceMessageId);
      if (!routine) return;
      completeSessionIdleRoutine({
        routineId: routine.id,
        messageId: input.notificationMessageId,
        targetSessionId: input.targetSessionId,
        targetMessageId: input.targetMessageId,
        sourceMessageId: input.sourceMessageId,
        reason: input.reason,
      });
    }),
} satisfies CompletionWatchEffectsService);

function completionWatchPoller(messageId: number): Effect.Effect<void, never> {
  const tick = Effect.tryPromise({
    try: () => runCompletionWatchTick(messageId),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => console.error("[completion-watch] poll failed:", error.message)),
    ),
  );
  const pollDelay = Effect.async<void>((resume) => {
    const timeout = setTimeout(() => resume(Effect.void), POLL_MS);
    timeout.unref?.();
    return Effect.sync(() => clearTimeout(timeout));
  });
  return tick.pipe(Effect.zipRight(pollDelay), Effect.forever);
}

export function startCompletionWatch(
  messageId: number,
  { baseUrl = openCodeBaseUrl() } = {},
): void {
  activeBaseUrls.set(messageId, baseUrl);
  if (!autoPollCompletionWatches) return;
  if (activePollers.has(messageId)) return;
  activePollers.set(messageId, Effect.runFork(completionWatchPoller(messageId)));
}

export async function runCompletionWatchTick(messageId: number): Promise<void> {
  await Effect.runPromise(
    runCompletionWatchTickEffect(messageId, { pollMs: POLL_MS }).pipe(
      Effect.provide(CompletionWatchOpenCodeLive),
      Effect.provide(CompletionWatchStoreLive),
      Effect.provide(CompletionWatchEffectsLive),
    ),
  );
}

export function setCompletionWatchAutoPollingForTest(enabled: boolean): void {
  autoPollCompletionWatches = enabled;
}

export function resumeCompletionWatches(sessionId?: string): void {
  for (const message of listActiveCompletionWatches(sessionId)) startCompletionWatch(message.id);
}

export function stopAllCompletionWatches(): void {
  for (const poller of activePollers.values()) Effect.runFork(Fiber.interrupt(poller));
  activePollers.clear();
  activeBaseUrls.clear();
}
