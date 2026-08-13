import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { getAppSettings, getPaseoInstance } from "../settings.ts";
import {
  listPaseoChatRooms,
  listPaseoSessions,
  paseoSessionMatchesWorkspace,
} from "../paseo/client.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const Params = Schema.Struct({
  instanceId: Schema.String.annotations({ description: "Configured Paseo instance id." }),
  path: Schema.String.annotations({ description: "Checkout path used to filter Paseo sessions." }),
});
const Session = Schema.Struct({
  sessionId: Schema.String,
  chatId: Schema.String,
  title: Schema.NullOr(Schema.String),
  modifiedAt: Schema.NullOr(Schema.Number),
  imported: Schema.Boolean,
  instanceId: Schema.String,
  cwd: Schema.NullOr(Schema.String),
});
const Sessions = Schema.Struct({ instanceId: Schema.String, sessions: Schema.Array(Session) });
const Instances = Schema.Struct({
  instances: Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String })),
});
const ErrorResult = Schema.Struct({
  _tag: Schema.Literal("DiscoverPaseoError"),
  error: Schema.String,
  status: Schema.Number,
});

export const PaseoDiscoverGroup = HttpApiGroup.make("paseo-discover")
  .add(
    HttpApiEndpoint.get("listPaseoInstances", "/api/paseo/instances")
      .annotateContext(
        openApiDocs(
          "List configured Paseo instances",
          "Returns public labels for Paseo CLI instances configured in settings.",
        ),
      )
      .addSuccess(Instances),
  )
  .add(
    HttpApiEndpoint.get("discoverPaseoSessions", "/api/paseo/discover")
      .setUrlParams(Params)
      .annotateContext(
        openApiDocs(
          "Discover Paseo sessions",
          "Runs the configured Paseo CLI and returns globally visible sessions for one instance.",
        ),
      )
      .addSuccess(Sessions)
      .addError(ErrorResult, { status: 400 }),
  );

export function buildPaseoDiscoverHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof PaseoDiscoverGroup, E, R>,
    "paseo-discover",
    (handlers) =>
      handlers
        .handle("listPaseoInstances", () =>
          Effect.sync(() => ({
            instances: getAppSettings().paseoInstances.map(({ id }) => ({
              id,
              label: `Paseo (${id})`,
            })),
          })),
        )
        .handle("discoverPaseoSessions", ({ urlParams }) =>
          Effect.tryPromise({
            try: async () => {
              const instance = getPaseoInstance(urlParams.instanceId);
              if (!instance)
                throw new Error(`Paseo instance "${urlParams.instanceId}" was not found.`);
              // Chat rooms are an optional capability: an instance whose CLI/daemon
              // predates `paseo chat` must still list its agent sessions.
              const [sessions, chats] = await Promise.all([
                listPaseoSessions(instance),
                listPaseoChatRooms(instance).catch((error: unknown) => {
                  console.error(
                    `[paseo-discover] chat ls failed for instance "${instance.id}":`,
                    error,
                  );
                  return [];
                }),
              ]);
              return {
                instanceId: instance.id,
                sessions: [...sessions, ...chats].filter((session) =>
                  paseoSessionMatchesWorkspace(session, urlParams.path),
                ),
              };
            },
            catch: (cause) => ({
              _tag: "DiscoverPaseoError" as const,
              error: cause instanceof Error ? cause.message : String(cause),
              status: 400,
            }),
          }).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
