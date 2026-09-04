import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { codexReasoningEfforts } from "../../src/codex-reasoning-effort.ts";
import { createJarvisInSpaceEffect, JarvisCreateError } from "../jarvis-create.ts";
import { buildSpaceActivity } from "../space-activity.ts";
import {
  applySpaceAction,
  createSpace,
  readSpaceState,
  spaceState,
  toSpacesError,
} from "../spaces.ts";
import { openApiDocs } from "./openapi-docs.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";

const SpaceIdPath = Schema.Struct({ spaceId: Schema.String });

const SessionResult = Schema.Struct({
  id: Schema.String,
  t3InstanceId: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.String,
  agent: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  status: Schema.Literal("Attached", "Jarvis"),
  tone: Schema.String,
  state: Schema.optional(Schema.Literal("important", "general", "archived", "jarvis")),
  repoId: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  worktreeId: Schema.optional(Schema.String),
  archived: Schema.optional(Schema.Boolean),
  rosterStatus: Schema.optional(Schema.Literal("error", "attention", "working", "idle", "unknown")),
  rosterStatusLabel: Schema.optional(Schema.String),
  workspacePath: Schema.optional(Schema.NullOr(Schema.String)),
  workspaceLabel: Schema.optional(Schema.NullOr(Schema.String)),
  importedAt: Schema.optional(Schema.NullOr(Schema.String)),
  latestSayMessage: Schema.optional(Schema.NullOr(Schema.String)),
  latestSayAuthor: Schema.optional(Schema.NullOr(Schema.Literal("agent", "user"))),
  latestSayAt: Schema.optional(Schema.NullOr(Schema.String)),
  latestDeliveryStatus: Schema.optional(Schema.NullOr(Schema.String)),
  latestDeliveryError: Schema.optional(Schema.NullOr(Schema.String)),
  latestActivityText: Schema.optional(Schema.NullOr(Schema.String)),
  activityAt: Schema.optional(Schema.NullOr(Schema.String)),
  cachedOpenCodeStatus: Schema.optional(Schema.NullOr(Schema.String)),
  cachedActivityStatus: Schema.optional(Schema.NullOr(Schema.String)),
  timerSummary: Schema.optional(Schema.NullOr(Schema.String)),
});

const RepositoryResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  primaryBranch: Schema.String,
  primaryWorktreeId: Schema.optional(Schema.String),
  worktrees: Schema.Array(Schema.String),
  availableWorktrees: Schema.Array(Schema.String),
  availableWorktreeBranches: Schema.Record({ key: Schema.String, value: Schema.String }),
  worktreeBranches: Schema.Record({ key: Schema.String, value: Schema.String }),
  worktreePaths: Schema.Record({ key: Schema.String, value: Schema.String }),
  worktreeIds: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
});

const SpaceResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  context: Schema.String,
  defaultProvider: Schema.optional(Schema.String),
  defaultModel: Schema.optional(Schema.String),
  access: Schema.String,
  sortOrder: Schema.optional(Schema.Number),
  repos: Schema.Array(RepositoryResult),
  sessions: Schema.Array(SessionResult),
  importableSessions: Schema.Array(SessionResult),
});

export const SpacesState = Schema.Struct({
  selectedSpaceId: Schema.String,
  spaces: Schema.Array(SpaceResult),
});

const SpacesResult = Schema.Struct({
  state: SpacesState,
  spaceId: Schema.optional(Schema.String),
  repositoryId: Schema.optional(Schema.String),
  placement: Schema.optional(
    Schema.Struct({
      spaceId: Schema.String,
      repositoryId: Schema.NullOr(Schema.String),
      worktreeId: Schema.NullOr(Schema.String),
      isMainCheckout: Schema.NullOr(Schema.Boolean),
      canonicalDashboardPath: Schema.String,
      attachedRepository: Schema.Boolean,
      attachedWorktree: Schema.Boolean,
    }),
  ),
});

const SpacesError = Schema.Struct({
  error: Schema.String,
});

const CreateSpacePayload = Schema.Struct({
  name: Schema.String,
  context: Schema.String,
  parentId: Schema.NullOr(Schema.String),
});

