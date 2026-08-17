import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { queuePayload } from "../broadcast.ts";
import { stopOpenCodeSession } from "../opencode/client.ts";
import { normalizeSessionId, validateSessionId } from "../session-id.ts";
import { ensureSession } from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const StopOpenCodePath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const StopOpenCodeSuccess = Schema.Unknown;

const StopOpenCodeValidationError = Schema.Struct({
  _tag: Schema.Literal("StopOpenCodeValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const StopOpenCodeUpstreamError = Schema.Struct({
  _tag: Schema.Literal("StopOpenCodeUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type StopOpenCodeValidationError = Schema.Schema.Type<typeof StopOpenCodeValidationError>;
type StopOpenCodeUpstreamError = Schema.Schema.Type<typeof StopOpenCodeUpstreamError>;

type StopOpenCodeResult = { ok: true } | { ok: false; status: number; error: string };
type StopOpenCodeQueuePayload = Awaited<ReturnType<typeof queuePayload>>;

export type StopOpenCodeService = {
  ensureSession: (sessionId: string) => Effect.Effect<unknown>;
  stopSession: (sessionId: string) => Effect.Effect<StopOpenCodeResult>;
  queuePayload: (sessionId: string) => Effect.Effect<StopOpenCodeQueuePayload>;
};

export const StopOpenCode = Context.GenericTag<StopOpenCodeService>("say-to-me/StopOpenCode");

export const StopOpenCodeLive = Layer.succeed(StopOpenCode, {
  ensureSession: (sessionId) => Effect.sync(() => ensureSession(sessionId)),
  stopSession: (sessionId) => Effect.promise(() => stopOpenCodeSession(sessionId)),
  queuePayload: (sessionId) => Effect.promise(() => queuePayload(sessionId)),
} satisfies StopOpenCodeService);

export function stopOpenCodeSessionProgram(
  rawSessionId: string,
): Effect.Effect<
  unknown,
  StopOpenCodeUpstreamError | StopOpenCodeValidationError,
  StopOpenCodeService
> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId || !validateSessionId(sessionId)) {
      return yield* Effect.fail({
        _tag: "StopOpenCodeValidationError" as const,
        error: "Invalid OpenCode session id.",
        status: 400,
      });
    }

    const openCode = yield* StopOpenCode;
    yield* openCode.ensureSession(sessionId);
    const stopped = yield* openCode.stopSession(sessionId);
    if (!stopped.ok) {
      return yield* Effect.fail({
        _tag: "StopOpenCodeUpstreamError" as const,
        error: stopped.error,
        status: stopped.status,
      });
    }

    const payload = yield* openCode.queuePayload(sessionId);
    return { ok: true, ...payload };
  });
}

export function stopOpenCodeSessionEffect(
  rawSessionId: string,
): Effect.Effect<unknown, StopOpenCodeUpstreamError | StopOpenCodeValidationError> {
  return stopOpenCodeSessionProgram(rawSessionId).pipe(Effect.provide(StopOpenCodeLive));
}

export const OpenCodeStopGroup = HttpApiGroup.make("opencode-stop").add(
  HttpApiEndpoint.post("stopOpenCodeSession", "/api/sessions/:sessionId/stop-opencode")
    .setPath(StopOpenCodePath)
    .annotateContext(
      openApiDocs(
        "Stop OpenCode session",
        "Aborts the running OpenCode agent for the session and returns the refreshed queue payload.",
      ),
    )
    .addSuccess(StopOpenCodeSuccess)
    .addError(StopOpenCodeValidationError, { status: 400 })
    .addError(StopOpenCodeUpstreamError, { status: 502 }),
);

export const OpenCodeStopApi = HttpApi.make("opencode-stop").add(OpenCodeStopGroup);

export function buildOpenCodeStopHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing OpenCodeStopGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof OpenCodeStopGroup, E, R>,
    "opencode-stop",
    (handlers) =>
      handlers.handle("stopOpenCodeSession", ({ path }) =>
        stopOpenCodeSessionProgram(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
