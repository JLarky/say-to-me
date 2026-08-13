import { Context, Data, Effect } from "effect";

export type ExternalCliDeliveryJobKind = "direct_user_message" | "forward_target_message";

export type DeliveryMessage = {
  id: number;
  sessionId: string;
  text: string;
  opencodeDeliveryStatus: string | null;
  forwardRole: string | null;
  forwardSourceSessionId: string | null;
  forwardSourceMessageId: number | null;
  completionWatchStatus: string | null;
  completionSourceSessionId: string | null;
  completionSourceMessageId: number | null;
};

export type ExternalCliDeliveryJob = {
  id: number;
  messageId: number;
  messageSessionId: string;
  externalSessionId: string;
  kind: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lockedAt: number | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryOutcome = "sent" | "failed" | "cancelled";

export class ExternalCliDeliveryQueueError extends Data.TaggedError(
  "ExternalCliDeliveryQueueError",
)<{
  readonly cause: unknown;
}> {}

export class MessageStoreError extends Data.TaggedError("ExternalCliMessageStoreError")<{
  readonly cause: unknown;
}> {}

export class DeliveryEffectsError extends Data.TaggedError("ExternalCliDeliveryEffectsError")<{
  readonly cause: unknown;
}> {}

export type DeliveryQueueService = {
  claimNext: (
    workerId: string,
    sessionId?: string,
  ) => Effect.Effect<ExternalCliDeliveryJob | null, ExternalCliDeliveryQueueError>;
  complete: (
    job: ExternalCliDeliveryJob,
    outcome: DeliveryOutcome,
  ) => Effect.Effect<boolean, ExternalCliDeliveryQueueError>;
  retry: (
    job: ExternalCliDeliveryJob,
    error: string,
  ) => Effect.Effect<boolean, ExternalCliDeliveryQueueError>;
  fail: (
    job: ExternalCliDeliveryJob,
    error: string,
  ) => Effect.Effect<boolean, ExternalCliDeliveryQueueError>;
  cancel: (
    job: ExternalCliDeliveryJob,
    reason: string,
  ) => Effect.Effect<boolean, ExternalCliDeliveryQueueError>;
  renew: (
    job: ExternalCliDeliveryJob,
  ) => Effect.Effect<ExternalCliDeliveryJob | null, ExternalCliDeliveryQueueError>;
};

export type PromptClientService = {
  sendPrompt: (
    job: ExternalCliDeliveryJob,
    message: DeliveryMessage,
  ) => Effect.Effect<string, unknown>;
};

export type WorkerIdentityService = { id: string };

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
};

export type DeliveryEffectsService = {
  broadcastQueue: (sessionId?: string | null) => Effect.Effect<void, DeliveryEffectsError>;
  insertAgentReply: (sessionId: string, reply: string) => Effect.Effect<void, DeliveryEffectsError>;
  startForwardCompletionNotificationWatch: (
    input: ForwardCompletionWatchInput,
  ) => Effect.Effect<void, DeliveryEffectsError>;
  startIdleNotificationWatch: (
    input: IdleNotificationWatchInput,
  ) => Effect.Effect<void, DeliveryEffectsError>;
};

export type ExternalCliDeliveryEnv =
  | DeliveryQueueService
  | PromptClientService
  | WorkerIdentityService
  | MessageStoreService
  | DeliveryEffectsService;

