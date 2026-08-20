import { Context, Data, Effect, Either } from "effect";

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
  promptDispatchedAt: number | null;
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

/**
 * The provider process never ran, so it cannot have read the prompt: the
 * executable is missing, the session `cwd` is gone, or the spawn itself failed.
 * Because the dispatch marker is written before the spawn is attempted, this is
 * the one failure that is safe to retry on an already-dispatched job.
 */
export class ProviderNotStartedError extends Data.TaggedError("ExternalCliProviderNotStarted")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * The provider started and then failed: it exited non-zero, timed out, or
 * produced output that could not be parsed. It may already have read the
 * prompt, so a dispatched job must never be prompted again.
 */
export class ProviderFailedError extends Data.TaggedError("ExternalCliProviderFailed")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Another worker owns this job now. This is not a delivery failure: a worker
 * that no longer holds the lease must record no outcome at all.
 */
export class DeliveryLeaseLostError extends Data.TaggedError("ExternalCliDeliveryLeaseLost")<{
  readonly message: string;
}> {}

/** Everything a provider prompt may fail with, distinguishable without parsing text. */
export type ProviderPromptError = ProviderNotStartedError | ProviderFailedError;

export type DeliveryFailure = ProviderPromptError | DeliveryLeaseLostError;

/** What a worker may do with a delivery job after an attempt failed. */
export type DeliveryFailureAction =
  /** Record nothing: this worker no longer owns the job. */
  | { readonly _tag: "abandon"; readonly reason: string }
  /** Return the job to the queue; the prompt provably never reached the provider. */
  | { readonly _tag: "retry"; readonly error: string }
  /** Terminal, and the prompt never reached the provider. */
  | { readonly _tag: "failed"; readonly error: string }
  /** Terminal, and whether the prompt reached the provider is unknown. */
  | { readonly _tag: "unconfirmed"; readonly error: string };

/**
 * The one place the re-prompt rule lives.
 *
 * A delivery may be prompted again only when the prompt provably never reached
 * the provider: either the job was never marked dispatched, or the spawn itself
 * never started. Attempts still bound how many times such a delivery is retried,
 * but the marker rather than the budget is what prevents a duplicate turn.
 */
export function deliveryFailureAction(input: {
  readonly failure: DeliveryFailure;
  readonly promptDispatched: boolean;
  readonly attemptCount: number;
  readonly maxAttempts: number;
}): DeliveryFailureAction {
  const { failure } = input;
  if (failure._tag === "ExternalCliDeliveryLeaseLost") {
    return { _tag: "abandon", reason: failure.message };
  }
  const mayHaveReachedProvider =
    input.promptDispatched && failure._tag !== "ExternalCliProviderNotStarted";
  if (mayHaveReachedProvider) return { _tag: "unconfirmed", error: failure.message };
  if (input.attemptCount < input.maxAttempts) return { _tag: "retry", error: failure.message };
  return { _tag: "failed", error: failure.message };
}

export type DeliveryQueueService = {
  claimNext: (
    workerId: string,
    sessionId?: string,
  ) => Effect.Effect<ExternalCliDeliveryJob | null, ExternalCliDeliveryQueueError>;
  /**
   * Record that the prompt is being handed to the provider, conditional on this
   * worker still holding the lease. Returns false when it does not.
   */
  markDispatched: (
    job: ExternalCliDeliveryJob,
  ) => Effect.Effect<boolean, ExternalCliDeliveryQueueError>;
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
  ) => Effect.Effect<string, ProviderPromptError>;
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

      // Mark dispatched before prompting. Both orderings have a window; this
      // one fails towards an honest unconfirmed report rather than a duplicate turn.
      const promptDispatched = yield* queue.markDispatched(job);
      if (!promptDispatched) {
        // Another worker owns the job; record nothing.
        return true;
      }

      const outcome = yield* Effect.either(prompt.sendPrompt(job, message));

      if (Either.isRight(outcome)) {
        yield* fx.insertAgentReply(job.externalSessionId, outcome.right);
        const completed = yield* queue.complete(job, "sent");
        if (completed) yield* afterDelivery(job, message, store, fx);
        return true;
      }

      const action = deliveryFailureAction({
        failure: outcome.left,
        promptDispatched,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
      });

      switch (action._tag) {
        case "abandon":
          return true;
        case "retry": {
          const retried = yield* queue.retry(job, action.error);
          if (retried) {
            yield* store.updateOpencodeDelivery(message.id, "queued", action.error, null);
          }
          yield* fx.broadcastQueue(message.sessionId);
          return true;
        }
        case "failed": {
          const failed = yield* queue.fail(job, action.error);
          if (failed) yield* afterDeliveryFailure(message, store, fx, action.error);
          else yield* fx.broadcastQueue(message.sessionId);
          return true;
        }
        case "unconfirmed": {
          const recorded = yield* queue.fail(job, action.error);
          if (recorded) {
            yield* afterDeliveryFailure(message, store, fx, action.error);
          } else {
            yield* fx.broadcastQueue(message.sessionId);
          }
          return true;
        }
      }
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
