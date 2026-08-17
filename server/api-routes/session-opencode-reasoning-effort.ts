import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { broadcastQueue } from "../broadcast.ts";
import type { DbSession } from "../db/schemas.ts";
import {
  defaultOpenCodeReasoningEfforts,
  isOpenCodeReasoningEffort,
} from "../../src/opencode-reasoning-effort.ts";
import {
  getOpenCodeSessionModel,
  listOpenCodeModels,
  setOpenCodeSessionModel,
} from "../opencode/client.ts";
import { readOpenCodeSessionVariant } from "../opencode/reasoning-effort.ts";
import { detectSessionBackend, normalizeSessionId } from "../session-id.ts";
import { ensureSession, getSession, updateSessionReasoningEffort } from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const SessionOpenCodeReasoningEffortPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});
const SessionOpenCodeReasoningEffort = Schema.Struct({
  available: Schema.Array(Schema.String),
  selected: Schema.NullOr(Schema.String),
  current: Schema.NullOr(Schema.String),
});
type SessionOpenCodeReasoningEffort = Schema.Schema.Type<typeof SessionOpenCodeReasoningEffort>;

const UpdateSessionOpenCodeReasoningEffortPayload = Schema.Struct({ effort: Schema.String });
const SessionOpenCodeReasoningEffortError = Schema.Struct({
  _tag: Schema.Literal("SessionOpenCodeReasoningEffortError"),
  error: Schema.String,
  status: Schema.Number,
});
type SessionOpenCodeReasoningEffortError = Schema.Schema.Type<
  typeof SessionOpenCodeReasoningEffortError
>;

export type SessionOpenCodeReasoningEffortService = {
  ensure: (sessionId: string) => Effect.Effect<DbSession, SessionOpenCodeReasoningEffortError>;
  getSession: (
    sessionId: string,
  ) => Effect.Effect<DbSession | null, SessionOpenCodeReasoningEffortError>;
  update: (
    sessionId: string,
    effort: string | null,
  ) => Effect.Effect<void, SessionOpenCodeReasoningEffortError>;
  broadcast: (sessionId: string) => Effect.Effect<void, SessionOpenCodeReasoningEffortError>;
  listModels: (
    directory?: string | null,
  ) => Effect.Effect<
    Array<{ providerID: string; id: string; reasoningEfforts: string[] }>,
    SessionOpenCodeReasoningEffortError
  >;
  getModel: (
    sessionId: string,
    directory?: string | null,
  ) => Effect.Effect<
    { providerID: string; modelID: string; variant: string | null },
    SessionOpenCodeReasoningEffortError
  >;
  setModel: (
    sessionId: string,
    providerID: string,
    modelID: string,
    directory: string | null | undefined,
    variant: string | null,
  ) => Effect.Effect<void, SessionOpenCodeReasoningEffortError>;
};

export const SessionOpenCodeReasoningEffortService =
  Context.GenericTag<SessionOpenCodeReasoningEffortService>(
    "say-to-me/SessionOpenCodeReasoningEffortService",
  );

function dbError(error: string): SessionOpenCodeReasoningEffortError {
  return { _tag: "SessionOpenCodeReasoningEffortError", error, status: 500 };
}

export const SessionOpenCodeReasoningEffortServiceLive = Layer.succeed(
  SessionOpenCodeReasoningEffortService,
  {
    ensure: (sessionId) =>
      Effect.try({
        try: () => ensureSession(sessionId),
        catch: () => dbError("Unable to ensure session."),
      }),
    getSession: (sessionId) =>
      Effect.try({
        try: () => getSession(sessionId),
        catch: () => dbError("Unable to read session."),
      }),
    update: (sessionId, effort) =>
      Effect.try({
        try: () => updateSessionReasoningEffort(sessionId, effort),
        catch: () => dbError("Unable to update OpenCode reasoning effort."),
      }),
    broadcast: (sessionId) =>
      Effect.try({
        try: () => broadcastQueue(sessionId),
        catch: () => dbError("Unable to broadcast OpenCode reasoning effort update."),
      }),
    listModels: (directory) =>
      Effect.tryPromise({
        try: () => listOpenCodeModels(directory),
        catch: () => dbError("Unable to list OpenCode models."),
      }).pipe(
        Effect.map((models) =>
          models.map(({ providerID, id, reasoningEfforts }) => ({
            providerID,
            id,
            reasoningEfforts,
          })),
        ),
      ),
    getModel: (sessionId, directory) =>
      Effect.tryPromise({
        try: () => getOpenCodeSessionModel(sessionId, directory),
        catch: () => dbError("Unable to read OpenCode session model."),
      }),
    setModel: (sessionId, providerID, modelID, directory, variant) =>
      Effect.tryPromise({
        try: () => setOpenCodeSessionModel(sessionId, providerID, modelID, directory, variant),
        catch: () => dbError("Unable to update OpenCode session model."),
      }),
  } satisfies SessionOpenCodeReasoningEffortService,
);

function validateOpenCodeSession(
  rawSessionId: string,
): { sessionId: string } | SessionOpenCodeReasoningEffortError {
  const sessionId = normalizeSessionId(rawSessionId);
  if (!sessionId) {
    return {
      _tag: "SessionOpenCodeReasoningEffortError",
      error: "Missing session id.",
      status: 400,
    };
  }
  if (detectSessionBackend(sessionId) !== "opencode") {
    return {
      _tag: "SessionOpenCodeReasoningEffortError",
      error: "Reasoning effort is only available for OpenCode sessions.",
      status: 400,
    };
  }
  return { sessionId };
}