const CreateJarvisInSpacePayload = Schema.Struct({
  name: Schema.String,
  provider: Schema.Literal("opencode", "claude", "codex", "cursor", "grok"),
  modelID: Schema.optional(Schema.String),
  reasoningEffort: Schema.optional(
    Schema.Union(Schema.Literal(""), Schema.Literal(...codexReasoningEfforts)),
  ),
});

const CreateJarvisInSpaceResult = Schema.Struct({
  state: SpacesState,
  session: Schema.Struct({
    id: Schema.String,
    state: Schema.optional(Schema.String),
    alias: Schema.optional(Schema.NullOr(Schema.String)),
    opencodeDirectory: Schema.optional(Schema.NullOr(Schema.String)),
    opencodeStatus: Schema.optional(Schema.NullOr(Schema.String)),
    opencodeTitle: Schema.optional(Schema.NullOr(Schema.String)),
    backend: Schema.optional(Schema.String),
    cwd: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  workspaceDirectory: Schema.String,
  bootstrapStatus: Schema.Literal("delivered", "queued", "failed"),
  bootstrapError: Schema.optional(Schema.String),
  resumed: Schema.Boolean,
});

const SpaceActionPayload = Schema.Struct({
  action: Schema.Literal(
    "update",
    "delete",
    "archive",
    "restore",
    "move",
    "reorderSiblings",
    "attachRepository",
    "releaseRepository",
    "updateRepository",
    "discoverWorktrees",
    "createWorktree",
    "claimWorktree",
    "releaseWorktree",
    "releaseAllWorktrees",
    "claimSession",
    "releaseSession",
    "moveSession",
    "placeSession",
  ),
  name: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.String),
  repoId: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  parentPath: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  targetSpaceId: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Literal("claim", "move")),
  expectedOwnerSpaceId: Schema.optional(Schema.String),
  orderedIds: Schema.optional(Schema.Array(Schema.String)),
});

type SpaceActionPayload = Schema.Schema.Type<typeof SpaceActionPayload>;

const SpaceActivityEvent = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("message", "delivery", "notification", "timer", "attachment"),
  sessionId: Schema.String,
  sessionTitle: Schema.String,
  title: Schema.String,
  detail: Schema.String,
  createdAt: Schema.String,
  url: Schema.NullOr(Schema.String),
  dismissedAt: Schema.NullOr(Schema.String),
});

const SpaceActivityRetention = Schema.Struct({
  messageScanLimit: Schema.Number,
  messageScanTruncated: Schema.Boolean,
  notificationRetentionLimit: Schema.Number,
  maxRangeHours: Schema.Number,
  appliedRangeHours: Schema.Number,
  rangeClamped: Schema.Boolean,
  timerFreshnessNote: Schema.String,
  scopeNote: Schema.String,
});

const SpaceActivityResult = Schema.Struct({
  spaceId: Schema.String,
  spaceName: Schema.String,
  events: Schema.Array(SpaceActivityEvent),
  messageLimit: Schema.Number,
  timerFreshnessNote: Schema.String,
  retention: SpaceActivityRetention,
});

const SpaceActivityQuery = Schema.Struct({
  hours: Schema.optional(Schema.NumberFromString),
});

function run<T>(operation: () => Promise<T>) {
  return Effect.tryPromise({ try: operation, catch: toSpacesError }).pipe(
    Effect.catchAll(publicRouteErrorResponse),
  );
}

function runSpaceState<T>(map: (state: ReturnType<typeof spaceState>) => T) {
  return readSpaceState.pipe(
    Effect.map(map),
    Effect.mapError(toSpacesError),
    Effect.catchAll(publicRouteErrorResponse),
  );
}

function toJarvisCreateRouteError(error: unknown) {
  if (error instanceof JarvisCreateError) {
    return { _tag: "SpacesError" as const, error: error.message, status: error.status };
  }
  return toSpacesError(error);
}

