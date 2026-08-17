import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { queuePayload } from "../broadcast.ts";
import { detectSessionBackend, normalizeSessionId } from "../session-id.ts";
import { ensureSession } from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";
import { CursorSessionLayers } from "../session-services/provider-layers.ts";
import { SessionStopper } from "../session-services/interfaces.ts";

const StopCursorPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const StopCursorSuccess = Schema.Unknown;

const StopCursorValidationError = Schema.Struct({
  _tag: Schema.Literal("StopCursorValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const StopCursorUpstreamError = Schema.Struct({
  _tag: Schema.Literal("StopCursorUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type StopCursorValidationError = Schema.Schema.Type<typeof StopCursorValidationError>;
type StopCursorUpstreamError = Schema.Schema.Type<typeof StopCursorUpstreamError>;

type StopCursorResult = { ok: true } | { ok: false; status: number; error: string };
type StopCursorQueuePayload = Awaited<ReturnType<typeof queuePayload>>;

export type StopCursorService = {
  ensureSession: (sessionId: string) => Effect.Effect<unknown>;
  stopSession: (sessionId: string) => Effect.Effect<StopCursorResult>;
  queuePayload: (sessionId: string) => Effect.Effect<StopCursorQueuePayload>;
};

export const StopCursor = Context.GenericTag<StopCursorService>("say-to-me/StopCursor");

export const StopCursorLive = Layer.succeed(StopCursor, {
  ensureSession: (sessionId) => Effect.sync(() => ensureSession(sessionId)),
  stopSession: (sessionId) =>
    SessionStopper.pipe(
      Effect.provide(CursorSessionLayers),
      Effect.flatMap((service) => service.stop(sessionId)),
      Effect.catchAll(() =>
        Effect.succeed({ ok: false as const, status: 500, error: "Unknown error" }),
      ),
    ),
  queuePayload: (sessionId) => Effect.promise(() => queuePayload(sessionId)),
} satisfies StopCursorService);

export function stopCursorSessionProgram(
  rawSessionId: string,
): Effect.Effect<unknown, StopCursorUpstreamError | StopCursorValidationError, StopCursorService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId || detectSessionBackend(sessionId) !== "cursor") {
      return yield* Effect.fail({
        _tag: "StopCursorValidationError" as const,
        error: "Invalid Cursor session id.",
        status: 400,
      });
    }

    const cursor = yield* StopCursor;
    yield* cursor.ensureSession(sessionId);
    const stopped = yield* cursor.stopSession(sessionId);
    if (!stopped.ok) {
      return yield* Effect.fail({
        _tag: "StopCursorUpstreamError" as const,
        error: stopped.error,
        status: stopped.status,
      });
    }

    const payload = yield* cursor.queuePayload(sessionId);
    return { ok: true, ...payload };
  });
}

export function stopCursorSessionEffect(
  rawSessionId: string,
): Effect.Effect<unknown, StopCursorUpstreamError | StopCursorValidationError> {
  return stopCursorSessionProgram(rawSessionId).pipe(Effect.provide(StopCursorLive));
}

export const CursorStopGroup = HttpApiGroup.make("cursor-stop").add(
  HttpApiEndpoint.post("stopCursorSession", "/api/sessions/:sessionId/stop-cursor")
    .setPath(StopCursorPath)
    .annotateContext(
      openApiDocs(
        "Stop Cursor session",
        "Aborts the running Cursor agent for the session and returns the refreshed queue payload.",
      ),
    )
    .addSuccess(StopCursorSuccess)
    .addError(StopCursorValidationError, { status: 400 })
    .addError(StopCursorUpstreamError, { status: 502 }),
);

export function buildCursorStopHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing CursorStopGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof CursorStopGroup, E, R>,
    "cursor-stop",
    (handlers) =>
      handlers.handle("stopCursorSession", ({ path }) =>
        stopCursorSessionProgram(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
