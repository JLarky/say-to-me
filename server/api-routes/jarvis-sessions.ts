import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect, Schema } from "effect";
import { codexReasoningEfforts } from "../../src/codex-reasoning-effort.ts";
import { createJarvisInSpaceEffect, JarvisCreateError } from "../jarvis-create.ts";
import { openApiDocs } from "./openapi-docs.ts";
import { SpacesState } from "./spaces.ts";

/**
 * @deprecated Prefer POST /api/spaces/:spaceId/jarvis.
 * Thin wrapper around createJarvisInSpace — requires spaceId; defaults provider to opencode.
 */
const CreateJarvisOpenCodeSessionPayload = Schema.Struct({
  name: Schema.String,
  spaceId: Schema.String,
  provider: Schema.optional(Schema.Literal("opencode", "claude", "codex", "cursor", "grok")),
  modelID: Schema.optional(Schema.String),
  reasoningEffort: Schema.optional(
    Schema.Union(Schema.Literal(""), Schema.Literal(...codexReasoningEfforts)),
  ),
});

const JarvisCreatedSession = Schema.Struct({
  id: Schema.String,
  state: Schema.optional(Schema.String),
  alias: Schema.optional(Schema.NullOr(Schema.String)),
  opencodeDirectory: Schema.optional(Schema.NullOr(Schema.String)),
  opencodeStatus: Schema.optional(Schema.NullOr(Schema.String)),
  opencodeTitle: Schema.optional(Schema.NullOr(Schema.String)),
  backend: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.NullOr(Schema.String)),
});

const JarvisCreateResult = Schema.Struct({
  session: JarvisCreatedSession,
  state: SpacesState,
  workspaceDirectory: Schema.String,
  bootstrapStatus: Schema.Literal("delivered", "queued", "failed"),
  bootstrapError: Schema.optional(Schema.String),
  resumed: Schema.Boolean,
});

const JarvisCreateRouteError = Schema.Struct({
  _tag: Schema.Literal("JarvisCreateRouteError"),
  error: Schema.String,
  status: Schema.Number,
});

export const JarvisSessionsGroup = HttpApiGroup.make("jarvis-sessions").add(
  HttpApiEndpoint.post("createJarvisOpenCodeSession", "/api/jarvis-sessions")
    .setPayload(CreateJarvisOpenCodeSessionPayload)
    .annotateContext(
      openApiDocs(
        "Create Jarvis OpenCode session",
        "Deprecated thin wrapper around space Jarvis create. Prefer POST /api/spaces/:spaceId/jarvis.",
      ),
    )
    .addSuccess(JarvisCreateResult, { status: 201 })
    .addError(JarvisCreateRouteError, { status: 400 }),
);

export const JarvisSessionsApi = HttpApi.make("jarvis-sessions").add(JarvisSessionsGroup);

export function buildJarvisSessionsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing JarvisSessionsGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof JarvisSessionsGroup, E, R>,
    "jarvis-sessions",
    (handlers) =>
      handlers.handle("createJarvisOpenCodeSession", ({ payload }) =>
        createJarvisInSpaceEffect({
          spaceId: payload.spaceId,
          name: payload.name,
          provider: payload.provider ?? "opencode",
          modelID: payload.modelID,
          reasoningEffort: payload.reasoningEffort || undefined,
        }).pipe(
          Effect.catchAll((error) =>
            Effect.succeed(
              HttpServerResponse.unsafeJson(
                {
                  error: error instanceof Error ? error.message : String(error),
                },
                {
                  status: error instanceof JarvisCreateError ? error.status : 500,
                },
              ),
            ),
          ),
        ),
      ),
  );
}
