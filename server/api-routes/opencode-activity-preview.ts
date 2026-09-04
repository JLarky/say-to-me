import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { enableOpenCodeActivityPreview } from "../config.ts";
import { compareOpenCodeSurfaces, getOpenCodeActivityPreview } from "../opencode/activity.ts";
import {
  getOpenCodeActivitySnapshot,
  inspectOpenCodeActivityRuntime,
} from "../opencode/activity-routes.ts";
import { normalizeSessionId } from "../session-id.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const ActivityPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const ActivityQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.String.annotations({
      description: "Maximum number of activity samples to include.",
    }),
  ),
  sampleMs: Schema.optional(
    Schema.String.annotations({
      description: "Sampling window in milliseconds when comparing OpenCode surfaces.",
    }),
  ),
});

const ActivityPayload = Schema.Unknown;

const ActivityRouteError = Schema.Struct({
  _tag: Schema.Literal("ActivityRouteError"),
  error: Schema.String,
  status: Schema.Number,
});

type ActivityRouteError = Schema.Schema.Type<typeof ActivityRouteError>;

function activityError(error: string, status = 400): ActivityRouteError {
  return { _tag: "ActivityRouteError", error, status };
}

function requirePreviewEnabled(): Effect.Effect<void, ActivityRouteError> {
  return enableOpenCodeActivityPreview
    ? Effect.void
    : Effect.fail(activityError("OpenCode activity preview is disabled.", 404));
}

function requireSessionId(rawSessionId: string): Effect.Effect<string, ActivityRouteError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) return yield* Effect.fail(activityError("Invalid session id."));
    return sessionId;
  });
}

function intParam(
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(rawValue || fallback);
  return Number.isInteger(value) ? Math.max(min, Math.min(value, max)) : fallback;
}

export function getDebugActivityEffect(
  rawSessionId: string,
  rawLimit: string | undefined,
): Effect.Effect<unknown, ActivityRouteError> {
  return Effect.gen(function* () {
    yield* requirePreviewEnabled();
    const sessionId = yield* requireSessionId(rawSessionId);
    return yield* Effect.promise(() =>
      getOpenCodeActivityPreview(sessionId, intParam(rawLimit, 3, 1, 10)),
    );
  });
}

export function getSessionActivityEffect(
  rawSessionId: string,
): Effect.Effect<unknown, ActivityRouteError> {
  return Effect.gen(function* () {
    yield* requirePreviewEnabled();
    const sessionId = yield* requireSessionId(rawSessionId);
    return yield* Effect.promise(() => getOpenCodeActivitySnapshot(sessionId));
  });
}

export function getSessionRuntimeEffect(
  rawSessionId: string,
): Effect.Effect<unknown, ActivityRouteError> {
  return Effect.gen(function* () {
    yield* requirePreviewEnabled();
    const sessionId = yield* requireSessionId(rawSessionId);
    return { runtime: inspectOpenCodeActivityRuntime(sessionId) };
  });
}

export function compareSurfacesEffect({
  rawSessionId,
  rawLimit,
  rawSampleMs,
}: {
  rawSessionId: string;
  rawLimit: string | undefined;
  rawSampleMs: string | undefined;
}): Effect.Effect<unknown, ActivityRouteError> {
  return Effect.gen(function* () {
    yield* requirePreviewEnabled();
    const sessionId = yield* requireSessionId(rawSessionId);
    return yield* Effect.promise(() =>
      compareOpenCodeSurfaces(
        sessionId,
        intParam(rawLimit, 12, 1, 20),
        intParam(rawSampleMs, 1500, 250, 5000),
      ),
    );
  });
}

export const OpenCodeActivityPreviewGroup = HttpApiGroup.make("opencode-activity-preview")
  .add(
    HttpApiEndpoint.get("getDebugActivity", "/api/debug/opencode-activity/:sessionId")
      .setPath(ActivityPath)
      .setUrlParams(ActivityQuery)
      .annotateContext(
        openApiDocs(
          "Debug OpenCode activity",
          "Debug preview of OpenCode activity for a session when activity preview is enabled.",
        ),
      )
      .addSuccess(ActivityPayload)
      .addError(ActivityRouteError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.get("getSessionActivity", "/api/sessions/:sessionId/opencode-activity")
      .setPath(ActivityPath)
      .annotateContext(
        openApiDocs(
          "Get OpenCode activity",
          "Returns the OpenCode activity snapshot used by the session UI.",
        ),
      )
      .addSuccess(ActivityPayload)
      .addError(ActivityRouteError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.get("getSessionRuntime", "/api/debug/session-runtime/:sessionId")
      .setPath(ActivityPath)
      .annotateContext(
        openApiDocs(
          "Inspect session runtime",
          "Debug view of OpenCode runtime state for a session when activity preview is enabled.",
        ),
      )
      .addSuccess(ActivityPayload)
      .addError(ActivityRouteError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.get("compareSurfaces", "/api/debug/opencode-surfaces/:sessionId")
      .setPath(ActivityPath)
      .setUrlParams(ActivityQuery)
      .annotateContext(
        openApiDocs(
          "Compare OpenCode surfaces",
          "Debug comparison of OpenCode activity surfaces for a session over a sample window.",
        ),
      )
      .addSuccess(ActivityPayload)
      .addError(ActivityRouteError, { status: 400 }),
  );

export const OpenCodeActivityPreviewApi = HttpApi.make("opencode-activity-preview").add(
  OpenCodeActivityPreviewGroup,
);

export function buildOpenCodeActivityPreviewHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing OpenCodeActivityPreviewGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof OpenCodeActivityPreviewGroup, E, R>,
    "opencode-activity-preview",
    (handlers) =>
      handlers
        .handle("getDebugActivity", ({ path, urlParams }) =>
          getDebugActivityEffect(path.sessionId, urlParams.limit).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("getSessionActivity", ({ path }) =>
          getSessionActivityEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("getSessionRuntime", ({ path }) =>
          getSessionRuntimeEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("compareSurfaces", ({ path, urlParams }) =>
          compareSurfacesEffect({
            rawSessionId: path.sessionId,
            rawLimit: urlParams.limit,
            rawSampleMs: urlParams.sampleMs,
          }).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
