import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { parseClaudeActivityLimit } from "../claude/activity-hub.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { detectSessionBackend, normalizeSessionId } from "../session-id.ts";
import { ClaudeSessionLayers } from "../session-services/provider-layers.ts";
import { SessionActivity } from "../session-services/interfaces.ts";
import { openApiDocs } from "./openapi-docs.ts";

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
  _tag: Schema.Literal("ClaudeActivityError"),
  error: Schema.String,
  status: Schema.Number,
});
type ActivityError = Schema.Schema.Type<typeof ActivityError>;

function activityError(error: string, status = 400): ActivityError {
  return { _tag: "ClaudeActivityError", error, status };
}

export function claudeActivityEffect({
  rawSessionId,
  rawLimit,
}: {
  rawSessionId: string;
  rawLimit: string | undefined;
}): Effect.Effect<unknown, ActivityError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) return yield* Effect.fail(activityError("Invalid session id."));
    if (detectSessionBackend(sessionId) !== "claude") {
      return yield* Effect.fail(activityError("Not a Claude session.", 404));
    }
    const service = yield* SessionActivity;
    const result = yield* service.getSnapshot(sessionId, parseClaudeActivityLimit(rawLimit));
    return result;
  }).pipe(
    Effect.provide(ClaudeSessionLayers),
    Effect.catchAll((error) =>
      error._tag === "ActivityError"
        ? Effect.fail(activityError(error.message, 500))
        : Effect.fail(activityError("Unknown error", 500)),
    ),
  );
}

export const ClaudeActivityGroup = HttpApiGroup.make("claude-activity").add(
  HttpApiEndpoint.get("claudeActivity", "/api/sessions/:sessionId/claude-activity")
    .setPath(SessionPath)
    .setUrlParams(ActivityQuery)
    .annotateContext(
      openApiDocs(
        "Get Claude activity",
        "Returns a Claude activity snapshot for the session, optionally limited by count.",
      ),
    )
    .addSuccess(ActivityPayload)
    .addError(ActivityError, { status: 400 }),
);

export function buildClaudeActivityHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing ClaudeActivityGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof ClaudeActivityGroup, E, R>,
    "claude-activity",
    (handlers) =>
      handlers.handle("claudeActivity", ({ path, urlParams }) =>
        claudeActivityEffect({ rawSessionId: path.sessionId, rawLimit: urlParams.limit }).pipe(
          Effect.catchAll(publicRouteErrorResponse),
        ),
      ),
  );
}
