import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";

import { getAppSettings, SettingsValidationError, updateAppSettings } from "../settings.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const T3ServerInstance = Schema.Struct({
  id: Schema.String,
  binPath: Schema.optional(Schema.String),
  baseDir: Schema.String,
  originUrl: Schema.String,
  isDev: Schema.Boolean,
});

const PaseoInstance = Schema.Struct({
  id: Schema.String,
  serverId: Schema.optional(Schema.String),
  localUrl: Schema.optional(Schema.String),
  tailscaleUrl: Schema.optional(Schema.String),
  binPath: Schema.optional(Schema.String),
  home: Schema.optional(Schema.String),
  host: Schema.String,
});

const OpenCodeInstance = Schema.Struct({
  id: Schema.String,
  localUrl: Schema.optional(Schema.String),
  tailscaleUrl: Schema.optional(Schema.String),
});

const SettingsResult = Schema.Struct({
  preferredWorktreeParentPath: Schema.NullOr(Schema.String),
  preferredJarvisParentPath: Schema.NullOr(Schema.String),
  t3ServerInstances: Schema.Array(T3ServerInstance),
  paseoInstances: Schema.Array(PaseoInstance),
  opencodeInstances: Schema.Array(OpenCodeInstance),
});

const UpdateSettingsPayload = Schema.Struct({
  preferredWorktreeParentPath: Schema.optional(Schema.NullOr(Schema.String)),
  preferredJarvisParentPath: Schema.optional(Schema.NullOr(Schema.String)),
  t3ServerInstances: Schema.optional(Schema.Array(T3ServerInstance)),
  paseoInstances: Schema.optional(Schema.Array(PaseoInstance)),
  opencodeInstances: Schema.optional(Schema.Array(OpenCodeInstance)),
});

const SettingsValidationRouteError = Schema.Struct({
  _tag: Schema.Literal("SettingsValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

export const SettingsGroup = HttpApiGroup.make("settings")
  .add(
    HttpApiEndpoint.get("getSettings", "/api/settings")
      .annotateContext(
        openApiDocs(
          "Get app settings",
          "Returns preferred parent paths for worktrees and Jarvis workspaces, and configured T3 server instances. Access tokens are server-only secrets and are never returned.",
        ),
      )
      .addSuccess(SettingsResult),
  )
  .add(
    HttpApiEndpoint.patch("updateSettings", "/api/settings")
      .setPayload(UpdateSettingsPayload)
      .annotateContext(
        openApiDocs(
          "Update app settings",
          "Patches preferred worktree/Jarvis parent path settings and public T3 server instance fields. Access tokens cannot be set or read through this endpoint.",
        ),
      )
      .addSuccess(SettingsResult)
      .addError(SettingsValidationRouteError, { status: 400 }),
  );

export const SettingsApi = HttpApi.make("settings").add(SettingsGroup);

export function buildSettingsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing SettingsGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof SettingsGroup, E, R>,
    "settings",
    (handlers) =>
      handlers
        .handle("getSettings", () => Effect.sync(getAppSettings))
        .handle("updateSettings", ({ payload }) =>
          Effect.gen(function* () {
            try {
              return updateAppSettings(payload);
            } catch (cause) {
              if (cause instanceof SettingsValidationError) {
                return yield* Effect.fail({
                  _tag: "SettingsValidationError" as const,
                  error: cause.message,
                  status: 400,
                });
              }
              throw cause;
            }
          }).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
