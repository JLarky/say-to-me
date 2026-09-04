import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import type { DbSession } from "../db/schemas.ts";
import { addOpenCodeStatus, createOpenCodeWorktreeSession } from "../opencode/client.ts";
import { workspacePathStatus } from "../workspace.ts";
import {
  OpenCodeSessionCreated,
  publicOpenCodeRouteErrorResponse,
} from "./opencode-session-shared.ts";
import { openApiDocs } from "./openapi-docs.ts";

type WorkspacePathStatus = ReturnType<typeof workspacePathStatus>;
type OpenCodeSessionWithStatus = Awaited<ReturnType<typeof addOpenCodeStatus>>;
type CreateOpenCodeWorktreeSessionResult =
  | { ok: true; session: DbSession }
  | { ok: false; status: number; error: string };

export type OpenCodeWorkspaceService = {
  workspacePathStatus: (input: string) => Effect.Effect<WorkspacePathStatus>;
  createWorktreeSession: (path: string) => Effect.Effect<CreateOpenCodeWorktreeSessionResult>;
  addStatus: (session: DbSession) => Effect.Effect<OpenCodeSessionWithStatus>;
};

export const OpenCodeWorkspace = Context.GenericTag<OpenCodeWorkspaceService>(
  "say-to-me/OpenCodeWorkspace",
);

export const OpenCodeWorkspaceLive = Layer.succeed(OpenCodeWorkspace, {
  workspacePathStatus: (input) => Effect.sync(() => workspacePathStatus(input)),
  createWorktreeSession: (path) => Effect.promise(() => createOpenCodeWorktreeSession(path)),
  addStatus: (session) => Effect.promise(() => addOpenCodeStatus(session)),
} satisfies OpenCodeWorkspaceService);

const CreateOpenCodeWorkspacePayload = Schema.Struct({
  directory: Schema.String,
});

const OpenCodeWorkspaceValidationError = Schema.Struct({
  _tag: Schema.Literal("OpenCodeWorkspaceValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const OpenCodeWorkspaceUpstreamError = Schema.Struct({
  _tag: Schema.Literal("OpenCodeWorkspaceUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type OpenCodeWorkspaceValidationError = Schema.Schema.Type<typeof OpenCodeWorkspaceValidationError>;
type OpenCodeWorkspaceUpstreamError = Schema.Schema.Type<typeof OpenCodeWorkspaceUpstreamError>;

export function createOpenCodeWorkspaceProgram(
  directory: string,
): Effect.Effect<
  Schema.Schema.Type<typeof OpenCodeSessionCreated>,
  OpenCodeWorkspaceUpstreamError | OpenCodeWorkspaceValidationError,
  OpenCodeWorkspaceService
> {
  return Effect.gen(function* () {
    const service = yield* OpenCodeWorkspace;
    const status = yield* service.workspacePathStatus(directory);
    if (!status.ok) {
      return yield* Effect.fail({
        _tag: "OpenCodeWorkspaceValidationError" as const,
        error: status.error,
        status: 400,
      });
    }
    if (!status.exists || !status.isDirectory || !status.writable) {
      return yield* Effect.fail({
        _tag: "OpenCodeWorkspaceValidationError" as const,
        error: "Path must exist and be a writable directory.",
        status: 400,
      });
    }

    const created = yield* service.createWorktreeSession(status.path);
    if (!created.ok) {
      return yield* Effect.fail({
        _tag: "OpenCodeWorkspaceUpstreamError" as const,
        error: created.error,
        status: created.status,
      });
    }

    const session = yield* service.addStatus(created.session);
    return { session };
  });
}

export function createOpenCodeWorkspaceEffect(
  directory: string,
): Effect.Effect<
  Schema.Schema.Type<typeof OpenCodeSessionCreated>,
  OpenCodeWorkspaceUpstreamError | OpenCodeWorkspaceValidationError
> {
  return createOpenCodeWorkspaceProgram(directory).pipe(Effect.provide(OpenCodeWorkspaceLive));
}

export const OpenCodeWorkspacesGroup = HttpApiGroup.make("opencode-workspaces").add(
  HttpApiEndpoint.post("createOpenCodeWorkspace", "/api/opencode-workspaces")
    .setPayload(CreateOpenCodeWorkspacePayload)
    .annotateContext(
      openApiDocs(
        "Create OpenCode workspace",
        "Creates an OpenCode project/workspace at the given directory and returns the new session.",
      ),
    )
    .addSuccess(OpenCodeSessionCreated, { status: 201 })
    .addError(OpenCodeWorkspaceValidationError, { status: 400 })
    .addError(OpenCodeWorkspaceUpstreamError, { status: 502 }),
);

export const OpenCodeWorkspacesApi =
  HttpApi.make("opencode-workspaces").add(OpenCodeWorkspacesGroup);

export function buildOpenCodeWorkspacesHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing OpenCodeWorkspacesGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof OpenCodeWorkspacesGroup, E, R>,
    "opencode-workspaces",
    (handlers) =>
      handlers.handle("createOpenCodeWorkspace", ({ payload }) =>
        createOpenCodeWorkspaceProgram(payload.directory).pipe(
          Effect.catchAll(publicOpenCodeRouteErrorResponse),
        ),
      ),
  );
}
