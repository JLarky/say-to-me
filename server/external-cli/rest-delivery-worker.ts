import { randomUUID } from "node:crypto";
import { Effect, Either, Fiber } from "effect";
import { type as arktype } from "arktype";
import {
  deliveryFailureAction,
  DeliveryLeaseLostError,
  ProviderNotStartedError,
  type DeliveryFailure,
  type ProviderPromptError,
} from "@say-to-me/external-cli-delivery/workflow";
import type { DbMessage } from "../db/schemas.ts";
import { postInternalJson } from "./internal-http.ts";
import {
  echoAcceptDelay,
  echoFailBeforeAccept,
  echoReplyDelayMs,
  isRealWorkerMode,
  workerMode,
  type ExternalCliWorkerEnvPrefix,
} from "./worker-env.ts";

const OkResponse = arktype({ ok: "boolean" });

const WORKER_POLL_MS = Number(process.env.SAY_TO_ME_EXTERNAL_CLI_DELIVERY_POLL_MS || 250);
const LEASE_RENEW_MS = 10_000;

export type ExternalCliDeliveryJobLease = {
  id: number;
  messageId: number;
  attemptCount: number;
  maxAttempts: number;
};

export type ExternalCliRestWorkerConfig<
  TJob extends ExternalCliDeliveryJobLease,
  TClaimed extends { job: TJob; message: DbMessage | null },
> = {
  backendLabel: string;
  envPrefix: ExternalCliWorkerEnvPrefix;
  realWorkerMode: string;
  apiBasePath: `/api/internal/${string}-delivery`;
  sessionIdRequestField: string;
  workerVersion: number;
  echoReplyLabel: string;
  deliveryPrompt: (job: TJob, message: DbMessage) => string;
  runPrompt: (
    job: TJob,
    claimed: TClaimed & { message: DbMessage },
  ) => Effect.Effect<string | null, ProviderPromptError>;
};

export function createExternalCliRestDeliveryWorker<
  TJob extends ExternalCliDeliveryJobLease,
  TClaimed extends { job: TJob; message: DbMessage | null },
