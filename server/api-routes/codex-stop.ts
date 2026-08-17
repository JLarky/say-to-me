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
import { CodexSessionLayers } from "../session-services/provider-layers.ts";
import { SessionStopper } from "../session-services/interfaces.ts";

const StopCodexPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const StopCodexSuccess = Schema.Unknown;

const StopCodexValidationError = Schema.Struct({
  _tag: Schema.Literal("StopCodexValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const StopCodexUpstreamError = Schema.Struct({
  _tag: Schema.Literal("StopCodexUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type StopCodexValidationError = Schema.Schema.Type<typeof StopCodexValidationError>;
type StopCodexUpstreamError = Schema.Schema.Type<typeof StopCodexUpstreamError>;

type StopCodexResult = { ok: true } | { ok: false; status: number; error: string };
type StopCodexQueuePayload = Awaited<ReturnType<typeof queuePayload>>;

export type StopCodexService = {
  ensureSession: (sessionId: string) => Effect.Effect<unknown>;
  stopSession: (sessionId: string) => Effect.Effect<StopCodexResult>;
  queuePayload: (sessionId: string) => Effect.Effect<StopCodexQueuePayload>;
};

export const StopCodex = Context.GenericTag<StopCodexService>("say-to-me/StopCodex");

export const StopCodexLive = Layer.succeed(StopCodex, {
  ensureSession: (sessionId) => Effect.sync(() => ensureSession(sessionId)),
  stopSession: (sessionId) =>
    SessionStopper.pipe(
      Effect.provide(CodexSessionLayers),
      Effect.flatMap((service) => service.stop(sessionId)),
      Effect.catchAll(() =>
        Effect.succeed({ ok: false as const, status: 500, error: "Unknown error" }),
      ),
    ),
  queuePayload: (sessionId) => Effect.promise(() => queuePayload(sessionId)),
} satisfies StopCodexService);

export function stopCodexSessionProgram(
  rawSessionId: string,
): Effect.Effect<unknown, StopCodexUpstreamError | StopCodexValidationError, StopCodexService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId || detectSessionBackend(sessionId) !== "codex") {
      return yield* Effect.fail({
        _tag: "StopCodexValidationError" as const,
        error: "Invalid Codex session id.",
        status: 400,
      });
    }

    const codex = yield* StopCodex;
    yield* codex.ensureSession(sessionId);
    const stopped = yield* codex.stopSession(sessionId);
    if (!stopped.ok) {
      return yield* Effect.fail({
        _tag: "StopCodexUpstreamError" as const,
        error: stopped.error,
        status: stopped.status,
      });
    }

    const payload = yield* codex.queuePayload(sessionId);
    return { ok: true, ...payload };
  });
}

export function stopCodexSessionEffect(
  rawSessionId: string,
): Effect.Effect<unknown, StopCodexUpstreamError | StopCodexValidationError> {
  return stopCodexSessionProgram(rawSessionId).pipe(Effect.provide(StopCodexLive));
}

export const CodexStopGroup = HttpApiGroup.make("codex-stop").add(
  HttpApiEndpoint.post("stopCodexSession", "/api/sessions/:sessionId/stop-codex")
    .setPath(StopCodexPath)
    .annotateContext(
      openApiDocs(
        "Stop Codex session",
        "Aborts the running Codex agent for the session and returns the refreshed queue payload.",
      ),
    )
    .addSuccess(StopCodexSuccess)
    .addError(StopCodexValidationError, { status: 400 })
    .addError(StopCodexUpstreamError, { status: 502 }),
);

export function buildCodexStopHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing CodexStopGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof CodexStopGroup, E, R>,
    "codex-stop",
    (handlers) =>
      handlers.handle("stopCodexSession", ({ path }) =>
        stopCodexSessionProgram(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