export function makeExternalCliDeliveryWorkflow(
  tagNs: string,
  { failureMessage = "External CLI delivery failed." }: { failureMessage?: string } = {},
) {
  const DeliveryQueue = Context.GenericTag<DeliveryQueueService>(`${tagNs}/DeliveryQueue`);
  const PromptClient = Context.GenericTag<PromptClientService>(`${tagNs}/PromptClient`);
  const WorkerIdentity = Context.GenericTag<WorkerIdentityService>(`${tagNs}/WorkerIdentity`);
  const MessageStore = Context.GenericTag<MessageStoreService>(`${tagNs}/MessageStore`);
  const DeliveryEffects = Context.GenericTag<DeliveryEffectsService>(`${tagNs}/DeliveryEffects`);

  function afterDelivery(
    job: ExternalCliDeliveryJob,
    message: DeliveryMessage,
    store: MessageStoreService,
    fx: DeliveryEffectsService,
  ): Effect.Effect<void, MessageStoreError | DeliveryEffectsError> {
    return Effect.gen(function* () {
      if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
        yield* store.updateForwardTarget(message.forwardSourceMessageId, message.id, "sent");
        yield* store.updateForwardStatus(message.id, "sent");
      }
      yield* store.updateOpencodeDelivery(message.id, "sent", null, null);
      yield* fx.broadcastQueue(message.sessionId);
      if (message.sessionId !== job.externalSessionId) {
        yield* fx.broadcastQueue(job.externalSessionId);
      }

      if (job.kind === "forward_target_message") {
        if (message.completionWatchStatus === "watching") {
          yield* fx.startForwardCompletionNotificationWatch({
            sourceMessageId:
              message.completionSourceMessageId ?? message.forwardSourceMessageId ?? message.id,
            sourceSessionId:
              message.completionSourceSessionId ??
              message.forwardSourceSessionId ??
              message.sessionId,
            targetMessageId: message.id,
            targetSessionId: job.externalSessionId,
            seenWorking: true,
          });
        } else {
          yield* fx.startIdleNotificationWatch({
            sessionId: job.externalSessionId,
            triggerMessageId: message.id,
            seenWorking: true,
          });
        }
      } else if (job.kind === "direct_user_message") {
        yield* fx.startIdleNotificationWatch({
          sessionId: job.externalSessionId,
          triggerMessageId: message.id,
          seenWorking: true,
        });
      }
    });
  }

  function afterDeliveryFailure(
    message: DeliveryMessage,
    store: MessageStoreService,
    fx: DeliveryEffectsService,
    error = failureMessage,
  ): Effect.Effect<void, MessageStoreError | DeliveryEffectsError> {
    return Effect.gen(function* () {
      yield* store.updateOpencodeDelivery(message.id, "failed", error, null);
      if (message.forwardRole) yield* store.updateForwardStatus(message.id, "failed");
      if (message.forwardRole === "target" && message.forwardSourceMessageId != null) {
        yield* store.updateForwardTarget(message.forwardSourceMessageId, message.id, "failed");
      }
      yield* fx.broadcastQueue(message.sessionId);
    });
  }

  function runDeliveryOnce(
    sessionId?: string,
  ): Effect.Effect<boolean, never, ExternalCliDeliveryEnv> {
    return Effect.gen(function* () {
      const queue = yield* DeliveryQueue;
      const prompt = yield* PromptClient;
      const worker = yield* WorkerIdentity;
      const store = yield* MessageStore;
      const fx = yield* DeliveryEffects;
      const job = yield* queue.claimNext(worker.id, sessionId);
      if (!job) return false;

      const message = yield* store.getMessage(job.messageId);
      if (!message) {
        yield* queue.cancel(job, "Message no longer exists.");
        return true;
      }
      if (message.opencodeDeliveryStatus === "sent") {
        yield* queue.complete(job, "sent");
        return true;
      }

      yield* store.updateOpencodeDelivery(message.id, "pending", null, null);
      if (message.completionWatchStatus === "watching") {
        yield* store.markCompletionWorkSeen(message.id);
      }
      yield* fx.broadcastQueue(message.sessionId);
      const outcome = yield* prompt.sendPrompt(job, message).pipe(
        Effect.map((reply) => ({ _tag: "sent" as const, reply })),
        Effect.catchAll((error) =>
          Effect.succeed({
            _tag: "failed" as const,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      );

      if (outcome._tag === "sent") {
        yield* fx.insertAgentReply(job.externalSessionId, outcome.reply);
        const completed = yield* queue.complete(job, "sent");
        if (completed) yield* afterDelivery(job, message, store, fx);
        return true;
      }

      if (job.attemptCount >= job.maxAttempts) {
        const failed = yield* queue.fail(job, outcome.error);
        if (failed) yield* afterDeliveryFailure(message, store, fx, outcome.error);
      } else {
        const retried = yield* queue.retry(job, outcome.error);
        if (retried) {
          yield* store.updateOpencodeDelivery(message.id, "queued", outcome.error, null);
        }
      }
      yield* fx.broadcastQueue(message.sessionId);
      return true;
    }).pipe(Effect.catchAll(() => Effect.succeed(true)));
  }

  return {
    DeliveryQueue,
    PromptClient,
    WorkerIdentity,
    MessageStore,
    DeliveryEffects,
    runDeliveryOnce,
  };
}
