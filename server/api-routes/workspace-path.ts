import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  canWriteDirectory,
  suggestedTempWorkspacePath,
  workspacePathStatus,
} from "../workspace.ts";
import { openApiDocs } from "./openapi-docs.ts";

const CreateWorkspacePathPayload = Schema.Struct({
  path: Schema.String.annotations({
    description: "Absolute filesystem path of the workspace directory to create.",
  }),
});

const WorkspacePathStatusParams = Schema.Struct({
  path: Schema.String.annotations({
    description: "Absolute filesystem path to inspect for existence, type, and writability.",
  }),
});

const WorkspacePathStatus = Schema.Struct({
  ok: Schema.Literal(true),
  path: Schema.String,
  exists: Schema.Boolean,
  isDirectory: Schema.Boolean,
  writable: Schema.Boolean,
  creatable: Schema.Boolean,
  parentPath: Schema.NullOr(Schema.String),
});

const TempWorkspacePathSuggestion = Schema.Struct({
  path: Schema.String,
  parentPath: Schema.String,
});

const WorkspacePathCreated = Schema.Struct({
  path: Schema.String,
  exists: Schema.Boolean,
  isDirectory: Schema.Boolean,
  writable: Schema.Boolean,
  creatable: Schema.Boolean,
  parentPath: Schema.NullOr(Schema.String),
});

const WorkspacePathError = Schema.Struct({
  error: Schema.String,
  status: Schema.Number,
});

type WorkspacePathCreated = Schema.Schema.Type<typeof WorkspacePathCreated>;
type WorkspacePathStatus = Schema.Schema.Type<typeof WorkspacePathStatus>;
type TempWorkspacePathSuggestion = Schema.Schema.Type<typeof TempWorkspacePathSuggestion>;
type WorkspacePathError = Schema.Schema.Type<typeof WorkspacePathError>;

export function workspacePathStatusEffect(
  workspacePath: string,
): Effect.Effect<WorkspacePathStatus, WorkspacePathError> {
  return Effect.gen(function* () {
    const status = workspacePathStatus(workspacePath);
    if (!status.ok) return yield* Effect.fail({ error: status.error, status: 400 });
    return status;
  });
}

export const suggestTempWorkspacePathEffect: Effect.Effect<TempWorkspacePathSuggestion> =
  Effect.sync(() => {
    const suggestedPath = suggestedTempWorkspacePath();
    return { path: suggestedPath, parentPath: path.dirname(suggestedPath) };
  });

export function createWorkspacePathEffect(
  workspacePath: string,
): Effect.Effect<WorkspacePathCreated, WorkspacePathError> {
  return Effect.gen(function* () {
    const status = workspacePathStatus(workspacePath);
    if (!status.ok) return yield* Effect.fail({ error: status.error, status: 400 });
    if (status.exists && !status.isDirectory) {
      return yield* Effect.fail({ error: "Path exists but is not a directory.", status: 400 });
    }
    if (!status.exists && !status.creatable) {
      return yield* Effect.fail({ error: "Parent directory is not writable.", status: 400 });
    }

    yield* Effect.sync(() => mkdirSync(status.path, { recursive: true, mode: 0o700 }));

    return {
      path: status.path,
      exists: true,
      isDirectory: true,
      writable: canWriteDirectory(status.path),
      creatable: false,
      parentPath: null,
    };
  });
}

export const WorkspacePathGroup = HttpApiGroup.make("workspace-path")
  .add(
    HttpApiEndpoint.get("getWorkspacePath", "/api/workspace-path")
      .setUrlParams(WorkspacePathStatusParams)
      .annotateContext(
        openApiDocs(
          "Inspect workspace path",
          "Reports whether a filesystem path exists, is a directory, and is writable or creatable.",
        ),
      )
      .addSuccess(WorkspacePathStatus)
      .addError(WorkspacePathError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.get("suggestTempWorkspacePath", "/api/workspace-path/suggest-temp")
      .annotateContext(
        openApiDocs(
          "Suggest temp workspace path",
          "Returns a suggested temporary workspace directory path under the system temp folder.",
        ),
      )
      .addSuccess(TempWorkspacePathSuggestion),
  )
  .add(
    HttpApiEndpoint.post("createWorkspacePath", "/api/workspace-path")
      .setPayload(CreateWorkspacePathPayload)
      .annotateContext(
        openApiDocs(
          "Create workspace directory",
          "Creates the workspace directory on disk when missing and returns its path status.",
        ),
      )
      .addSuccess(WorkspacePathCreated, { status: 201 })
      .addError(WorkspacePathError, { status: 400 }),
  );

export const WorkspacePathApi = HttpApi.make("workspace-path").add(WorkspacePathGroup);

export function buildWorkspacePathHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof WorkspacePathGroup, E, R>,
    "workspace-path",
    (handlers) =>
      handlers
        .handle("getWorkspacePath", ({ urlParams }) => workspacePathStatusEffect(urlParams.path))
        .handle("suggestTempWorkspacePath", () => suggestTempWorkspacePathEffect)
        .handle("createWorkspacePath", ({ payload }) => createWorkspacePathEffect(payload.path)),
  );
}
