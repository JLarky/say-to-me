import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { normalizeSessionId } from "../session-id.ts";
import { withSessionCurrentModel } from "../session-services/session-router.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const CurrentModelPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const CurrentModelResult = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
});

type CurrentModelResult = Schema.Schema.Type<typeof CurrentModelResult>;

const CurrentModelError = Schema.Struct({
  _tag: Schema.Literal("CurrentModelError"),
  error: Schema.String,
  status: Schema.Number,
});

type CurrentModelError = Schema.Schema.Type<typeof CurrentModelError>;

function getCurrentModelEffect(
  rawSessionId: string,
): Effect.Effect<CurrentModelResult, CurrentModelError> {
  const sessionId = normalizeSessionId(rawSessionId);
  if (!sessionId) {
    return Effect.fail({
      _tag: "CurrentModelError" as const,
      error: "Missing session id.",
      status: 400,
    });
  }
  return withSessionCurrentModel(sessionId, (service) =>
    service.getCurrentModel(sessionId).pipe(
      Effect.mapError(
        () =>
          ({
            _tag: "CurrentModelError" as const,
            error: "Unable to read current model.",
            status: 502,
          }) as CurrentModelError,
      ),
    ),
  ).pipe(
    Effect.catchAll((e) =>
      Effect.fail({
        _tag: "CurrentModelError" as const,
        error: "error" in e ? (e as { error: string }).error : "Failed to read current model.",
        status: "status" in e ? (e as { status: number }).status : 502,
      }),
    ),
  ) as Effect.Effect<CurrentModelResult, CurrentModelError>;
}

export const CurrentModelGroup = HttpApiGroup.make("current-session-model").add(
  HttpApiEndpoint.get("getCurrentModel", "/api/sessions/:sessionId/current-model")
    .setPath(CurrentModelPath)
    .annotateContext(
      openApiDocs(
        "Get current session model",
        "Returns the model currently selected for the session, including provider and id.",
      ),
    )
    .addSuccess(CurrentModelResult)
    .addError(CurrentModelError, { status: 400 }),
);

export function buildCurrentModelHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof CurrentModelGroup, E, R>,
    "current-session-model",
    (handlers) =>
      handlers.handle("getCurrentModel", ({ path }) =>
        getCurrentModelEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
