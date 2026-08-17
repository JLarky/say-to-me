import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { parseCodexActivityLimit } from "../codex/activity-hub.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { detectSessionBackend, normalizeSessionId } from "../session-id.ts";
import { CodexSessionLayers } from "../session-services/provider-layers.ts";
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
  _tag: Schema.Literal("CodexActivityError"),
  error: Schema.String,
  status: Schema.Number,
});
type ActivityError = Schema.Schema.Type<typeof ActivityError>;

function activityError(error: string, status = 400): ActivityError {
  return { _tag: "CodexActivityError", error, status };
}

export function codexActivityEffect({
  rawSessionId,
  rawLimit,
}: {
  rawSessionId: string;
  rawLimit: string | undefined;
}): Effect.Effect<unknown, ActivityError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) return yield* Effect.fail(activityError("Invalid session id."));
    if (detectSessionBackend(sessionId) !== "codex") {
      return yield* Effect.fail(activityError("Not a Codex session.", 404));
    }
    const service = yield* SessionActivity;
    const result = yield* service.getSnapshot(sessionId, parseCodexActivityLimit(rawLimit));
    return result;
  }).pipe(
    Effect.provide(CodexSessionLayers),
    Effect.catchAll((error) =>
      error._tag === "ActivityError"
        ? Effect.fail(activityError(error.message, 500))
        : Effect.fail(activityError("Unknown error", 500)),
    ),
  );
}

export const CodexActivityGroup = HttpApiGroup.make("codex-activity").add(
  HttpApiEndpoint.get("codexActivity", "/api/sessions/:sessionId/codex-activity")
    .setPath(SessionPath)
    .setUrlParams(ActivityQuery)
    .annotateContext(
      openApiDocs(
        "Get Codex activity",
        "Returns a Codex activity snapshot for the session, optionally limited by count.",
      ),
    )
    .addSuccess(ActivityPayload)
    .addError(ActivityError, { status: 400 }),
);

export function buildCodexActivityHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing CodexActivityGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof CodexActivityGroup, E, R>,
    "codex-activity",
    (handlers) =>
      handlers.handle("codexActivity", ({ path, urlParams }) =>
        codexActivityEffect({ rawSessionId: path.sessionId, rawLimit: urlParams.limit }).pipe(
          Effect.catchAll(publicRouteErrorResponse),
        ),
      ),
  );
}