function availableForSession(
  session: DbSession | null,
  models: Array<{ providerID: string; id: string; reasoningEfforts: string[] }>,
): string[] {
  const providerID = session?.opencodeSelectedModelProvider;
  const modelID = session?.opencodeSelectedModel;
  const model = models.find(
    (candidate) => candidate.providerID === providerID && candidate.id === modelID,
  );
  const available = model?.reasoningEfforts.filter(isOpenCodeReasoningEffort) ?? [];
  return available.length > 0 ? [...new Set(available)] : [...defaultOpenCodeReasoningEfforts];
}

function buildResponse(
  session: DbSession | null,
  available: string[],
  openCodeVariant: string | null,
): SessionOpenCodeReasoningEffort {
  const selected = isOpenCodeReasoningEffort(session?.reasoningEffort)
    ? session.reasoningEffort.trim()
    : null;
  return { available, selected, current: openCodeVariant };
}

export function getSessionOpenCodeReasoningEffortEffect(
  rawSessionId: string,
): Effect.Effect<
  SessionOpenCodeReasoningEffort,
  SessionOpenCodeReasoningEffortError,
  SessionOpenCodeReasoningEffortService
> {
  const validated = validateOpenCodeSession(rawSessionId);
  if ("error" in validated) return Effect.fail(validated);
  return Effect.gen(function* () {
    const service = yield* SessionOpenCodeReasoningEffortService;
    const session = yield* service.getSession(validated.sessionId);
    const available = yield* service.listModels(session?.opencodeDirectory);
    const openCodeModel = yield* service.getModel(validated.sessionId, session?.opencodeDirectory);
    const openCodeVariant = readOpenCodeSessionVariant(openCodeModel.variant);
    return buildResponse(session, availableForSession(session, available), openCodeVariant);
  });
}

export function updateSessionOpenCodeReasoningEffortEffect(
  rawSessionId: string,
  effort: string,
): Effect.Effect<
  SessionOpenCodeReasoningEffort,
  SessionOpenCodeReasoningEffortError,
  SessionOpenCodeReasoningEffortService
> {
  const validated = validateOpenCodeSession(rawSessionId);
  if ("error" in validated) return Effect.fail(validated);
  const trimmedEffort = effort.trim();
  return Effect.gen(function* () {
    const service = yield* SessionOpenCodeReasoningEffortService;
    const session = yield* service.ensure(validated.sessionId);
    const models = yield* service.listModels(session.opencodeDirectory);
    const available = availableForSession(session, models);
    if (trimmedEffort && !available.includes(trimmedEffort)) {
      return yield* Effect.fail({
        _tag: "SessionOpenCodeReasoningEffortError" as const,
        error: "Unsupported OpenCode reasoning effort.",
        status: 400,
      });
    }
    const openCodeModel = yield* service.getModel(validated.sessionId, session.opencodeDirectory);
    yield* service.setModel(
      validated.sessionId,
      openCodeModel.providerID,
      openCodeModel.modelID,
      session.opencodeDirectory,
      trimmedEffort || null,
    );
    const appliedEffort = trimmedEffort || null;
    yield* service.update(validated.sessionId, appliedEffort);
    yield* service.broadcast(validated.sessionId);
    return buildResponse({ ...session, reasoningEffort: appliedEffort }, available, appliedEffort);
  });
}

export const SessionOpenCodeReasoningEffortGroup = HttpApiGroup.make(
  "session-opencode-reasoning-effort",
)
  .add(
    HttpApiEndpoint.get(
      "getSessionOpenCodeReasoningEffort",
      "/api/sessions/:sessionId/opencode-reasoning-effort",
    )
      .setPath(SessionOpenCodeReasoningEffortPath)
      .annotateContext(
        openApiDocs(
          "Get OpenCode reasoning effort",
          "Returns available and selected OpenCode reasoning-effort variants for the session model.",
        ),
      )
      .addSuccess(SessionOpenCodeReasoningEffort)
      .addError(SessionOpenCodeReasoningEffortError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.patch(
      "updateSessionOpenCodeReasoningEffort",
      "/api/sessions/:sessionId/opencode-reasoning-effort",
    )
      .setPath(SessionOpenCodeReasoningEffortPath)
      .setPayload(UpdateSessionOpenCodeReasoningEffortPayload)
      .annotateContext(
        openApiDocs(
          "Update OpenCode reasoning effort",
          "Applies an OpenCode reasoning-effort variant on the live session and stores the selection.",
        ),
      )
      .addSuccess(SessionOpenCodeReasoningEffort)
      .addError(SessionOpenCodeReasoningEffortError, { status: 400 }),
  );

export function buildSessionOpenCodeReasoningEffortHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing SessionOpenCodeReasoningEffortGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof SessionOpenCodeReasoningEffortGroup, E, R>,
    "session-opencode-reasoning-effort",
    (handlers) =>
      handlers
        .handle("getSessionOpenCodeReasoningEffort", ({ path }) =>
          getSessionOpenCodeReasoningEffortEffect(path.sessionId).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("updateSessionOpenCodeReasoningEffort", ({ path, payload }) =>
          updateSessionOpenCodeReasoningEffortEffect(path.sessionId, payload.effort).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        ),
  );
}
