import { Context, Data, Effect, Schedule } from "effect";

/** Message fields the delivery worker reads/writes. */
export type DeliveryMessage = {
  id: number;
  sessionId: string;
  opencodeDeliveryStatus: string | null;
  opencodeDeliveryError: string | null;
  opencodeMessageId: string | null;
  forwardRole: string | null;
  forwardSourceSessionId: string | null;
  forwardSourceMessageId: number | null;
  forwardStatus: string | null;
  completionWatchStatus: string | null;
  completionWatchWorkSeen: number;
  completionSourceSessionId: string | null;
  completionSourceMessageId: number | null;
};

export type OpenCodeDeliveryJobKind =
  | "direct_user_message"
  | "forward_source_notice"
  | "forward_target_message"
  | "source_completion_notice"
  | "idle_notice";

export type DeliveryJob = {
  id: number;
  messageId: number;
  messageSessionId: string;
  opencodeSessionId: string;
  kind: string;
  status: string;
  useCli: number;
  force: number;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lockedAt: number | null;
  lockedBy: string | null;
  lastError: string | null;
  opencodeMessageId: string | null;
  promptDispatchedAt: number | null;
  cliTurnEndedAt: number | null;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueOpenCodeDeliveryInput = {
  messageId: number;
  messageSessionId: string;
  opencodeSessionId: string;
  kind: OpenCodeDeliveryJobKind;
  useCli?: boolean;
  /** Skip the busy/idle gate (explicit user force-send). */
  force?: boolean;
  maxAttempts?: number;
};

export type DeliveryOutcome = "sent" | "pending" | "failed" | "cancelled";

export const DEFAULT_WORKER_POLL_MS = 250;

export class MessageStoreError extends Data.TaggedError("MessageStoreError")<{
  readonly cause: unknown;
}> {}

export class DeliveryEffectsError extends Data.TaggedError("DeliveryEffectsError")<{
  readonly cause: unknown;
}> {}

export class OpenCodeDeliveryQueueError extends Data.TaggedError("OpenCodeDeliveryQueueError")<{
  readonly cause: unknown;
}> {}

export type OpenCodeDeliveryQueueService = {
  enqueue: (
    input: EnqueueOpenCodeDeliveryInput,
  ) => Effect.Effect<DeliveryJob, OpenCodeDeliveryQueueError>;
  claimNext: (workerId: string) => Effect.Effect<DeliveryJob | null, OpenCodeDeliveryQueueError>;
  complete: (
    job: DeliveryJob,
    outcome: DeliveryOutcome,
    opencodeMessageId?: string | null,
  ) => Effect.Effect<boolean, OpenCodeDeliveryQueueError>;
  retry: (job: DeliveryJob, error: string) => Effect.Effect<boolean, OpenCodeDeliveryQueueError>;
  fail: (job: DeliveryJob, error: string) => Effect.Effect<boolean, OpenCodeDeliveryQueueError>;
  cancel: (job: DeliveryJob, reason: string) => Effect.Effect<boolean, OpenCodeDeliveryQueueError>;
  returnToPending: (job: DeliveryJob) => Effect.Effect<boolean, OpenCodeDeliveryQueueError>;
  markDispatched?: (job: DeliveryJob) => Effect.Effect<boolean, OpenCodeDeliveryQueueError>;
  markCliTurnEnded?: (job: DeliveryJob) => Effect.Effect<boolean, OpenCodeDeliveryQueueError>;
};

export type OpenCodePromptClientService = {
  sendPrompt: (job: DeliveryJob, message: DeliveryMessage) => Effect.Effect<DeliveryOutcome>;
};

export type MessageStoreService = {
  getMessage: (id: number) => Effect.Effect<DeliveryMessage | null, MessageStoreError>;
  updateOpencodeDelivery: (
    id: number,
    status: string | null,
    error: string | null,
    opencodeMessageId: string | null,
  ) => Effect.Effect<void, MessageStoreError>;
  markCompletionWorkSeen: (id: number) => Effect.Effect<void, MessageStoreError>;
  updateForwardStatus: (id: number, status: string) => Effect.Effect<void, MessageStoreError>;
  updateForwardTarget: (
    sourceMessageId: number,
    targetMessageId: number,
    status: string,
  ) => Effect.Effect<void, MessageStoreError>;
};

export type IdleNotificationWatchInput = {
  sessionId: string;
  triggerMessageId: number;
  seenWorking?: boolean;
};

export type ForwardCompletionWatchInput = {
  sourceMessageId: number;
  sourceSessionId: string;
  targetMessageId: number;
  targetSessionId: string;
  seenWorking?: boolean;
  autoPoll?: boolean;
};

export type DeliveryEffectsService = {
  broadcastQueue: (sessionId?: string | null) => Effect.Effect<void, DeliveryEffectsError>;
  startCompletionWatch: (messageId: number) => Effect.Effect<void, DeliveryEffectsError>;
  startForwardCompletionNotificationWatch: (
    input: ForwardCompletionWatchInput,
  ) => Effect.Effect<void, DeliveryEffectsError>;
  startIdleNotificationWatch: (
    input: IdleNotificationWatchInput,
  ) => Effect.Effect<void, DeliveryEffectsError>;
};

export type OpenCodeDeliveryStatusService = {
  getStatus: (sessionId: string, opts?: { forceRefresh?: boolean }) => Effect.Effect<string | null>;
};

export type WorkerIdentityService = {
  id: string;
};

export type OpenCodeDeliveryEnv =
  | OpenCodeDeliveryQueueService
  | OpenCodeDeliveryStatusService
  | OpenCodePromptClientService
  | WorkerIdentityService
  | MessageStoreService
  | DeliveryEffectsService;

export type OpenCodeDeliveryRuntimeService = {
  start: Effect.Effect<void>;
  kick: Effect.Effect<void>;
  stop: Effect.Effect<void>;
};

export const OpenCodeDeliveryQueue = Context.GenericTag<OpenCodeDeliveryQueueService>(
  "say-to-me/OpenCodeDeliveryQueue",
);
export const OpenCodePromptClient = Context.GenericTag<OpenCodePromptClientService>(
  "say-to-me/OpenCodePromptClient",
);
export const OpenCodeDeliveryStatus = Context.GenericTag<OpenCodeDeliveryStatusService>(
  "say-to-me/OpenCodeDeliveryStatus",
);
export const WorkerIdentity = Context.GenericTag<WorkerIdentityService>("say-to-me/WorkerIdentity");
export const MessageStore = Context.GenericTag<MessageStoreService>("say-to-me/MessageStore");
export const DeliveryEffects = Context.GenericTag<DeliveryEffectsService>(
  "say-to-me/DeliveryEffects",
);
export const OpenCodeDeliveryRuntime = Context.GenericTag<OpenCodeDeliveryRuntimeService>(
  "say-to-me/OpenCodeDeliveryRuntime",
);

function isLiveCompletionWatchStatus(status: string | null): boolean {
  return status === "watching" || status === "debouncing";
}

function afterDelivery(
  job: DeliveryJob,
  message: DeliveryMessage,
  outcome: DeliveryOutcome,
  store: MessageStoreService,
  fx: DeliveryEffectsService,
): Effect.Effect<void, MessageStoreError | DeliveryEffectsError> {
  return Effect.gen(function* () {
    if (outcome !== "sent" && outcome !== "pending") return;
    if (message.forwardRole === "source") {
      yield* store.updateForwardStatus(message.id, outcome === "sent" ? "sent" : "pending");
    }
    if (isLiveCompletionWatchStatus(message.completionWatchStatus)) {
      yield* fx.startCompletionWatch(message.id);
    }
    if (job.kind === "forward_target_message") {
      if (message.forwardSourceMessageId != null) {
        yield* store.updateForwardTarget(
          message.forwardSourceMessageId,
          message.id,
          outcome === "sent" ? "sent" : "pending",
        );
      }
      yield* store.updateForwardStatus(message.id, outcome === "sent" ? "sent" : "pending");
      if (isLiveCompletionWatchStatus(message.completionWatchStatus)) {
        yield* fx.startForwardCompletionNotificationWatch({
          sourceMessageId:
            message.completionSourceMessageId ?? message.forwardSourceMessageId ?? message.id,
          sourceSessionId:
            message.completionSourceSessionId ??
            message.forwardSourceSessionId ??
            message.sessionId,
          targetMessageId: message.id,
          targetSessionId: job.opencodeSessionId,
          seenWorking: true,
        });
      } else {
        yield* fx.startIdleNotificationWatch({
          sessionId: job.opencodeSessionId,
          triggerMessageId: message.id,
          seenWorking: true,
        });
      }
    } else if (job.kind === "direct_user_message") {
      yield* fx.startIdleNotificationWatch({
        sessionId: job.opencodeSessionId,
        triggerMessageId: message.id,
        seenWorking: true,
      });
    }
  });
}

function afterDeliveryFailure(
  message: DeliveryMessage,
  store: MessageStoreService,
): Effect.Effect<void, MessageStoreError> {
  return Effect.gen(function* () {
    if (message.forwardRole) yield* store.updateForwardStatus(message.id, "failed");
    if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
      yield* store.updateForwardTarget(message.forwardSourceMessageId, message.id, "failed");
    }
  });
}

