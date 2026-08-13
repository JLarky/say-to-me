import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { queuePayload } from "../broadcast.ts";
import { compactOpenCodeSession } from "../opencode/client.ts";
import { normalizeSessionId, validateSessionId } from "../session-id.ts";
import { ensureSession } from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const CompactOpenCodePath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const CompactOpenCodeSuccess = Schema.Unknown;

const CompactOpenCodeValidationError = Schema.Struct({
  _tag: Schema.Literal("CompactOpenCodeValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const CompactOpenCodeUpstreamError = Schema.Struct({
  _tag: Schema.Literal("CompactOpenCodeUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type CompactOpenCodeValidationError = Schema.Schema.Type<typeof CompactOpenCodeValidationError>;
type CompactOpenCodeUpstreamError = Schema.Schema.Type<typeof CompactOpenCodeUpstreamError>;

type CompactOpenCodeResult = { ok: true } | { ok: false; status: number; error: string };
type CompactOpenCodeQueuePayload = Awaited<ReturnType<typeof queuePayload>>;

export type CompactOpenCodeService = {
  ensureSession: (sessionId: string) => Effect.Effect<unknown>;
  compactSession: (sessionId: string) => Effect.Effect<CompactOpenCodeResult>;
  queuePayload: (sessionId: string) => Effect.Effect<CompactOpenCodeQueuePayload>;
};

export const CompactOpenCode = Context.GenericTag<CompactOpenCodeService>(
  "say-to-me/CompactOpenCode",
);

export const CompactOpenCodeLive = Layer.succeed(CompactOpenCode, {
  ensureSession: (sessionId) => Effect.sync(() => ensureSession(sessionId)),
  compactSession: (sessionId) => Effect.promise(() => compactOpenCodeSession(sessionId)),
  queuePayload: (sessionId) => Effect.promise(() => queuePayload(sessionId)),
} satisfies CompactOpenCodeService);

export function compactOpenCodeSessionProgram(
  rawSessionId: string,
): Effect.Effect<
  unknown,
  CompactOpenCodeUpstreamError | CompactOpenCodeValidationError,
  CompactOpenCodeService
> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId || !validateSessionId(sessionId)) {
      return yield* Effect.fail({
        _tag: "CompactOpenCodeValidationError" as const,
        error: "Invalid OpenCode session id.",
        status: 400,
      });
    }

    const openCode = yield* CompactOpenCode;
    yield* openCode.ensureSession(sessionId);
    const compacted = yield* openCode.compactSession(sessionId);
    if (!compacted.ok) {
      return yield* Effect.fail({
        _tag: "CompactOpenCodeUpstreamError" as const,
        error: compacted.error,
        status: compacted.status,
      });
    }

    const payload = yield* openCode.queuePayload(sessionId);
    return { ok: true, ...payload };
  });
}

export function compactOpenCodeSessionEffect(
  rawSessionId: string,
): Effect.Effect<unknown, CompactOpenCodeUpstreamError | CompactOpenCodeValidationError> {
  return compactOpenCodeSessionProgram(rawSessionId).pipe(Effect.provide(CompactOpenCodeLive));
}

export const OpenCodeCompactGroup = HttpApiGroup.make("opencode-compact").add(
  HttpApiEndpoint.post("compactOpenCodeSession", "/api/sessions/:sessionId/compact-opencode")
    .setPath(CompactOpenCodePath)
    .annotateContext(
      openApiDocs(
        "Compact OpenCode context",
        "Requests OpenCode to compact session context/history and returns the refreshed queue.",
      ),
    )
    .addSuccess(CompactOpenCodeSuccess)
    .addError(CompactOpenCodeValidationError, { status: 400 })
    .addError(CompactOpenCodeUpstreamError, { status: 502 }),
);

export const OpenCodeCompactApi = HttpApi.make("opencode-compact").add(OpenCodeCompactGroup);

export function buildOpenCodeCompactHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof OpenCodeCompactGroup, E, R>,
    "opencode-compact",
    (handlers) =>
      handlers.handle("compactOpenCodeSession", ({ path }) =>
        compactOpenCodeSessionProgram(path.sessionId).pipe(
          Effect.catchAll(publicRouteErrorResponse),
        ),
      ),
  );
}
