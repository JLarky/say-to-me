import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { broadcastQueue } from "../broadcast.ts";
import { readCodexSessionModel } from "../codex/current-model.ts";
import {
  codexReasoningEfforts,
  readCodexGlobalReasoningEffort,
  readCodexSessionReasoningEffort,
  type CodexReasoningEffort,
} from "../codex/reasoning-effort.ts";
import type { DbSession } from "../db/schemas.ts";
import { detectSessionBackend, normalizeSessionId } from "../session-id.ts";
import { listOpenCodeModels, getOpenCodeSessionModel } from "../opencode/client.ts";
import { readGrokSessionModel } from "../grok/current-model.ts";
import {
  currentCliProviderModel,
  listCliProviderModels,
  type ProviderModelsService,
} from "@say-to-me/provider-models";
import {
  ensureSession,
  updateSessionModelAndReasoningEffort,
  updateSessionOpenCodeModel,
} from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const SessionModelsPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});
const ProviderModel = Schema.Struct({
  providerID: Schema.String,
  id: Schema.String,
  name: Schema.String,
});
const SessionModelsListed = Schema.Struct({
  models: Schema.Array(ProviderModel),
  providerName: Schema.String,
});
type SessionModelsListed = Schema.Schema.Type<typeof SessionModelsListed>;
const SessionModelsError = Schema.Struct({
  _tag: Schema.Literal("SessionModelsError"),
  error: Schema.String,
  status: Schema.Number,
});
type SessionModelsError = Schema.Schema.Type<typeof SessionModelsError>;
const SessionModel = Schema.Struct({ providerID: Schema.String, modelID: Schema.String });
const SessionModelResetSuccess = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  reasoningEffort: Schema.optional(Schema.NullOr(Schema.Literal(...codexReasoningEfforts))),
});
type SessionModelResetSuccess = Schema.Schema.Type<typeof SessionModelResetSuccess>;
const UpdateSessionModelPayload = SessionModel;
const SessionModelUpdated = SessionModel;
type SessionModelUpdated = Schema.Schema.Type<typeof SessionModelUpdated>;

export type SessionModelSessionService = {
  ensure: (sessionId: string) => Effect.Effect<DbSession, SessionModelsError>;
  updateModel: (
    sessionId: string,
    providerID: string,
    modelID: string,
  ) => Effect.Effect<void, SessionModelsError>;
  updateModelAndReasoningEffort: (
    sessionId: string,
    providerID: string,
    modelID: string,
    reasoningEffort: CodexReasoningEffort,
  ) => Effect.Effect<void, SessionModelsError>;
  broadcast: (sessionId: string) => Effect.Effect<void, SessionModelsError>;
};

export const SessionModelSession = Context.GenericTag<SessionModelSessionService>(
  "say-to-me/SessionModelSession",
);

export const SessionModelSessionLive = Layer.succeed(SessionModelSession, {
  ensure: (sessionId) =>
    Effect.try({
      try: () => ensureSession(sessionId),
      catch: () => ({
        _tag: "SessionModelsError" as const,
        error: "Unable to update session model.",
        status: 500,
      }),
    }),
  updateModel: (sessionId, providerID, modelID) =>
    Effect.try({
      try: () => updateSessionOpenCodeModel(sessionId, providerID, modelID),
      catch: () => ({
        _tag: "SessionModelsError" as const,
        error: "Unable to update session model.",
        status: 500,
      }),
    }),
  updateModelAndReasoningEffort: (sessionId, providerID, modelID, reasoningEffort) =>
    Effect.try({
      try: () =>
        updateSessionModelAndReasoningEffort(sessionId, providerID, modelID, reasoningEffort),
      catch: () => ({
        _tag: "SessionModelsError" as const,
        error: "Unable to update session model and reasoning effort.",
        status: 500,
      }),
    }),
  broadcast: (sessionId) =>
    Effect.try({
      try: () => broadcastQueue(sessionId),
      catch: () => ({
        _tag: "SessionModelsError" as const,
        error: "Unable to broadcast session model update.",
        status: 500,
      }),
    }),
} satisfies SessionModelSessionService);

export function resetSessionModelEffect(
  rawSessionId: string,
): Effect.Effect<
  SessionModelResetSuccess,
  SessionModelsError,
  SessionModelSessionService | ProviderModelsService
> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId)
      return yield* Effect.fail({
        _tag: "SessionModelsError" as const,
        error: "Missing session id.",
        status: 400,
      });
    const backend = detectSessionBackend(sessionId);
    let providerID: string;
    let modelID: string;
    let reasoningEffort: CodexReasoningEffort | undefined;
    if (backend === "opencode") {
      const openCodeModel = yield* Effect.tryPromise({
        try: () => getOpenCodeSessionModel(sessionId),
        catch: (error) => error,
      }).pipe(
        Effect.mapError(() => ({
          _tag: "SessionModelsError" as const,
          error: "Unable to read OpenCode model.",
          status: 502,
        })),
      );
      providerID = openCodeModel.providerID;
      modelID = openCodeModel.modelID;
    } else if (backend === "grok") {
      // Per-session Grok state (summary/signals), not global config — see model-reset spec.
      const grokModel = readGrokSessionModel(sessionId);
      if (!grokModel)
        return yield* Effect.fail({
          _tag: "SessionModelsError" as const,
          error: "Unable to read Grok session model for this session.",
          status: 502,
        });
      providerID = grokModel.providerID;
      modelID = grokModel.modelID;
    } else if (backend === "codex") {
      const codexModel =
        readCodexSessionModel(sessionId) ?? (yield* currentCliProviderModel(backend));
      if (!codexModel)
        return yield* Effect.fail({
          _tag: "SessionModelsError" as const,
          error: "Unable to read current model for " + backend + ".",
          status: 502,
        });
      providerID = codexModel.providerID;
      modelID = codexModel.modelID;
      reasoningEffort =
        readCodexSessionReasoningEffort(sessionId) ?? readCodexGlobalReasoningEffort() ?? undefined;
    } else {
      // Other CLI backends still use global default until session-scoped readers land.
      const cliModel = yield* currentCliProviderModel(backend);
      if (!cliModel)
        return yield* Effect.fail({
          _tag: "SessionModelsError" as const,
          error: "Unable to read current model for " + backend + ".",
          status: 502,
        });
      providerID = cliModel.providerID;
      modelID = cliModel.modelID;
    }
    const sessions = yield* SessionModelSession;
    yield* sessions.ensure(sessionId);
    if (backend === "codex" && reasoningEffort) {
      yield* sessions.updateModelAndReasoningEffort(
        sessionId,
        providerID,
        modelID,
        reasoningEffort,
      );
    } else {
      yield* sessions.updateModel(sessionId, providerID, modelID);
    }
    yield* sessions.broadcast(sessionId);
    if (backend === "codex" && reasoningEffort) {
      return { providerID, modelID, reasoningEffort };
    }
    return { providerID, modelID };
  });
}

export function updateSessionModelEffect(
  rawSessionId: string,
  providerID: string,
  modelID: string,
): Effect.Effect<SessionModelUpdated, SessionModelsError, SessionModelSessionService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    const trimmedProviderID = providerID.trim();
    const trimmedModelID = modelID.trim();
    if (!sessionId)
      return yield* Effect.fail({
        _tag: "SessionModelsError" as const,
        error: "Missing session id.",
        status: 400,
      });
    if (!trimmedProviderID || !trimmedModelID)
      return yield* Effect.fail({
        _tag: "SessionModelsError" as const,
        error: "Model is required.",
        status: 400,
      });
    const sessions = yield* SessionModelSession;
    yield* sessions.ensure(sessionId);
    yield* sessions.updateModel(sessionId, trimmedProviderID, trimmedModelID);
    yield* sessions.broadcast(sessionId);
    return { providerID: trimmedProviderID, modelID: trimmedModelID };
  });
}

function listSessionModelsEffect(
  rawSessionId: string,
): Effect.Effect<SessionModelsListed, SessionModelsError, ProviderModelsService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId)
      return yield* Effect.fail({
        _tag: "SessionModelsError" as const,
        error: "Missing session id.",
        status: 400,
      });
    const backend = detectSessionBackend(sessionId);
    if (backend === "opencode") {
      const models = yield* Effect.promise(() => listOpenCodeModels()).pipe(
        Effect.catchAll(() => Effect.succeed([])),
      );
      return { models, providerName: "opencode" };
    }
    if (backend === "grok" || backend === "codex" || backend === "claude" || backend === "cursor") {
      const models = (yield* listCliProviderModels(backend)) ?? [];
      return { models, providerName: backend };
    }
    return yield* Effect.fail({
      _tag: "SessionModelsError" as const,
      error: "Unsupported session backend: " + backend,
      status: 400,
    });
  });
}

export const SessionModelsGroup = HttpApiGroup.make("session-models")
  .add(
    HttpApiEndpoint.get("listSessionModels", "/api/sessions/:sessionId/models")
      .setPath(SessionModelsPath)
      .annotateContext(
        openApiDocs(
          "List session models",
          "Lists models available for the session backend and the current selection.",
        ),
      )
      .addSuccess(SessionModelsListed)
      .addError(SessionModelsError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.patch("updateSessionModel", "/api/sessions/:sessionId/model")
      .setPath(SessionModelsPath)
      .setPayload(UpdateSessionModelPayload)
      .annotateContext(
        openApiDocs(
          "Update session model",
          "Sets the preferred model for the session based on its backend provider.",
        ),
      )
      .addSuccess(SessionModelUpdated)
      .addError(SessionModelsError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("resetSessionModel", "/api/sessions/:sessionId/model/reset")
      .setPath(SessionModelsPath)
      .annotateContext(
        openApiDocs(
          "Reset session model",
          "Clears the session model override and restores the backend default model.",
        ),
      )
      .addSuccess(SessionModelResetSuccess)
      .addError(SessionModelsError, { status: 502 }),
  );

export function buildSessionModelsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof SessionModelsGroup, E, R>,
    "session-models",
    (handlers) =>
      handlers
        .handle("listSessionModels", ({ path }) =>
          listSessionModelsEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("updateSessionModel", ({ path, payload }) =>
          updateSessionModelEffect(path.sessionId, payload.providerID, payload.modelID).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("resetSessionModel", ({ path }) =>
          resetSessionModelEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