export function runOpenCodeDeliveryOnce(): Effect.Effect<boolean, never, OpenCodeDeliveryEnv> {
  return Effect.gen(function* () {
    const queue = yield* OpenCodeDeliveryQueue;
    const prompt = yield* OpenCodePromptClient;
    const statusClient = yield* OpenCodeDeliveryStatus;
    const worker = yield* WorkerIdentity;
    const store = yield* MessageStore;
    const fx = yield* DeliveryEffects;
    const job = yield* queue.claimNext(worker.id);
    if (!job) return false;

    const message = yield* store.getMessage(job.messageId);
    if (!message) {
      yield* queue.cancel(job, "Message no longer exists.");
      return true;
    }
    if (message.opencodeDeliveryStatus === "sent" || message.opencodeMessageId) {
      yield* queue.complete(job, "sent", message.opencodeMessageId);
      return true;
    }
    if (job.promptDispatchedAt != null) {
      const failed = yield* queue.fail(
        job,
        job.lastError ?? "OpenCode delivery was already dispatched before the lease expired.",
      );
      if (failed) {
        yield* afterDeliveryFailure(message, store);
        yield* fx.broadcastQueue(message.sessionId);
      }
      return true;
    }

    const status = yield* statusClient.getStatus(job.opencodeSessionId);
    if (status === "pending" && job.force !== 1) {
      const returnedToQueue = yield* queue.returnToPending(job);
      if (returnedToQueue) {
        yield* store.updateOpencodeDelivery(message.id, "queued", null, null);
      }
      return true;
    }

    yield* store.updateOpencodeDelivery(message.id, "pending", null, null);
    if (isLiveCompletionWatchStatus(message.completionWatchStatus)) {
      yield* store.markCompletionWorkSeen(message.id);
    }
    yield* fx.broadcastQueue(message.sessionId);
    const promptDispatched = yield* queue.markDispatched?.(job) ?? Effect.succeed(true);
    if (!promptDispatched) return true;
    const outcome = yield* prompt
      .sendPrompt(job, message)
      .pipe(Effect.catchAll(() => Effect.succeed("failed" as const)));
    yield* queue.markCliTurnEnded?.(job) ?? Effect.succeed(true);
    let delivered = (yield* store.getMessage(message.id)) ?? message;
    if (outcome === "sent" || outcome === "pending") {
      if (outcome === "sent" && delivered.opencodeDeliveryStatus !== "sent") {
        yield* store.updateOpencodeDelivery(
          delivered.id,
          "sent",
          null,
          delivered.opencodeMessageId,
        );
        delivered = (yield* store.getMessage(delivered.id)) ?? delivered;
      }
      const completed = yield* queue.complete(job, outcome, delivered.opencodeMessageId);
      if (!completed) return true;
      if (job.kind === "forward_target_message") {
        yield* statusClient.getStatus(job.opencodeSessionId, { forceRefresh: true });
      }
      yield* afterDelivery(job, delivered, outcome, store, fx);
      yield* fx.broadcastQueue(delivered.sessionId);
      return true;
    }

    const error = delivered.opencodeDeliveryError ?? "OpenCode delivery failed.";
    if (job.attemptCount >= job.maxAttempts) {
      const failed = yield* queue.fail(job, error);
      if (!failed) return true;
      yield* afterDeliveryFailure(message, store);
    } else {
      const retried = yield* queue.retry(job, error);
      if (!retried) return true;
      yield* store.updateOpencodeDelivery(message.id, "queued", error, null);
    }
    yield* fx.broadcastQueue(message.sessionId);
    return true;
  }).pipe(Effect.catchAll(() => Effect.succeed(true)));
}

export function openCodeDeliveryWorkerLoop(
  pollMs = DEFAULT_WORKER_POLL_MS,
): Effect.Effect<void, never, OpenCodeDeliveryEnv> {
  return runOpenCodeDeliveryOnce().pipe(
    Effect.zipRight(Effect.void),
    Effect.repeat(Schedule.spaced(`${pollMs} millis`)),
  );
}
