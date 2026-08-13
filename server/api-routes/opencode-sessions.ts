import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import type { DbSession } from "../db/schemas.ts";
import { addOpenCodeStatus, createOpenCodeSession } from "../opencode/client.ts";
import {
  OpenCodeSessionCreated,
  publicOpenCodeRouteErrorResponse,
  requireWritableWorkspacePathEffect,
} from "./opencode-session-shared.ts";
import { openApiDocs } from "./openapi-docs.ts";

type CreateOpenCodeSessionResult =
  | { ok: true; session: DbSession }
  | { ok: false; status: number; error: string };

export type OpenCodeSessionService = {
  createSession: (path: string) => Effect.Effect<CreateOpenCodeSessionResult>;
  addStatus: (session: DbSession) => Effect.Effect<unknown>;
};

export const OpenCodeSession = Context.GenericTag<OpenCodeSessionService>(
  "say-to-me/OpenCodeSession",
);

export const OpenCodeSessionsLive = Layer.succeed(OpenCodeSession, {
  createSession: (path) => Effect.promise(() => createOpenCodeSession(path)),
  addStatus: (session) => Effect.promise(() => addOpenCodeStatus(session)),
} satisfies OpenCodeSessionService);

const CreateOpenCodeSessionPayload = Schema.Struct({
  path: Schema.String.annotations({
    description: "Absolute workspace directory path for the new OpenCode session.",
  }),
});

const OpenCodeSessionValidationError = Schema.Struct({
  _tag: Schema.Literal("OpenCodeSessionValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const OpenCodeSessionUpstreamError = Schema.Struct({
  _tag: Schema.Literal("OpenCodeSessionUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type OpenCodeSessionValidationError = Schema.Schema.Type<typeof OpenCodeSessionValidationError>;
type OpenCodeSessionUpstreamError = Schema.Schema.Type<typeof OpenCodeSessionUpstreamError>;

export function createOpenCodeSessionEffect(
  workspacePath: string,
): Effect.Effect<
  Schema.Schema.Type<typeof OpenCodeSessionCreated>,
  OpenCodeSessionUpstreamError | OpenCodeSessionValidationError,
  OpenCodeSessionService
> {
  return Effect.gen(function* () {
    const path = yield* requireWritableWorkspacePathEffect(
      workspacePath,
      "OpenCodeSessionValidationError" as const,
    );
    const openCode = yield* OpenCodeSession;
    const created = yield* openCode.createSession(path);
    if (!created.ok) {
      return yield* Effect.fail({
        _tag: "OpenCodeSessionUpstreamError" as const,
        error: created.error,
        status: created.status,
      });
    }

    const session = yield* openCode.addStatus(created.session);
    return { session };
  });
}

export const OpenCodeSessionsGroup = HttpApiGroup.make("opencode-sessions").add(
  HttpApiEndpoint.post("createOpenCodeSession", "/api/opencode-sessions")
    .setPayload(CreateOpenCodeSessionPayload)
    .annotateContext(
      openApiDocs(
        "Create OpenCode session",
        "Creates a new OpenCode session for the given workspace path and returns local session status.",
      ),
    )
    .addSuccess(OpenCodeSessionCreated, { status: 201 })
    .addError(OpenCodeSessionValidationError, { status: 400 })
    .addError(OpenCodeSessionUpstreamError, { status: 502 }),
);

export const OpenCodeSessionsApi = HttpApi.make("opencode-sessions").add(OpenCodeSessionsGroup);

export function buildOpenCodeSessionsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof OpenCodeSessionsGroup, E, R>,
    "opencode-sessions",
    (handlers) =>
      handlers.handle("createOpenCodeSession", ({ payload }) =>
        createOpenCodeSessionEffect(payload.path).pipe(
          Effect.catchAll(publicOpenCodeRouteErrorResponse),
        ),
      ),
  );
}
