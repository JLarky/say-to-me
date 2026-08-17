import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import type { DbSession } from "../db/schemas.ts";
import { broadcastQueue } from "../broadcast.ts";
import {
  addOpenCodeStatus,
  getOpenCodeSessionModel,
  listOpenCodeModels,
  setOpenCodeSessionModel,
} from "../opencode/client.ts";
import { readOpenCodeSessionVariant } from "../opencode/reasoning-effort.ts";
import { normalizeSessionId } from "../session-id.ts";
import {
  ensureSession,
  listSessions,
  updateSessionModelAndReasoningEffort,
  updateSessionOpenCodeModel,
} from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const OpenCodeModelPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const UpdateOpenCodeModelPayload = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
});

const OpenCodeModel = Schema.Struct({
  providerID: Schema.String,
  id: Schema.String,
  name: Schema.String,
  reasoningEfforts: Schema.Array(Schema.String),
});

const OpenCodeModelsListed = Schema.Struct({
  models: Schema.Array(OpenCodeModel),
});

const OpenCodeModelUpdated = Schema.Struct({
  session: Schema.Unknown,
});

const OpenCodeModelValidationError = Schema.Struct({
  _tag: Schema.Literal("OpenCodeModelValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const OpenCodeModelUpstreamError = Schema.Struct({
  _tag: Schema.Literal("OpenCodeModelUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

const OpenCodeModelSessionError = Schema.Struct({
  _tag: Schema.Literal("OpenCodeModelSessionError"),
  error: Schema.String,
  status: Schema.Number,
});

type OpenCodeModelsListed = Schema.Schema.Type<typeof OpenCodeModelsListed>;
type OpenCodeModelUpdated = Schema.Schema.Type<typeof OpenCodeModelUpdated>;
type OpenCodeModelValidationError = Schema.Schema.Type<typeof OpenCodeModelValidationError>;
type OpenCodeModelUpstreamError = Schema.Schema.Type<typeof OpenCodeModelUpstreamError>;
type OpenCodeModelSessionError = Schema.Schema.Type<typeof OpenCodeModelSessionError>;
type OpenCodeModel = Schema.Schema.Type<typeof OpenCodeModel>;

export type OpenCodeModelControlsService = {
  listModels: (directory?: string | null) => Effect.Effect<OpenCodeModel[], unknown>;
  setModel: (
    sessionId: string,
    providerID: string,
    modelID: string,
    directory?: string | null,
  ) => Effect.Effect<void, unknown>;
  getModel: (
    sessionId: string,
    directory?: string | null,
  ) => Effect.Effect<{ providerID: string; modelID: string; variant?: string | null }, unknown>;
  addStatus: (session: DbSession) => Effect.Effect<unknown>;
};

export type OpenCodeModelSessionService = {
  ensure: (sessionId: string) => Effect.Effect<DbSession>;
  listAll: () => Effect.Effect<DbSession[]>;
  updateModel: (sessionId: string, providerID: string, modelID: string) => Effect.Effect<void>;
  updateModelAndReasoningEffort: (
    sessionId: string,
    providerID: string,
    modelID: string,
    reasoningEffort: string | null,
  ) => Effect.Effect<void, OpenCodeModelSessionError>;
  broadcast: (sessionId: string) => Effect.Effect<void>;
};

export const OpenCodeModelControls = Context.GenericTag<OpenCodeModelControlsService>(
  "say-to-me/OpenCodeModelControls",
);

export const OpenCodeModelSession = Context.GenericTag<OpenCodeModelSessionService>(
  "say-to-me/OpenCodeModelSession",
);

export const OpenCodeModelControlsLive = Layer.succeed(OpenCodeModelControls, {
  listModels: (directory) =>
    Effect.tryPromise({
      try: () => listOpenCodeModels(directory),
      catch: (error) => error,
    }),
  setModel: (sessionId, providerID, modelID, directory) =>
    Effect.tryPromise({
      try: () => setOpenCodeSessionModel(sessionId, providerID, modelID, directory),
      catch: (error) => error,
    }),
  getModel: (sessionId, directory) =>
    Effect.tryPromise({
      try: () => getOpenCodeSessionModel(sessionId, directory),
      catch: (error) => error,
    }),
  addStatus: (session) => Effect.promise(() => addOpenCodeStatus(session)),
} satisfies OpenCodeModelControlsService);

export const OpenCodeModelSessionLive = Layer.succeed(OpenCodeModelSession, {
  ensure: (sessionId) => Effect.sync(() => ensureSession(sessionId)),
  listAll: () => Effect.sync(() => listSessions()),
  updateModel: (sessionId, providerID, modelID) =>
    Effect.sync(() => updateSessionOpenCodeModel(sessionId, providerID, modelID)),
  updateModelAndReasoningEffort: (sessionId, providerID, modelID, reasoningEffort) =>
    Effect.try({
      try: () =>
        updateSessionModelAndReasoningEffort(sessionId, providerID, modelID, reasoningEffort),
      catch: () => ({
        _tag: "OpenCodeModelSessionError" as const,
        error: "Unable to update OpenCode model and reasoning effort.",
        status: 500,
      }),
    }),
  broadcast: (sessionId) => Effect.sync(() => broadcastQueue(sessionId)),
} satisfies OpenCodeModelSessionService);

function requireSessionEffect(
  rawSessionId: string,
): Effect.Effect<DbSession, OpenCodeModelValidationError, OpenCodeModelSessionService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "OpenCodeModelValidationError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    const sessions = yield* OpenCodeModelSession;
    return yield* sessions.ensure(sessionId);
  });
}

export function listOpenCodeModelsEffect(
  rawSessionId: string,
): Effect.Effect<
  OpenCodeModelsListed,
  OpenCodeModelUpstreamError | OpenCodeModelValidationError,
  OpenCodeModelControlsService | OpenCodeModelSessionService
> {
  return Effect.gen(function* () {
    yield* requireSessionEffect(rawSessionId);
    const openCode = yield* OpenCodeModelControls;
    const session = yield* requireSessionEffect(rawSessionId);
    const models = yield* openCode.listModels(session.opencodeDirectory).pipe(
      Effect.mapError((error) => ({
        _tag: "OpenCodeModelUpstreamError" as const,
        error: error instanceof Error ? error.message : "Unable to list OpenCode models.",
        status: 502,
      })),
    );
    return { models };
  });
}

export function updateOpenCodeModelEffect(
  rawSessionId: string,
  providerID: string,
  modelID: string,
): Effect.Effect<
  OpenCodeModelUpdated,
  OpenCodeModelValidationError,
  OpenCodeModelControlsService | OpenCodeModelSessionService
> {
  return Effect.gen(function* () {
    const trimmedProviderID = providerID.trim();
    const trimmedModelID = modelID.trim();
    if (!trimmedProviderID || !trimmedModelID) {
      return yield* Effect.fail({
        _tag: "OpenCodeModelValidationError" as const,
        error: "Model is required.",
        status: 400,
      });
    }

    const session = yield* requireSessionEffect(rawSessionId);
    const sessions = yield* OpenCodeModelSession;
    const openCode = yield* OpenCodeModelControls;
    yield* sessions.updateModel(session.id, trimmedProviderID, trimmedModelID);
    yield* sessions.broadcast(session.id);
    const enrichedSession = yield* sessions
      .ensure(session.id)
      .pipe(Effect.flatMap(openCode.addStatus));
    return { session: enrichedSession };
  });
}

export function setOpenCodeModelEffect(
  rawSessionId: string,
  providerID: string,
  modelID: string,
): Effect.Effect<
  OpenCodeModelUpdated,
  OpenCodeModelSessionError | OpenCodeModelUpstreamError | OpenCodeModelValidationError,
  OpenCodeModelControlsService | OpenCodeModelSessionService
> {
  return Effect.gen(function* () {
    const trimmedProviderID = providerID.trim();
    const trimmedModelID = modelID.trim();
    if (!trimmedProviderID || !trimmedModelID) {
      return yield* Effect.fail({
        _tag: "OpenCodeModelValidationError" as const,
        error: "Model is required.",
        status: 400,
      });
    }

    const session = yield* requireSessionEffect(rawSessionId);
    const sessions = yield* OpenCodeModelSession;
    const openCode = yield* OpenCodeModelControls;
    yield* openCode
      .setModel(session.id, trimmedProviderID, trimmedModelID, session.opencodeDirectory)
      .pipe(
        Effect.mapError((error) => ({
          _tag: "OpenCodeModelUpstreamError" as const,
          error: error instanceof Error ? error.message : "Unable to set OpenCode model.",
          status: 502,
        })),
      );
    yield* sessions.updateModel(session.id, trimmedProviderID, trimmedModelID);
    yield* sessions.broadcast(session.id);
    const enrichedSession = yield* sessions
      .ensure(session.id)
      .pipe(Effect.flatMap(openCode.addStatus));
    return { session: enrichedSession };
  });
}

export function resetOpenCodeModelEffect(
  rawSessionId: string,
): Effect.Effect<
  OpenCodeModelUpdated,
  OpenCodeModelSessionError | OpenCodeModelUpstreamError | OpenCodeModelValidationError,
  OpenCodeModelControlsService | OpenCodeModelSessionService
> {
  return Effect.gen(function* () {
    const session = yield* requireSessionEffect(rawSessionId);
    const sessions = yield* OpenCodeModelSession;
    const openCode = yield* OpenCodeModelControls;
    const model = yield* openCode.getModel(session.id, session.opencodeDirectory).pipe(
      Effect.mapError((error) => ({
        _tag: "OpenCodeModelUpstreamError" as const,
        error: error instanceof Error ? error.message : "Unable to read OpenCode model.",
        status: 502,
      })),
    );
    yield* sessions.updateModelAndReasoningEffort(
      session.id,
      model.providerID,
      model.modelID,
      readOpenCodeSessionVariant(model.variant),
    );
    yield* sessions.broadcast(session.id);
    const enrichedSession = yield* sessions
      .ensure(session.id)
      .pipe(Effect.flatMap(openCode.addStatus));
    return { session: enrichedSession };
  });
}

const SetAllOpenCodeModelsUpdated = Schema.Struct({
  updatedCount: Schema.Number,
  failedCount: Schema.Number,
});

type SetAllOpenCodeModelsUpdated = Schema.Schema.Type<typeof SetAllOpenCodeModelsUpdated>;

export function setAllOpenCodeModelsEffect(
  providerID: string,
  modelID: string,
): Effect.Effect<
  SetAllOpenCodeModelsUpdated,
  OpenCodeModelUpstreamError | OpenCodeModelValidationError,
  OpenCodeModelControlsService | OpenCodeModelSessionService
> {
  return Effect.gen(function* () {
    const trimmedProviderID = providerID.trim();
    const trimmedModelID = modelID.trim();
    if (!trimmedProviderID || !trimmedModelID) {
      return yield* Effect.fail({
        _tag: "OpenCodeModelValidationError" as const,
        error: "Model is required.",
        status: 400,
      });
    }

    const sessions = yield* OpenCodeModelSession;
    const openCode = yield* OpenCodeModelControls;
    const allSessions = yield* sessions.listAll();
    let updatedCount = 0;
    let failedCount = 0;
    for (const session of allSessions) {
      const result = yield* openCode
        .setModel(session.id, trimmedProviderID, trimmedModelID, session.opencodeDirectory)
        .pipe(Effect.either);
      if (result._tag === "Left") {
        failedCount++;
        continue;
      }
      yield* sessions.updateModel(session.id, trimmedProviderID, trimmedModelID);
      yield* sessions.broadcast(session.id);
      updatedCount++;
    }
    return { updatedCount, failedCount };
  });
}

export const OpenCodeModelControlsGroup = HttpApiGroup.make("opencode-model-controls")
  .add(
    HttpApiEndpoint.get("listOpenCodeModels", "/api/sessions/:sessionId/opencode-models")
      .setPath(OpenCodeModelPath)
      .annotateContext(
        openApiDocs(
          "List OpenCode models",
          "Lists available OpenCode models and the current selection for the session.",
        ),
      )
      .addSuccess(OpenCodeModelsListed)
      .addError(OpenCodeModelValidationError, { status: 400 })
      .addError(OpenCodeModelUpstreamError, { status: 502 }),
  )
  .add(
    HttpApiEndpoint.patch("updateOpenCodeModel", "/api/sessions/:sessionId/opencode-model")
      .setPath(OpenCodeModelPath)
      .setPayload(UpdateOpenCodeModelPayload)
      .annotateContext(
        openApiDocs(
          "Update stored OpenCode model",
          "Updates the locally stored OpenCode provider/model preference for the session.",
        ),
      )
      .addSuccess(OpenCodeModelUpdated)
      .addError(OpenCodeModelValidationError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("setOpenCodeModel", "/api/sessions/:sessionId/opencode-model/set")
      .setPath(OpenCodeModelPath)
      .setPayload(UpdateOpenCodeModelPayload)
      .annotateContext(
        openApiDocs(
          "Set OpenCode model live",
          "Applies provider/model on the live OpenCode session and updates local storage.",
        ),
      )
      .addSuccess(OpenCodeModelUpdated)
      .addError(OpenCodeModelValidationError, { status: 400 })
      .addError(OpenCodeModelUpstreamError, { status: 502 }),
  )
  .add(
    HttpApiEndpoint.post("resetOpenCodeModel", "/api/sessions/:sessionId/opencode-model/reset")
      .setPath(OpenCodeModelPath)
      .annotateContext(
        openApiDocs(
          "Reset OpenCode model",
          "Clears the session model override and restores the default OpenCode model.",
        ),
      )
      .addSuccess(OpenCodeModelUpdated)
      .addError(OpenCodeModelValidationError, { status: 400 })
      .addError(OpenCodeModelUpstreamError, { status: 502 })
      .addError(OpenCodeModelSessionError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.post("setAllOpenCodeModels", "/api/opencode-model/set-all")
      .setPayload(UpdateOpenCodeModelPayload)
      .annotateContext(
        openApiDocs(
          "Set model on all sessions",
          "Applies the same OpenCode provider/model to every known OpenCode session.",
        ),
      )
      .addSuccess(SetAllOpenCodeModelsUpdated)
      .addError(OpenCodeModelValidationError, { status: 400 })
      .addError(OpenCodeModelUpstreamError, { status: 502 }),
  );

export const OpenCodeModelControlsApi = HttpApi.make("opencode-model-controls").add(
  OpenCodeModelControlsGroup,
);

export function buildOpenCodeModelControlsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing OpenCodeModelControlsGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof OpenCodeModelControlsGroup, E, R>,
    "opencode-model-controls",
    (handlers) =>
      handlers
        .handle("listOpenCodeModels", ({ path }) =>
          listOpenCodeModelsEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("updateOpenCodeModel", ({ path, payload }) =>
          updateOpenCodeModelEffect(path.sessionId, payload.providerID, payload.modelID).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("setOpenCodeModel", ({ path, payload }) =>
          setOpenCodeModelEffect(path.sessionId, payload.providerID, payload.modelID).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("resetOpenCodeModel", ({ path }) =>
          resetOpenCodeModelEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("setAllOpenCodeModels", ({ payload }) =>
          setAllOpenCodeModelsEffect(payload.providerID, payload.modelID).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        ),
  );
}
