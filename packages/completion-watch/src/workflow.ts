import { Clock, Context, Data, Effect } from "effect";

export const DEFAULT_COMPLETION_WATCH_POLL_MS = 250;
/** Quiet window after idle before notify. Tens of seconds, not another 30s lease. */
export const DEFAULT_COMPLETION_WATCH_QUIET_MS = 20_000;
/**
 * Matches server/external-cli/durable-delivery.ts `JOB_LEASE_MS`.
 * Not a turn-end signal — a ~100s CLI turn outlives this.
 */
export const EXTERNAL_CLI_JOB_LEASE_MS = 30_000;

/** Live watches, including the quiet-window pause. Restart must still resume these. */
export const LIVE_COMPLETION_WATCH_STATUSES = ["watching", "debouncing"] as const;
/** `listActiveCompletionWatches` / disarm: live plus source_failed retries. */
export const RESUMABLE_COMPLETION_WATCH_STATUSES = [
  "watching",
  "debouncing",
  "source_failed",
] as const;

export function isLiveCompletionWatchStatus(status: string | null | undefined): boolean {
  return status === "watching" || status === "debouncing";
}

export type OpenCodeSessionStatus =
  | "pending"
  | "idle"
  | "retrying"
  | "error"
  | "unavailable"
  | null;

/** Message fields the completion-watch tick reads and writes. */
export type WatchedMessage = {
  id: number;
  sessionId: string;
  text: string;
  extraMarkdown: string | null;
  author: "agent" | "user";
  status: string;
  links: string | null;
  sessionRefs: string | null;
  clientMessageId: string | null;
  opencodeDeliveryStatus: string | null;
  opencodeDeliveryError: string | null;
  opencodeMessageId: string | null;
  forwardRole: string | null;
  forwardSourceSessionId: string | null;
  forwardSourceMessageId: number | null;
  forwardTargetSessionId: string | null;
  forwardTargetMessageId: number | null;
  forwardStatus: string | null;
  completionWatchStatus: string | null;
  completionWatchWorkSeen: number;
  completionWatchNextCheckAt: number;
  completionSourceSessionId: string | null;
  completionSourceMessageId: number | null;
  completionTargetNotificationMessageId: number | null;
  completionSourceNotificationMessageId: number | null;
};

export type InsertMessageRowInput = {
  sessionId: string;
  text: string;
  extraMarkdown: string | null;
  author: "agent" | "user";
  status: string;
  links: string | null;
  sessionRefs: string | null;
  clientMessageId: string | null;
};

export type InsertForwardMessageRowInput = {
  sessionId: string;
  text: string;
  author: "agent" | "user";
  status: string;
  sessionRefs: string | null;
  clientMessageId: string | null;
  forwardRole: string;
  forwardSourceSessionId: string;
  forwardSourceMessageId: number | null;
  forwardTargetSessionId: string;
  forwardTargetMessageId: number | null;
  forwardStatus: string;
};

export class CompletionWatchStoreError extends Data.TaggedError("CompletionWatchStoreError")<{
  readonly cause: unknown;
}> {}

export class CompletionWatchEffectsError extends Data.TaggedError("CompletionWatchEffectsError")<{
  readonly cause: unknown;
}> {}

export type CompletionWatchOpenCodeService = {
  getStatus: (
    sessionId: string,
    options?: { baseUrl?: string },
  ) => Effect.Effect<OpenCodeSessionStatus>;
};

export const CompletionWatchOpenCode = Context.GenericTag<CompletionWatchOpenCodeService>(
  "say-to-me/CompletionWatchOpenCode",
);

export type CompletionWatchStoreService = {
  getMessage: (id: number) => Effect.Effect<WatchedMessage | null, CompletionWatchStoreError>;
  insertMessageRow: (
    input: InsertMessageRowInput,
  ) => Effect.Effect<WatchedMessage, CompletionWatchStoreError>;
  insertForwardMessageRow: (
    input: InsertForwardMessageRowInput,
  ) => Effect.Effect<WatchedMessage, CompletionWatchStoreError>;
  listQueuedSourceCompletionNotifications: (
    sourceSessionId: string,
    targetSessionId: string,
  ) => Effect.Effect<WatchedMessage[], CompletionWatchStoreError>;
  updateMessageText: (id: number, text: string) => Effect.Effect<void, CompletionWatchStoreError>;
  updateOpencodeDelivery: (
    id: number,
    status: string,
    error: string | null,
    opencodeMessageId: string | null,
  ) => Effect.Effect<void, CompletionWatchStoreError>;
  setCompletionTargetNotification: (
    id: number,
    notificationId: number,
  ) => Effect.Effect<void, CompletionWatchStoreError>;
  setCompletionSourceNotification: (
    id: number,
    notificationId: number,
  ) => Effect.Effect<void, CompletionWatchStoreError>;
  setCompletionWatchNextCheckAt: (
    id: number,
    nextCheckAt: number,
  ) => Effect.Effect<void, CompletionWatchStoreError>;
  setCompletionWatchStatus: (
    id: number,
    status: string,
    nextCheckAt?: number,
  ) => Effect.Effect<void, CompletionWatchStoreError>;
  markCompletionWorkSeen: (id: number) => Effect.Effect<void, CompletionWatchStoreError>;
};

