import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import {
  discoverExternalCliSessions,
  type DiscoverableExternalCliProvider,
} from "../external-cli/discover-sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const DiscoverParams = Schema.Struct({
  provider: Schema.Literal("claude", "codex", "cursor", "grok"),
  path: Schema.String.annotations({
    description: "Workspace directory path to scan for external CLI sessions.",
  }),
});

const DiscoverableSession = Schema.Struct({
  sessionId: Schema.String,
  chatId: Schema.String,
  title: Schema.NullOr(Schema.String),
  modifiedAt: Schema.NullOr(Schema.Number),
  imported: Schema.Boolean,
});

const ExternalCliSessionsDiscovered = Schema.Struct({
  path: Schema.String,
  sessions: Schema.Array(DiscoverableSession),
});

const DiscoverExternalCliError = Schema.Struct({
  _tag: Schema.Literal("DiscoverExternalCliError"),
  error: Schema.String,
  status: Schema.Number,
});

type DiscoverExternalCliError = Schema.Schema.Type<typeof DiscoverExternalCliError>;

export function discoverExternalCliEffect(
  provider: DiscoverableExternalCliProvider,
  workspacePath: string,
): Effect.Effect<
  Schema.Schema.Type<typeof ExternalCliSessionsDiscovered>,
  DiscoverExternalCliError
> {
  return Effect.gen(function* () {
    const result = discoverExternalCliSessions(provider, workspacePath);
    if (!result.ok) {
      return yield* Effect.fail({
        _tag: "DiscoverExternalCliError" as const,
        error: result.error,
        status: 400,
      });
    }
    return { path: result.path, sessions: result.sessions };
  });
}

export const ExternalCliDiscoverGroup = HttpApiGroup.make("external-cli-discover").add(
  HttpApiEndpoint.get("discoverExternalCliSessions", "/api/external-cli/discover")
    .setUrlParams(DiscoverParams)
    .annotateContext(
      openApiDocs(
        "Discover external CLI sessions",
        "Scans a workspace path for Claude, Codex, Cursor, or Grok sessions that can be imported.",
      ),
    )
    .addSuccess(ExternalCliSessionsDiscovered)
    .addError(DiscoverExternalCliError, { status: 400 }),
);

export function buildExternalCliDiscoverHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof ExternalCliDiscoverGroup, E, R>,
    "external-cli-discover",
    (handlers) =>
      handlers.handle("discoverExternalCliSessions", ({ urlParams }) =>
        discoverExternalCliEffect(urlParams.provider, urlParams.path).pipe(
          Effect.catchAll(publicRouteErrorResponse),
        ),
      ),
  );
}
