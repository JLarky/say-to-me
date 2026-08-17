import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { queuePayload } from "../../broadcast.ts";
import { detectSessionBackend, normalizeSessionId } from "../../session-id.ts";
import { ensureSession } from "../../sessions.ts";
import { publicRouteErrorResponse } from "../route-errors.ts";
import { openApiDocs } from "../openapi-docs.ts";
import { GrokSessionLayers } from "../../session-services/provider-layers.ts";
import { SessionStopper } from "../../session-services/interfaces.ts";

const StopGrokPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const StopGrokSuccess = Schema.Unknown;

const StopGrokValidationError = Schema.Struct({
  _tag: Schema.Literal("StopGrokValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const StopGrokUpstreamError = Schema.Struct({
  _tag: Schema.Literal("StopGrokUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type StopGrokValidationError = Schema.Schema.Type<typeof StopGrokValidationError>;
type StopGrokUpstreamError = Schema.Schema.Type<typeof StopGrokUpstreamError>;

type StopGrokResult = { ok: true } | { ok: false; status: number; error: string };
type StopGrokQueuePayload = Awaited<ReturnType<typeof queuePayload>>;

export type StopGrokService = {
  ensureSession: (sessionId: string) => Effect.Effect<unknown>;
  stopSession: (sessionId: string) => Effect.Effect<StopGrokResult>;
  queuePayload: (sessionId: string) => Effect.Effect<StopGrokQueuePayload>;
};

export const StopGrok = Context.GenericTag<StopGrokService>("say-to-me/StopGrok");

export const StopGrokLive = Layer.succeed(StopGrok, {
  ensureSession: (sessionId) => Effect.sync(() => ensureSession(sessionId)),
  stopSession: (sessionId) =>
    SessionStopper.pipe(
      Effect.provide(GrokSessionLayers),
      Effect.flatMap((service) => service.stop(sessionId)),
      Effect.catchAll(() =>
        Effect.succeed({ ok: false as const, status: 500, error: "Unknown error" }),
      ),
    ),
  queuePayload: (sessionId) => Effect.promise(() => queuePayload(sessionId)),
} satisfies StopGrokService);

export function stopGrokSessionProgram(
  rawSessionId: string,
): Effect.Effect<unknown, StopGrokUpstreamError | StopGrokValidationError, StopGrokService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId || detectSessionBackend(sessionId) !== "grok") {
      return yield* Effect.fail({
        _tag: "StopGrokValidationError" as const,
        error: "Invalid Grok session id.",
        status: 400,
      });
    }

    const grok = yield* StopGrok;
    yield* grok.ensureSession(sessionId);
    const stopped = yield* grok.stopSession(sessionId);
    if (!stopped.ok) {
      return yield* Effect.fail({
        _tag: "StopGrokUpstreamError" as const,
        error: stopped.error,
        status: stopped.status,
      });
    }

    const payload = yield* grok.queuePayload(sessionId);
    return { ok: true, ...payload };
  });
}

export function stopGrokSessionEffect(
  rawSessionId: string,
): Effect.Effect<unknown, StopGrokUpstreamError | StopGrokValidationError> {
  return stopGrokSessionProgram(rawSessionId).pipe(Effect.provide(StopGrokLive));
}

export const GrokStopGroup = HttpApiGroup.make("grok-stop").add(
  HttpApiEndpoint.post("stopGrokSession", "/api/sessions/:sessionId/stop-grok")
    .setPath(StopGrokPath)
    .annotateContext(
      openApiDocs(
        "Stop Grok session",
        "Aborts the running Grok agent for the session and returns the refreshed queue payload.",
      ),
    )
    .addSuccess(StopGrokSuccess)
    .addError(StopGrokValidationError, { status: 400 })
    .addError(StopGrokUpstreamError, { status: 502 }),
);

export function buildGrokStopHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing GrokStopGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof GrokStopGroup, E, R>,
    "grok-stop",
    (handlers) =>
      handlers.handle("stopGrokSession", ({ path }) =>
        stopGrokSessionProgram(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
