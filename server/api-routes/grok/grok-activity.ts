import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect, Schema } from "effect";
import { parseGrokActivityLimit } from "../../grok/activity-hub.ts";
import { detectSessionBackend, normalizeSessionId } from "../../session-id.ts";
import { GrokSessionLayers } from "../../session-services/provider-layers.ts";
import { SessionActivity } from "../../session-services/interfaces.ts";

import { openApiDocs } from "../openapi-docs.ts";

const SessionPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});
const ActivityQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.String.annotations({
      description: "Maximum number of activity events to include in the snapshot.",
    }),
  ),
});
const ActivityPayload = Schema.Unknown;
const ActivityError = Schema.Struct({
  _tag: Schema.Literal("GrokActivityError"),
  error: Schema.String,
  status: Schema.Number,
});
type ActivityError = Schema.Schema.Type<typeof ActivityError>;

function activityError(error: string, status = 400): ActivityError {
  return { _tag: "GrokActivityError", error, status };
}

export function grokActivityEffect({
  rawSessionId,
  rawLimit,
}: {
  rawSessionId: string;
  rawLimit: string | undefined;
}): Effect.Effect<unknown, ActivityError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) return yield* Effect.fail(activityError("Invalid session id."));
    if (detectSessionBackend(sessionId) !== "grok") {
      return yield* Effect.fail(activityError("Not a Grok session.", 404));
    }
    const service = yield* SessionActivity;
    const result = yield* service.getSnapshot(sessionId, parseGrokActivityLimit(rawLimit));
    return result;
  }).pipe(
    Effect.provide(GrokSessionLayers),
    Effect.catchAll((error) =>
      error._tag === "ActivityError"
        ? Effect.fail(activityError(error.message, 500))
        : Effect.fail(activityError("Unknown error", 500)),
    ),
  );
}

export const GrokActivityGroup = HttpApiGroup.make("grok-activity").add(
  HttpApiEndpoint.get("grokActivity", "/api/sessions/:sessionId/grok-activity")
    .setPath(SessionPath)
    .setUrlParams(ActivityQuery)
    .annotateContext(
      openApiDocs(
        "Get Grok activity",
        "Returns a Grok activity snapshot for the session, optionally limited by count.",
      ),
    )
    .addSuccess(ActivityPayload)
    .addError(ActivityError, { status: 400 }),
);

export function buildGrokActivityHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof GrokActivityGroup, E, R>,
    "grok-activity",
    (handlers) =>
      handlers.handle("grokActivity", ({ path, urlParams }) =>
        grokActivityEffect({ rawSessionId: path.sessionId, rawLimit: urlParams.limit }).pipe(
          Effect.catchAll((error) =>
            Effect.succeed(
              HttpServerResponse.unsafeJson({ error: error.error }, { status: error.status }),
            ),
          ),
        ),
      ),
  );
}