>(config: ExternalCliRestWorkerConfig<TJob, TClaimed>) {
  type ClaimResult = TClaimed | "stale-worker" | null;
  type ClaimedJobWithMessage = TClaimed & { message: DbMessage };

  function echoDelivery(prompt: string): Effect.Effect<string, ProviderPromptError> {
    if (workerMode(config.envPrefix) !== "echo") {
      return Effect.fail(
        new ProviderNotStartedError({
          message: `Only echo ${config.backendLabel} worker mode is implemented.`,
        }),
      );
    }
    if (echoFailBeforeAccept(config.envPrefix)) {
      return Effect.sleep(echoAcceptDelay(config.envPrefix)).pipe(
        Effect.zipRight(
          Effect.fail(new ProviderNotStartedError({ message: "Echo failed before accept." })),
        ),
      );
    }
    return Effect.gen(function* () {
      yield* Effect.sleep(echoAcceptDelay(config.envPrefix));
      const reply = `${config.echoReplyLabel}: ${prompt}`;
      const replyDelayMs = echoReplyDelayMs(config.envPrefix);
      if (replyDelayMs > 0) yield* Effect.sleep(`${replyDelayMs} millis`);
      return reply;
    });
  }

  function runDelivery(
    claimed: ClaimedJobWithMessage,
  ): Effect.Effect<string | null, ProviderPromptError> {
    if (isRealWorkerMode(config.envPrefix, config.realWorkerMode)) {
      return config.runPrompt(claimed.job, claimed);
    }
    return echoDelivery(config.deliveryPrompt(claimed.job, claimed.message));
  }

  function claim(workerId: string, sessionId: string): Effect.Effect<ClaimResult> {
    return Effect.tryPromise(async () => {
      const body = await postInternalJson(
        `${config.apiBasePath}/claim`,
        {
          workerId,
          [config.sessionIdRequestField]: sessionId,
          workerVersion: config.workerVersion,
        },
        arktype({ claimed: "unknown", "staleWorker?": "boolean" }),
      );
      if (body.staleWorker === true) return "stale-worker";
      return body.claimed as TClaimed | null;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error(
            `[${config.backendLabel}-delivery-worker] claim failed; exiting worker:`,
            error,
          );
          return "stale-worker" as const;
        }),
      ),
    );
  }

  function complete(job: TJob, reply: string | null): Effect.Effect<boolean> {
    return Effect.promise(async () => {
      const body = await postInternalJson(
        `${config.apiBasePath}/complete`,
        {
          job,
          reply,
        },
        OkResponse,
      );
      return body.ok;
    });
  }

  /**
   * Record that this job's prompt is about to be handed to the provider.
   *
   * `false` means "not confirmed dispatched": either the lease is gone, or the
   * request never got an answer. Either way the caller must not spawn. A mark
   * that committed but lost its response leaves the job looking dispatched and
   * un-prompted, which the stale-lease sweep resolves as unconfirmed — the
   * honest failure this ordering is chosen for.
   */
  function markDispatched(job: TJob): Effect.Effect<boolean> {
    return Effect.tryPromise(async () => {
      const body = await postInternalJson(`${config.apiBasePath}/dispatch`, { job }, OkResponse);
      return body.ok;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error(
            `[${config.backendLabel}-delivery-worker] could not mark the prompt dispatched; not prompting:`,
            error,
          );
          return false;
        }),
      ),
    );
  }

  function markTurnEnded(job: TJob): Effect.Effect<boolean> {
    return Effect.tryPromise(async () => {
      const body = await postInternalJson(`${config.apiBasePath}/turn-ended`, { job }, OkResponse);
      return body.ok;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error(
            `[${config.backendLabel}-delivery-worker] could not record CLI turn end for job ${job.id}:`,
            error,
          );
          return false;
        }),
      ),
    );
  }

  function markUnconfirmed(job: TJob, error: string): Effect.Effect<boolean> {
    return Effect.promise(async () => {
      const body = await postInternalJson(
        `${config.apiBasePath}/unconfirmed`,
        {
          job,
          error,
        },
        OkResponse,
      );
      return body.ok;
    });
  }

  function retry(job: TJob, error: string): Effect.Effect<boolean> {
    return Effect.promise(async () => {
      const body = await postInternalJson(
        `${config.apiBasePath}/retry`,
        {
          job,
          error,
        },
        OkResponse,
      );
      return body.ok;
    });
  }

  function renew(job: TJob): Effect.Effect<TJob | null> {
    return Effect.promise(async () => {
      const body = await postInternalJson(
        `${config.apiBasePath}/renew`,
        { job },
        arktype({ job: "unknown" }),
      );
      return body.job as TJob | null;
    });
  }

  function fail(job: TJob, error: string): Effect.Effect<boolean> {
    return Effect.promise(async () => {
      const body = await postInternalJson(
        `${config.apiBasePath}/fail`,
        {
          job,
          error,
        },
        OkResponse,
      );
      return body.ok;
    });
  }

  function cancel(job: TJob, reason: string): Effect.Effect<boolean> {
    return Effect.promise(async () => {
      const body = await postInternalJson(
        `${config.apiBasePath}/cancel`,
        {
          job,
          reason,
        },
        OkResponse,
      );
      return body.ok;
    });
  }

  /**
   * A worker that no longer owns a job says so and records nothing. Losing the
   * lease is not a delivery failure, and reporting it as one would blame the
   * provider for a handoff the queue already gave to somebody else.
   */
  function reportLeaseLost(job: TJob, context: string): Effect.Effect<void> {
    return Effect.sync(() => {
      console.error(
        `[${config.backendLabel}-delivery-worker] lease lost for job ${job.id} (${context}); recorded no outcome.`,
      );
    });
  }

  function runOnce(workerId: string, sessionId: string): Effect.Effect<boolean | "stale-worker"> {
    return Effect.gen(function* () {
      const claimed = yield* claim(workerId, sessionId);
      if (claimed === "stale-worker") return "stale-worker";
      if (!claimed) return false;
      let { job } = claimed;
      const { message } = claimed;
      if (!message) {
        yield* cancel(job, "Message no longer exists.");
        return true;
      }
      if (message.opencodeDeliveryStatus === "sent") {
        yield* complete(job, null);
        return true;
      }

      // Mark dispatched, and wait for that write, *before* spawning. Both
      // orderings have a window; this one fails towards an honest unconfirmed
      // report rather than towards a silently duplicated agent turn.
      const promptDispatched = yield* markDispatched(job);
      if (!promptDispatched) {
        console.error(
          `[${config.backendLabel}-delivery-worker] no longer holds job ${job.id}; recording nothing.`,
        );
        return true;
      }

      let leaseLost = false;
      const heartbeat = yield* Effect.gen(function* () {
        yield* Effect.sleep(`${LEASE_RENEW_MS} millis`);
        const renewed = yield* renew(job);
        if (!renewed) {
          return yield* Effect.fail(
            new DeliveryLeaseLostError({
              message: `${config.backendLabel} delivery lease renewal failed.`,
            }),
          );
        }
        job = renewed;
      }).pipe(
        Effect.forever,
        Effect.catchAll((error) =>
          Effect.sync(() => {
            leaseLost = true;
            console.error(`[${config.backendLabel}-delivery-worker] lease renewal failed:`, error);
          }),
        ),
        Effect.fork,
      );

      const outcome = yield* Effect.either(
        runDelivery({ ...claimed, job, message } as ClaimedJobWithMessage),
      ).pipe(Effect.ensuring(Fiber.interrupt(heartbeat)));

      // Process settled (success or fail after spawn). Queue-empty must not
      // mean idle until this marker is set — including when complete() CAS fails.
      yield* markTurnEnded(job);

      if (Either.isRight(outcome)) {
        // Even a worker that saw a renewal failure tries to complete: the
        // compare-and-set is the authority on ownership, and a reply we hold is
        // worth recording whenever it still matches the lease holder.
        const completed = yield* complete(job, outcome.right);
        if (!completed) yield* reportLeaseLost(job, "completion");
        return true;
      }

      const failure: DeliveryFailure = leaseLost
        ? new DeliveryLeaseLostError({
            message: `${config.backendLabel} delivery lease was lost before the outcome was recorded.`,
          })
        : outcome.left;
      const action = deliveryFailureAction({
        failure,
        promptDispatched,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
      });

      switch (action._tag) {
        case "abandon":
          yield* reportLeaseLost(job, action.reason);
          return true;
        case "retry": {
          const retried = yield* retry(job, action.error);
          if (!retried) yield* reportLeaseLost(job, "retry");
          return true;
        }
        case "failed": {
          const failed = yield* fail(job, action.error);
          if (!failed) yield* reportLeaseLost(job, "failure");
          return true;
        }
        case "unconfirmed": {
          const recorded = yield* markUnconfirmed(job, action.error);
          if (!recorded) yield* reportLeaseLost(job, "unconfirmed outcome");
          return true;
        }
      }
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(
          () => (
            console.error(`[${config.backendLabel}-delivery-worker] REST iteration failed:`, cause),
            true
          ),
        ),
      ),
    );
  }

  function workerLoop(sessionId: string): Effect.Effect<void> {
    const workerId = `${config.backendLabel}-delivery-${process.pid}-${randomUUID()}`;
    return Effect.gen(function* () {
      for (;;) {
        const result = yield* runOnce(workerId, sessionId);
        if (result === "stale-worker") {
          console.log(
            JSON.stringify({
              msg: `${config.backendLabel} delivery worker exiting after version mismatch`,
              workerVersion: config.workerVersion,
            }),
          );
          return;
        }
        yield* Effect.sleep(`${WORKER_POLL_MS} millis`);
      }
    });
  }

  return { runOnce, workerLoop };
}