export const CompletionWatchStore = Context.GenericTag<CompletionWatchStoreService>(
  "say-to-me/CompletionWatchStore",
);

export type CompletionWatchEffectsService = {
  broadcastQueue: (sessionId: string) => Effect.Effect<void, CompletionWatchEffectsError>;
  getSessionWorkStatus: (sessionId: string) => Effect.Effect<string, CompletionWatchEffectsError>;
  enqueueSourceCompletionNotice: (input: {
    messageId: number;
    messageSessionId: string;
    sessionId: string;
  }) => Effect.Effect<void, CompletionWatchEffectsError>;
  stopWatch: (messageId: number) => Effect.Effect<void, CompletionWatchEffectsError>;
  getActiveBaseUrl: (
    messageId: number,
  ) => Effect.Effect<string | undefined, CompletionWatchEffectsError>;
  /**
   * Phase 2 session_idle gate: `continue` if active wait (or no routine yet),
   * `stop` if the wait was cancelled/deleted.
   */
  getSessionIdleGate: (
    sourceMessageId: number | null,
  ) => Effect.Effect<"continue" | "stop", CompletionWatchEffectsError>;
  completeSessionIdle: (input: {
    sourceMessageId: number | null;
    notificationMessageId: number;
    targetSessionId: string;
    targetMessageId: number;
    reason: "idle" | "failed";
  }) => Effect.Effect<void, CompletionWatchEffectsError>;
};

export const CompletionWatchEffects = Context.GenericTag<CompletionWatchEffectsService>(
  "say-to-me/CompletionWatchEffects",
);

export type CompletionWatchEnv =
  | CompletionWatchOpenCodeService
  | CompletionWatchStoreService
  | CompletionWatchEffectsService;

function isWorking(status: OpenCodeSessionStatus): boolean {
  return status === "pending";
}

/**
 * Whether the relayed prompt was ever handed to the target agent.
 *
 * `queued` and no status are the two states that mean it was not: the message
 * is still waiting for a delivery slot (target busy, or a delivery backing off
 * between attempts). Notifying the source there reports a relay complete that
 * the target has not even read yet — and `completionWatchWorkSeen` cannot rule
 * it out, since an earlier attempt may have set that flag before the message
 * went back to the queue.
 *
 * `failed` deliberately counts as reached: an external CLI marks a dispatched
 * delivery failed when it could not confirm the outcome, and the agent may well
 * have done the work, so those watches still resolve on idle rather than
 * stranding the source.
 */
export function promptReachedTarget(deliveryStatus: string | null): boolean {
  return deliveryStatus != null && deliveryStatus !== "queued";
}

function targetNoticeText(_targetSessionId: string): string {
  return "Session is now idle.";
}

function systemTextFragment(text: string): string {
  return text.replace(/[<>]/g, "").trim();
}

function sourceCompletionEntry(watched: WatchedMessage): string {
  const targetMessage = watched.forwardTargetMessageId ?? watched.id;
  const prompt = systemTextFragment(watched.text);
  return prompt ? `target ${targetMessage}: ${prompt}` : `target ${targetMessage}`;
}

function sourceNoticeText(
  _watched: WatchedMessage,
  entries = [sourceCompletionEntry(_watched)],
): string {
  return entries.length > 1 ? "Sessions are now idle." : "Session is now idle.";
}

