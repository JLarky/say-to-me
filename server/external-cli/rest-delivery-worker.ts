import { randomUUID } from "node:crypto";
import { Effect, Fiber } from "effect";
import { type as arktype } from "arktype";
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
  ) => Effect.Effect<string | null, Error>;
};

export function createExternalCliRestDeliveryWorker<
  TJob extends ExternalCliDeliveryJobLease,
  TClaimed extends { job: TJob; message: DbMessage | null },
>(config: ExternalCliRestWorkerConfig<TJob, TClaimed>) {
  type ClaimResult = TClaimed | "stale-worker" | null;
  type ClaimedJobWithMessage = TClaimed & { message: DbMessage };

  function echoDelivery(prompt: string): Effect.Effect<string, unknown> {
    if (workerMode(config.envPrefix) !== "echo") {
      return Effect.fail(new Error(`Only echo ${config.backendLabel} worker mode is implemented.`));
    }
    if (echoFailBeforeAccept(config.envPrefix)) {
      return Effect.sleep(echoAcceptDelay(config.envPrefix)).pipe(
        Effect.zipRight(Effect.fail(new Error("Echo failed before accept."))),
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

  function runDelivery(claimed: ClaimedJobWithMessage): Effect.Effect<string | null, unknown> {
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

      const heartbeat = yield* Effect.gen(function* () {
        yield* Effect.sleep(`${LEASE_RENEW_MS} millis`);
        const renewed = yield* renew(job);
        if (renewed) job = renewed;
        else yield* Effect.fail(new Error(`${config.backendLabel} delivery lease renewal failed.`));
      }).pipe(
        Effect.forever,
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error(`[${config.backendLabel}-delivery-worker] lease renewal failed:`, error);
          }),
        ),
        Effect.fork,
      );

      const outcome = yield* runDelivery({
        ...claimed,
        job,
        message,
      } as ClaimedJobWithMessage).pipe(
        Effect.map((reply) => ({ _tag: "sent" as const, reply })),
        Effect.catchAll((error) =>
          Effect.succeed({
            _tag: "failed" as const,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
        Effect.ensuring(Fiber.interrupt(heartbeat)),
      );

      if (outcome._tag === "sent") {
        yield* complete(job, outcome.reply);
        return true;
      }

      if (job.attemptCount >= job.maxAttempts) yield* fail(job, outcome.error);
      else yield* retry(job, outcome.error);
      return true;
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