export const SpacesGroup = HttpApiGroup.make("spaces")
  .add(
    HttpApiEndpoint.get("getSpaces", "/api/spaces")
      .annotateContext(
        openApiDocs(
          "List spaces",
          "Returns the full Spaces dashboard state (spaces, repos, worktrees, sessions).",
        ),
      )
      .addSuccess(SpacesResult),
  )
  .add(
    HttpApiEndpoint.get("getSpace", "/api/spaces/:spaceId")
      .setPath(SpaceIdPath)
      .annotateContext(
        openApiDocs(
          "Get one space",
          "Returns Spaces dashboard state focused on a single space id.",
        ),
      )
      .addSuccess(SpacesResult)
      .addError(SpacesError, { status: 404 })
      .addError(SpacesError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.post("createSpace", "/api/spaces")
      .setPayload(CreateSpacePayload)
      .annotateContext(openApiDocs("Create a space", "Creates a new Spaces dashboard space."))
      .addSuccess(SpacesResult, { status: 201 })
      .addError(SpacesError, { status: 400 })
      .addError(SpacesError, { status: 404 })
      .addError(SpacesError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.post("createJarvisInSpace", "/api/spaces/:spaceId/jarvis")
      .setPath(SpaceIdPath)
      .setPayload(CreateJarvisInSpacePayload)
      .annotateContext(
        openApiDocs(
          "Create Jarvis session in space",
          "Creates a Jarvis-backed worker session and claims it onto the given space.",
        ),
      )
      .addSuccess(CreateJarvisInSpaceResult, { status: 201 })
      .addError(SpacesError, { status: 400 })
      .addError(SpacesError, { status: 404 })
      .addError(SpacesError, { status: 409 })
      .addError(SpacesError, { status: 500 })
      .addError(SpacesError, { status: 502 }),
  )
  .add(
    HttpApiEndpoint.post("applySpaceAction", "/api/spaces/:spaceId/action")
      .setPath(SpaceIdPath)
      .setPayload(SpaceActionPayload)
      .annotateContext(
        openApiDocs(
          "Apply space action",
          "Runs a Spaces mutation such as claimSession, moveSession, createWorktree, or attach/detach repo.",
        ),
      )
      .addSuccess(SpacesResult)
      .addError(SpacesError, { status: 400 })
      .addError(SpacesError, { status: 404 })
      .addError(SpacesError, { status: 409 })
      .addError(SpacesError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.get("getSpaceActivity", "/api/spaces/:spaceId/activity")
      .setPath(SpaceIdPath)
      .setUrlParams(SpaceActivityQuery)
      .annotateContext(
        openApiDocs(
          "Space activity",
          "Returns recent activity for sessions attached to the space (optional hours window).",
        ),
      )
      .addSuccess(SpaceActivityResult)
      .addError(SpacesError, { status: 404 })
      .addError(SpacesError, { status: 500 }),
  );

export const SpacesApi = HttpApi.make("spaces").add(SpacesGroup);

export function buildSpacesHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing SpacesGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof SpacesGroup, E, R>,
    "spaces",
    (handlers) =>
      handlers
        .handle("getSpaces", () => runSpaceState((state) => ({ state })))
        .handle("getSpace", ({ path }) =>
          readSpaceState.pipe(
            Effect.mapError(toSpacesError),
            Effect.flatMap((state) => {
              if (!state.spaces.some((space) => space.id === path.spaceId)) {
                return Effect.fail(
                  toSpacesError(Object.assign(new Error("Space not found."), { status: 404 })),
                );
              }
              return Effect.succeed({ state });
            }),
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("createSpace", ({ payload }) => run(() => createSpace(payload)))
        .handle("createJarvisInSpace", ({ path, payload }) =>
          createJarvisInSpaceEffect({
            spaceId: path.spaceId,
            name: payload.name,
            provider: payload.provider,
            modelID: payload.modelID,
            reasoningEffort: payload.reasoningEffort || undefined,
          }).pipe(
            Effect.mapError(toJarvisCreateRouteError),
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("applySpaceAction", ({ path, payload }) =>
          run(() => applySpaceAction(path.spaceId, payload)),
        )
        .handle("getSpaceActivity", ({ path, urlParams }) =>
          run(async () => {
            const activity = buildSpaceActivity(path.spaceId, {
              rangeHours: urlParams.hours,
            });
            if (!activity) {
              throw Object.assign(new Error("Space not found."), { status: 404 });
            }
            return activity;
          }),
        ),
  );
}
