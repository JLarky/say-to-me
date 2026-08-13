import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { getWorkspaceSessionContext } from "../external-cli/session-context.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const SessionContextParams = Schema.Struct({
  path: Schema.String.annotations({
    description: "Workspace filesystem path whose session context should be summarized.",
  }),
});

const SessionContextProviderStats = Schema.Struct({
  importableCount: Schema.Number,
  inAppCount: Schema.Number,
});

const SessionContextSession = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  title: Schema.NullOr(Schema.String),
});

const SessionContextPayload = Schema.Struct({
  path: Schema.String,
  pathStatus: Schema.Struct({
    exists: Schema.Boolean,
    isDirectory: Schema.Boolean,
    writable: Schema.Boolean,
    creatable: Schema.Boolean,
    parentPath: Schema.NullOr(Schema.String),
  }),
  providers: Schema.Struct({
    claude: SessionContextProviderStats,
    codex: SessionContextProviderStats,
    cursor: SessionContextProviderStats,
    grok: SessionContextProviderStats,
  }),
  sessionsHere: Schema.Array(SessionContextSession),
  opencodeProject: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      sessionCount: Schema.Number,
    }),
  ),
});

const SessionContextError = Schema.Struct({
  _tag: Schema.Literal("SessionContextError"),
  error: Schema.String,
  status: Schema.Number,
});

type SessionContextPayload = Schema.Schema.Type<typeof SessionContextPayload>;
type SessionContextError = Schema.Schema.Type<typeof SessionContextError>;

export function workspaceSessionContextEffect(
  workspacePath: string,
): Effect.Effect<SessionContextPayload, SessionContextError> {
  return Effect.gen(function* () {
    const result = getWorkspaceSessionContext(workspacePath);
    if (!result.ok) {
      return yield* Effect.fail({
        _tag: "SessionContextError" as const,
        error: result.error,
        status: 400,
      });
    }
    return result.context;
  });
}

export const SessionContextGroup = HttpApiGroup.make("session-context").add(
  HttpApiEndpoint.get("getWorkspaceSessionContext", "/api/sessions/context")
    .setUrlParams(SessionContextParams)
    .annotateContext(
      openApiDocs(
        "Get workspace session context",
        "Summarizes path status, importable external sessions, and in-app sessions for a workspace.",
      ),
    )
    .addSuccess(SessionContextPayload)
    .addError(SessionContextError, { status: 400 }),
);

export function buildSessionContextHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof SessionContextGroup, E, R>,
    "session-context",
    (handlers) =>
      handlers.handle("getWorkspaceSessionContext", ({ urlParams }) =>
        workspaceSessionContextEffect(urlParams.path).pipe(
          Effect.catchAll(publicRouteErrorResponse),
        ),
      ),
  );
}
