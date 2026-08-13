import { Clock, Context, Data, Effect } from "effect";

export const DEFAULT_COMPLETION_WATCH_POLL_MS = 250;

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

function targetNoticeText(targetSessionId: string): string {
  return `<say-to-me-system>${targetSessionId} is idle now</say-to-me-system>`;
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
  watched: WatchedMessage,
  entries = [sourceCompletionEntry(watched)],
): string {
  const target = watched.forwardTargetSessionId || watched.sessionId;
  const label = entries.length === 1 ? "forwarded message" : "forwarded messages";
  return `<say-to-me-system>${target} is idle now after ${label}: ${entries.join("; ")}</say-to-me-system>`;
}

function sourceNoticeEntries(text: string): string[] {
  const match = text.match(
    /^<say-to-me-system>.*? is idle now after forwarded messages?: ([\s\S]*?)<\/say-to-me-system>$/,
  );
  return match?.[1]
    ? match[1]
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
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
  { pollMs = DEFAULT_COMPLETION_WATCH_POLL_MS }: { pollMs?: number } = {},
): Effect.Effect<void, never, CompletionWatchEnv> {
  return Effect.gen(function* () {
    const store = yield* CompletionWatchStore;
    const effects = yield* CompletionWatchEffects;
    const watched = yield* store.getMessage(messageId);
    if (!watched || watched.completionWatchStatus === "completed") {
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

    yield* insertTargetNotification(store, effects, watched);
    const sourceDelivered = yield* deliverSourceNotification(
      store,
      effects,
      (yield* store.getMessage(watched.id)) ?? watched,
    ).pipe(Effect.orElseSucceed(() => false));

    if (!sourceDelivered) {
      const decisionTime = yield* Clock.currentTimeMillis;
      yield* store.setCompletionWatchStatus(watched.id, "source_failed", decisionTime + pollMs);
      return;
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