function sourceNoticeEntries(text: string): string[] {
  const legacy = text.match(
    /^<say-to-me-system>.*? is idle now after forwarded messages?: ([\s\S]*?)<\/say-to-me-system>$/,
  );
  if (legacy?.[1]) {
    return legacy[1]
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  // Speakable notices do not embed entry lists; synthesize counts for coalescing.
  if (text.trim() === "Sessions are now idle.") return ["prior-a", "prior-b"];
  if (text.trim() === "Session is now idle.") return ["prior"];
  return [];
}

function appendSourceNoticeEntry(
  store: CompletionWatchStoreService,
  notification: WatchedMessage,
  watched: WatchedMessage,
): Effect.Effect<void, CompletionWatchStoreError> {
  return Effect.gen(function* () {
    const entry = sourceCompletionEntry(watched);
    const entries = sourceNoticeEntries(notification.text);
    if (entries.includes(entry)) return;
    yield* store.updateMessageText(notification.id, sourceNoticeText(watched, [...entries, entry]));
  });
}

function insertTargetNotification(
  store: CompletionWatchStoreService,
  effects: CompletionWatchEffectsService,
  watched: WatchedMessage,
): Effect.Effect<number, CompletionWatchStoreError | CompletionWatchEffectsError> {
  return Effect.gen(function* () {
    if (watched.completionTargetNotificationMessageId) {
      return watched.completionTargetNotificationMessageId;
    }
    const message = yield* store.insertMessageRow({
      sessionId: watched.sessionId,
      text: targetNoticeText(watched.sessionId),
      extraMarkdown: null,
      author: "agent",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    yield* store.updateOpencodeDelivery(message.id, "ui_only", null, null);
    yield* store.setCompletionTargetNotification(watched.id, message.id);
    yield* effects.broadcastQueue(watched.sessionId);
    return message.id;
  });
}

function deliverSourceNotification(
  store: CompletionWatchStoreService,
  effects: CompletionWatchEffectsService,
  watched: WatchedMessage,
): Effect.Effect<boolean, CompletionWatchStoreError | CompletionWatchEffectsError> {
  const sourceSessionId = watched.completionSourceSessionId;
  if (!sourceSessionId) return Effect.succeed(true);
  const sourceMessageId = watched.completionSourceMessageId ?? watched.forwardSourceMessageId;
  const targetMessageId = watched.forwardTargetMessageId ?? watched.id;

  return Effect.gen(function* () {
    let notification = watched.completionSourceNotificationMessageId
      ? yield* store.getMessage(watched.completionSourceNotificationMessageId)
      : null;
    if (!notification && sourceMessageId) {
      const sourceMessage = yield* store.getMessage(sourceMessageId);
      notification =
        sourceMessage?.forwardStatus === "notified" && sourceMessage.forwardTargetMessageId != null
          ? yield* store.getMessage(sourceMessage.forwardTargetMessageId)
          : null;
      if (notification) {
        yield* store.setCompletionSourceNotification(watched.id, notification.id);
      }
    }
    if (!notification) {
      const existingQueued = (yield* store.listQueuedSourceCompletionNotifications(
        sourceSessionId,
        watched.sessionId,
      ))[0];
      if (existingQueued) {
        yield* appendSourceNoticeEntry(store, existingQueued, watched);
        notification = (yield* store.getMessage(existingQueued.id)) ?? existingQueued;
        yield* store.setCompletionSourceNotification(watched.id, notification.id);
        yield* effects.broadcastQueue(sourceSessionId);
      }
    }
    if (!notification) {
      notification = sourceMessageId
        ? yield* store.insertForwardMessageRow({
            sessionId: sourceSessionId,
            text: sourceNoticeText(watched),
            author: "user",
            status: "received",
            sessionRefs: JSON.stringify([{ id: watched.sessionId }]),
            clientMessageId: null,
            forwardRole: "source",
            forwardSourceSessionId: sourceSessionId,
            forwardSourceMessageId: sourceMessageId,
            forwardTargetSessionId: watched.sessionId,
            forwardTargetMessageId: targetMessageId,
            forwardStatus: "completed",
          })
        : yield* store.insertMessageRow({
            sessionId: sourceSessionId,
            text: sourceNoticeText(watched),
            extraMarkdown: null,
            author: "user",
            status: "received",
            links: null,
            sessionRefs: JSON.stringify([{ id: watched.sessionId }]),
            clientMessageId: null,
          });
      yield* store.setCompletionSourceNotification(watched.id, notification.id);
      yield* effects.broadcastQueue(sourceSessionId);
    }

    const status = yield* effects.getSessionWorkStatus(sourceSessionId);
    if (status === "pending") {
      if (notification.opencodeDeliveryStatus !== "queued") {
        yield* store.updateOpencodeDelivery(notification.id, "queued", null, null);
        yield* effects.enqueueSourceCompletionNotice({
          messageId: notification.id,
          messageSessionId: sourceSessionId,
          sessionId: sourceSessionId,
        });
        yield* effects.broadcastQueue(sourceSessionId);
      }
      return true;
    }

    if (notification.opencodeDeliveryStatus !== "sent") {
      yield* effects.enqueueSourceCompletionNotice({
        messageId: notification.id,
        messageSessionId: sourceSessionId,
        sessionId: sourceSessionId,
      });
    }
    const delivered = yield* store.getMessage(notification.id);
    return (
      delivered?.opencodeDeliveryStatus === "sent" || delivered?.opencodeDeliveryStatus === "queued"
    );
  });
}

export function runCompletionWatchTickEffect(
  messageId: number,
  {
    pollMs = DEFAULT_COMPLETION_WATCH_POLL_MS,
    quietWindowMs = 0,
  }: { pollMs?: number; quietWindowMs?: number } = {},
): Effect.Effect<void, never, CompletionWatchEnv> {
  return Effect.gen(function* () {
    const store = yield* CompletionWatchStore;
    const effects = yield* CompletionWatchEffects;
    const watched = yield* store.getMessage(messageId);
    if (
      !watched ||
      watched.completionWatchStatus === "completed" ||
      watched.completionWatchStatus === "cancelled"
    ) {
      yield* effects.stopWatch(messageId);
      return;
    }

    const baseUrl = yield* effects.getActiveBaseUrl(messageId);
    const now = yield* Clock.currentTimeMillis;
    if (watched.completionWatchNextCheckAt > now) return;

    const scheduleNextCheck = () =>
      Effect.gen(function* () {
        const decisionTime = yield* Clock.currentTimeMillis;
        yield* store.setCompletionWatchNextCheckAt(watched.id, decisionTime + pollMs);
      });

    const openCode = yield* CompletionWatchOpenCode;
    const status = yield* openCode.getStatus(watched.sessionId, { baseUrl });
    if (isWorking(status)) {
      if (watched.completionWatchStatus === "debouncing") {
        yield* store.setCompletionWatchStatus(watched.id, "watching");
      }
      if (!watched.completionWatchWorkSeen) {
        yield* store.markCompletionWorkSeen(watched.id);
      }
      yield* scheduleNextCheck();
      return;
    }
    if (status !== "idle" || !watched.completionWatchWorkSeen) {
      yield* scheduleNextCheck();
      return;
    }
    if (!promptReachedTarget(watched.opencodeDeliveryStatus)) {
      yield* scheduleNextCheck();
      return;
    }
    if (quietWindowMs > 0 && watched.completionWatchStatus !== "debouncing") {
      const decisionTime = yield* Clock.currentTimeMillis;
      yield* store.setCompletionWatchStatus(watched.id, "debouncing", decisionTime + quietWindowMs);
      return;
    }

    const sourceMessageId = watched.completionSourceMessageId ?? watched.forwardSourceMessageId;
    const gate = yield* effects.getSessionIdleGate(sourceMessageId);
    if (gate === "stop") {
      yield* store.setCompletionWatchStatus(watched.id, "cancelled");
      yield* effects.stopWatch(watched.id);
      return;
    }

    // Re-read after gate: Cancel wait may have soft-cancelled then disarmed mid-tick.
    const latest = (yield* store.getMessage(watched.id)) ?? watched;
    if (
      latest.completionWatchStatus === "cancelled" ||
      latest.completionWatchStatus === "completed"
    ) {
      yield* effects.stopWatch(watched.id);
      return;
    }

    yield* insertTargetNotification(store, effects, latest);
    const refreshed = (yield* store.getMessage(watched.id)) ?? latest;
    if (refreshed.completionWatchStatus === "cancelled") {
      yield* effects.stopWatch(watched.id);
      return;
    }
    const sourceDelivered = yield* deliverSourceNotification(store, effects, refreshed).pipe(
      Effect.orElseSucceed(() => false),
    );

    if (!sourceDelivered) {
      const decisionTime = yield* Clock.currentTimeMillis;
      yield* store.setCompletionWatchStatus(watched.id, "source_failed", decisionTime + pollMs);
      return;
    }

    const afterNotify = (yield* store.getMessage(watched.id)) ?? refreshed;
    if (afterNotify.completionWatchStatus === "cancelled") {
      yield* effects.stopWatch(watched.id);
      return;
    }
    if (afterNotify.completionSourceNotificationMessageId != null) {
      yield* effects.completeSessionIdle({
        sourceMessageId,
        notificationMessageId: afterNotify.completionSourceNotificationMessageId,
        targetSessionId: watched.sessionId,
        targetMessageId: watched.id,
        reason: "idle",
      });
    }

    yield* store.setCompletionWatchStatus(watched.id, "completed");
    yield* effects.stopWatch(watched.id);
    yield* effects.broadcastQueue(watched.sessionId);
    const sourceSessionId = watched.completionSourceSessionId;
    if (sourceSessionId && sourceSessionId !== watched.sessionId) {
      yield* effects.broadcastQueue(sourceSessionId);
    }
  }).pipe(Effect.catchAll(() => Effect.void));
}
