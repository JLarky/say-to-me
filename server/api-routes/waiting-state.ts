import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { normalizeSessionId } from "../session-id.ts";
import { getWaitingStateEffect, WaitingStateOpenCodeLive } from "../waiting-state.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const WaitingStatePath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const WaitingStatePayload = Schema.Struct({
  state: Schema.String,
  reason: Schema.String,
  action: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
});

const WaitingStateError = Schema.Struct({
  _tag: Schema.Literal("WaitingStateError"),
  error: Schema.String,
  status: Schema.Number,
});

type WaitingStatePayload = Schema.Schema.Type<typeof WaitingStatePayload>;
type WaitingStateError = Schema.Schema.Type<typeof WaitingStateError>;

export function getWaitingStateRouteEffect(
  rawSessionId: string,
): Effect.Effect<WaitingStatePayload, WaitingStateError, never> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "WaitingStateError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    return yield* getWaitingStateEffect(sessionId).pipe(Effect.provide(WaitingStateOpenCodeLive));
  });
}

export const WaitingStateGroup = HttpApiGroup.make("waiting-state").add(
  HttpApiEndpoint.get("getWaitingState", "/api/sessions/:sessionId/waiting-state")
    .setPath(WaitingStatePath)
    .annotateContext(
      openApiDocs(
        "Get session waiting state",
        "Returns whether the session is idle, running, or waiting on user input, with a reason.",
      ),
    )
    .addSuccess(WaitingStatePayload)
    .addError(WaitingStateError, { status: 400 }),
);

export const WaitingStateApi = HttpApi.make("waiting-state").add(WaitingStateGroup);

export function buildWaitingStateHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing WaitingStateGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof WaitingStateGroup, E, R>,
    "waiting-state",
    (handlers) =>
      handlers.handle("getWaitingState", ({ path }) =>
        getWaitingStateRouteEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
