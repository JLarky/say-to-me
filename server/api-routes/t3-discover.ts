import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";

import { discoverT3SessionsForPathEffect } from "../t3/client.ts";
import { listConfiguredT3InstanceIds } from "../t3/instance-list.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const DiscoverParams = Schema.Struct({
  instanceId: Schema.String.annotations({
    description: 'Configured T3 instance id (for example "default").',
  }),
  path: Schema.String.annotations({
    description: "Git checkout path used to filter T3 threads for this repository.",
  }),
});

const DiscoverableSession = Schema.Struct({
  sessionId: Schema.String,
  chatId: Schema.String,
  title: Schema.NullOr(Schema.String),
  modifiedAt: Schema.NullOr(Schema.Number),
  imported: Schema.Boolean,
  instanceId: Schema.String,
  projectId: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  workspaceRoot: Schema.NullOr(Schema.String),
});

const T3SessionsDiscovered = Schema.Struct({
  path: Schema.String,
  instanceId: Schema.String,
  sessions: Schema.Array(DiscoverableSession),
});

const T3InstancesListed = Schema.Struct({
  instances: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    }),
  ),
});

const DiscoverT3Error = Schema.Struct({
  _tag: Schema.Literal("DiscoverT3Error"),
  error: Schema.String,
  status: Schema.Number,
});

type DiscoverT3Error = Schema.Schema.Type<typeof DiscoverT3Error>;

export function listT3InstancesEffect(): Effect.Effect<
  Schema.Schema.Type<typeof T3InstancesListed>
> {
  return Effect.sync(() => ({
    instances: listConfiguredT3InstanceIds().map((id) => ({
      id,
      label: `T3 (${id})`,
    })),
  }));
}

export function discoverT3SessionsEffect(
  instanceId: string,
  workspacePath: string,
): Effect.Effect<Schema.Schema.Type<typeof T3SessionsDiscovered>, DiscoverT3Error> {
  return Effect.gen(function* () {
    const result = yield* discoverT3SessionsForPathEffect(instanceId, workspacePath);
    if (!result.ok) {
      return yield* Effect.fail({
        _tag: "DiscoverT3Error" as const,
        error: result.error,
        status: 400,
      });
    }
    return {
      path: result.path,
      instanceId: result.instanceId,
      sessions: result.sessions,
    };
  });
}

export const T3DiscoverGroup = HttpApiGroup.make("t3-discover")
  .add(
    HttpApiEndpoint.get("listT3Instances", "/api/t3/instances")
      .annotateContext(
        openApiDocs(
          "List configured T3 instances",
          "Returns public labels for T3 server instances configured in settings.",
        ),
      )
      .addSuccess(T3InstancesListed),
  )
  .add(
    HttpApiEndpoint.get("discoverT3Sessions", "/api/t3/discover")
      .setUrlParams(DiscoverParams)
      .annotateContext(
        openApiDocs(
          "Discover T3 threads for a checkout",
          "Mints/reuses a T3 access token and lists shell threads whose project matches the checkout path.",
        ),
      )
      .addSuccess(T3SessionsDiscovered)
      .addError(DiscoverT3Error, { status: 400 }),
  );

export function buildT3DiscoverHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing T3DiscoverGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof T3DiscoverGroup, E, R>,
    "t3-discover",
    (handlers) =>
      handlers
        .handle("listT3Instances", () => listT3InstancesEffect())
        .handle("discoverT3Sessions", ({ urlParams }) =>
          discoverT3SessionsEffect(urlParams.instanceId, urlParams.path).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        ),
  );
}
