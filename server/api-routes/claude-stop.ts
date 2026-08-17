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
import { ClaudeSessionLayers } from "../session-services/provider-layers.ts";
import { SessionStopper } from "../session-services/interfaces.ts";

const StopClaudePath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const StopClaudeSuccess = Schema.Unknown;

const StopClaudeValidationError = Schema.Struct({
  _tag: Schema.Literal("StopClaudeValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const StopClaudeUpstreamError = Schema.Struct({
  _tag: Schema.Literal("StopClaudeUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type StopClaudeValidationError = Schema.Schema.Type<typeof StopClaudeValidationError>;
type StopClaudeUpstreamError = Schema.Schema.Type<typeof StopClaudeUpstreamError>;

type StopClaudeResult = { ok: true } | { ok: false; status: number; error: string };
type StopClaudeQueuePayload = Awaited<ReturnType<typeof queuePayload>>;

export type StopClaudeService = {
  ensureSession: (sessionId: string) => Effect.Effect<unknown>;
  stopSession: (sessionId: string) => Effect.Effect<StopClaudeResult>;
  queuePayload: (sessionId: string) => Effect.Effect<StopClaudeQueuePayload>;
};

export const StopClaude = Context.GenericTag<StopClaudeService>("say-to-me/StopClaude");

export const StopClaudeLive = Layer.succeed(StopClaude, {
  ensureSession: (sessionId) => Effect.sync(() => ensureSession(sessionId)),
  stopSession: (sessionId) =>
    SessionStopper.pipe(
      Effect.provide(ClaudeSessionLayers),
      Effect.flatMap((service) => service.stop(sessionId)),
      Effect.catchAll(() =>
        Effect.succeed({ ok: false as const, status: 500, error: "Unknown error" }),
      ),
    ),
  queuePayload: (sessionId) => Effect.promise(() => queuePayload(sessionId)),
} satisfies StopClaudeService);

export function stopClaudeSessionProgram(
  rawSessionId: string,
): Effect.Effect<unknown, StopClaudeUpstreamError | StopClaudeValidationError, StopClaudeService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId || detectSessionBackend(sessionId) !== "claude") {
      return yield* Effect.fail({
        _tag: "StopClaudeValidationError" as const,
        error: "Invalid Claude session id.",
        status: 400,
      });
    }

    const claude = yield* StopClaude;
    yield* claude.ensureSession(sessionId);
    const stopped = yield* claude.stopSession(sessionId);
    if (!stopped.ok) {
      return yield* Effect.fail({
        _tag: "StopClaudeUpstreamError" as const,
        error: stopped.error,
        status: stopped.status,
      });
    }

    const payload = yield* claude.queuePayload(sessionId);
    return { ok: true, ...payload };
  });
}

export function stopClaudeSessionEffect(
  rawSessionId: string,
): Effect.Effect<unknown, StopClaudeUpstreamError | StopClaudeValidationError> {
  return stopClaudeSessionProgram(rawSessionId).pipe(Effect.provide(StopClaudeLive));
}

export const ClaudeStopGroup = HttpApiGroup.make("claude-stop").add(
  HttpApiEndpoint.post("stopClaudeSession", "/api/sessions/:sessionId/stop-claude")
    .setPath(StopClaudePath)
    .annotateContext(
      openApiDocs(
        "Stop Claude session",
        "Aborts the running Claude agent for the session and returns the refreshed queue payload.",
      ),
    )
    .addSuccess(StopClaudeSuccess)
    .addError(StopClaudeValidationError, { status: 400 })
    .addError(StopClaudeUpstreamError, { status: 502 }),
);

export function buildClaudeStopHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing ClaudeStopGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof ClaudeStopGroup, E, R>,
    "claude-stop",
    (handlers) =>
      handlers.handle("stopClaudeSession", ({ path }) =>
        stopClaudeSessionProgram(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
