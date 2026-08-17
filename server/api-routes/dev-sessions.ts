import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { reimportOpenCodeContext } from "../opencode/client.ts";
import { normalizeSessionId, validateSessionId } from "../session-id.ts";
import { ensureSession } from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const DevSessionPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const DevSessionReimported = Schema.Struct({
  ok: Schema.Literal(true),
  session: Schema.Unknown,
});

const DevSessionError = Schema.Struct({
  _tag: Schema.Literal("DevSessionError"),
  error: Schema.String,
  status: Schema.Number,
});

type DevSessionReimported = Schema.Schema.Type<typeof DevSessionReimported>;
type DevSessionError = Schema.Schema.Type<typeof DevSessionError>;

export function reimportOpenCodeContextEffect(
  rawSessionId: string,
): Effect.Effect<DevSessionReimported, DevSessionError> {
  return Effect.gen(function* () {
    if (!import.meta.env?.DEV) {
      return yield* Effect.fail({
        _tag: "DevSessionError" as const,
        error: "Not found.",
        status: 404,
      });
    }
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId || !validateSessionId(sessionId)) {
      return yield* Effect.fail({
        _tag: "DevSessionError" as const,
        error: "Invalid OpenCode session id.",
        status: 400,
      });
    }

    const session = ensureSession(sessionId);
    const result = yield* Effect.promise(() => reimportOpenCodeContext(session));
    if (!result.ok) {
      return yield* Effect.fail({
        _tag: "DevSessionError" as const,
        error: result.error,
        status: result.status,
      });
    }
    return { ok: true, session: result.session };
  });
}

export const DevSessionsGroup = HttpApiGroup.make("dev-sessions").add(
  HttpApiEndpoint.post("reimportOpenCodeContext", "/api/dev/sessions/:sessionId/reimport-context")
    .setPath(DevSessionPath)
    .annotateContext(
      openApiDocs(
        "Reimport OpenCode context",
        "Dev-only helper that reimports OpenCode conversation context for a session.",
      ),
    )
    .addSuccess(DevSessionReimported)
    .addError(DevSessionError, { status: 400 }),
);

export const DevSessionsApi = HttpApi.make("dev-sessions").add(DevSessionsGroup);

export function buildDevSessionsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing DevSessionsGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof DevSessionsGroup, E, R>,
    "dev-sessions",
    (handlers) =>
      handlers.handle("reimportOpenCodeContext", ({ path }) =>
        reimportOpenCodeContextEffect(path.sessionId).pipe(
          Effect.catchAll(publicRouteErrorResponse),
        ),
      ),
  );
}
