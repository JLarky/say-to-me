import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { broadcastQueue } from "../broadcast.ts";
import {
  codexReasoningEfforts,
  readCodexGlobalReasoningEffort,
  readCodexSessionReasoningEffort,
  type CodexReasoningEffort,
} from "../codex/reasoning-effort.ts";
import type { DbSession } from "../db/schemas.ts";
import { detectSessionBackend, normalizeSessionId } from "../session-id.ts";
import { ensureSession, getSession, updateSessionReasoningEffort } from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";
import { isCodexReasoningEffort } from "../../src/codex-reasoning-effort.ts";

const SessionReasoningEffortPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});
const CodexReasoningEffortSchema = Schema.Literal(...codexReasoningEfforts);
const SessionReasoningEffort = Schema.Struct({
  available: Schema.Array(CodexReasoningEffortSchema),
  selected: Schema.NullOr(CodexReasoningEffortSchema),
  current: Schema.NullOr(CodexReasoningEffortSchema),
});
type SessionReasoningEffort = Schema.Schema.Type<typeof SessionReasoningEffort>;
const UpdateSessionReasoningEffortPayload = Schema.Struct({
  effort: CodexReasoningEffortSchema,
});
const SessionReasoningEffortError = Schema.Struct({
  _tag: Schema.Literal("SessionReasoningEffortError"),
  error: Schema.String,
  status: Schema.Number,
});
type SessionReasoningEffortError = Schema.Schema.Type<typeof SessionReasoningEffortError>;

export type SessionReasoningEffortService = {
  ensure: (sessionId: string) => Effect.Effect<DbSession, SessionReasoningEffortError>;
  update: (
    sessionId: string,
    effort: CodexReasoningEffort,
  ) => Effect.Effect<void, SessionReasoningEffortError>;
  readSessionEffort: (
    sessionId: string,
  ) => Effect.Effect<CodexReasoningEffort | null, SessionReasoningEffortError>;
  readGlobalEffort: () => Effect.Effect<CodexReasoningEffort | null, SessionReasoningEffortError>;
  getSession: (sessionId: string) => Effect.Effect<DbSession | null, SessionReasoningEffortError>;
  broadcast: (sessionId: string) => Effect.Effect<void, SessionReasoningEffortError>;
};

export const SessionReasoningEffortService = Context.GenericTag<SessionReasoningEffortService>(
  "say-to-me/SessionReasoningEffortService",
);

function dbError(error: string): SessionReasoningEffortError {
  return { _tag: "SessionReasoningEffortError", error, status: 500 };
}

export const SessionReasoningEffortServiceLive = Layer.succeed(SessionReasoningEffortService, {
  ensure: (sessionId) =>
    Effect.try({
      try: () => ensureSession(sessionId),
      catch: () => dbError("Unable to ensure session."),
    }),
  update: (sessionId, effort) =>
    Effect.try({
      try: () => updateSessionReasoningEffort(sessionId, effort),
      catch: () => dbError("Unable to update session reasoning effort."),
    }),
  readSessionEffort: (sessionId) =>
    Effect.try({
      try: () => readCodexSessionReasoningEffort(sessionId),
      catch: () => dbError("Unable to read Codex session reasoning effort."),
    }),
  readGlobalEffort: () =>
    Effect.try({
      try: () => readCodexGlobalReasoningEffort(),
      catch: () => dbError("Unable to read Codex global reasoning effort."),
    }),
  getSession: (sessionId) =>
    Effect.try({
      try: () => getSession(sessionId),
      catch: () => dbError("Unable to read session."),
    }),
  broadcast: (sessionId) =>
    Effect.try({
      try: () => broadcastQueue(sessionId),
      catch: () => dbError("Unable to broadcast session reasoning effort update."),
    }),
} satisfies SessionReasoningEffortService);

function validateCodexSession(
  rawSessionId: string,
): { sessionId: string } | SessionReasoningEffortError {
  const sessionId = normalizeSessionId(rawSessionId);
  if (!sessionId)
    return { _tag: "SessionReasoningEffortError", error: "Missing session id.", status: 400 };
  if (detectSessionBackend(sessionId) !== "codex") {
    return {
      _tag: "SessionReasoningEffortError",
      error: "Reasoning effort is only available for Codex sessions.",
      status: 400,
    };
  }
  return { sessionId };
}

function buildResponse(
  session: DbSession | null,
  sessionEffort: CodexReasoningEffort | null,
  globalEffort: CodexReasoningEffort | null,
): SessionReasoningEffort {
  const sessionEffortValue = session?.reasoningEffort;
  const selected = isCodexReasoningEffort(sessionEffortValue) ? sessionEffortValue : null;
  const current = selected ?? sessionEffort ?? globalEffort;
  return { available: [...codexReasoningEfforts], selected, current };
}

export function getSessionReasoningEffortEffect(
  rawSessionId: string,
): Effect.Effect<
  SessionReasoningEffort,
  SessionReasoningEffortError,
  SessionReasoningEffortService
> {
  const validated = validateCodexSession(rawSessionId);
  if ("error" in validated) return Effect.fail(validated);
  return Effect.gen(function* () {
    const service = yield* SessionReasoningEffortService;
    const session = yield* service.getSession(validated.sessionId);
    const sessionEffort = yield* service.readSessionEffort(validated.sessionId);
    const globalEffort = yield* service.readGlobalEffort();
    return buildResponse(session, sessionEffort, globalEffort);
  });
}

export function updateSessionReasoningEffortEffect(
  rawSessionId: string,
  effort: CodexReasoningEffort,
): Effect.Effect<
  SessionReasoningEffort,
  SessionReasoningEffortError,
  SessionReasoningEffortService
> {
  const validated = validateCodexSession(rawSessionId);
  if ("error" in validated) return Effect.fail(validated);
  return Effect.gen(function* () {
    const service = yield* SessionReasoningEffortService;
    const session = yield* service.ensure(validated.sessionId);
    yield* service.update(validated.sessionId, effort);
    const sessionEffort = yield* service.readSessionEffort(validated.sessionId);
    const globalEffort = yield* service.readGlobalEffort();
    yield* service.broadcast(validated.sessionId);
    return buildResponse({ ...session, reasoningEffort: effort }, sessionEffort, globalEffort);
  });
}

export function resetSessionReasoningEffortEffect(
  rawSessionId: string,
): Effect.Effect<
  SessionReasoningEffort,
  SessionReasoningEffortError,
  SessionReasoningEffortService
> {
  const validated = validateCodexSession(rawSessionId);
  if ("error" in validated) return Effect.fail(validated);
  return Effect.gen(function* () {
    const service = yield* SessionReasoningEffortService;
    const sessionEffort = yield* service.readSessionEffort(validated.sessionId);
    const globalEffort = yield* service.readGlobalEffort();
    const effort = sessionEffort ?? globalEffort;
    if (!effort) {
      return yield* Effect.fail({
        _tag: "SessionReasoningEffortError" as const,
        error: "Unable to read Codex reasoning effort for this session.",
        status: 502,
      });
    }
    yield* service.ensure(validated.sessionId);
    yield* service.update(validated.sessionId, effort);
    yield* service.broadcast(validated.sessionId);
    return { available: [...codexReasoningEfforts], selected: effort, current: effort };
  });
}

export const SessionReasoningEffortGroup = HttpApiGroup.make("session-reasoning-effort")
  .add(
    HttpApiEndpoint.get("getSessionReasoningEffort", "/api/sessions/:sessionId/reasoning-effort")
      .setPath(SessionReasoningEffortPath)
      .annotateContext(
        openApiDocs(
          "Get reasoning effort",
          "Returns available and selected Codex-style reasoning effort for the session.",
        ),
      )
      .addSuccess(SessionReasoningEffort)
      .addError(SessionReasoningEffortError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.patch(
      "updateSessionReasoningEffort",
      "/api/sessions/:sessionId/reasoning-effort",
    )
      .setPath(SessionReasoningEffortPath)
      .setPayload(UpdateSessionReasoningEffortPayload)
      .annotateContext(
        openApiDocs(
          "Update reasoning effort",
          "Sets the Codex-style reasoning effort level for the session.",
        ),
      )
      .addSuccess(SessionReasoningEffort)
      .addError(SessionReasoningEffortError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post(
      "resetSessionReasoningEffort",
      "/api/sessions/:sessionId/reasoning-effort/reset",
    )
      .setPath(SessionReasoningEffortPath)
      .annotateContext(
        openApiDocs(
          "Reset reasoning effort",
          "Re-reads and restores reasoning effort from the upstream Codex session state.",
        ),
      )
      .addSuccess(SessionReasoningEffort)
      .addError(SessionReasoningEffortError, { status: 502 }),
  );

export function buildSessionReasoningEffortHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing SessionReasoningEffortGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof SessionReasoningEffortGroup, E, R>,
    "session-reasoning-effort",
    (handlers) =>
      handlers
        .handle("getSessionReasoningEffort", ({ path }) =>
          getSessionReasoningEffortEffect(path.sessionId).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("updateSessionReasoningEffort", ({ path, payload }) =>
          updateSessionReasoningEffortEffect(path.sessionId, payload.effort).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("resetSessionReasoningEffort", ({ path }) =>
          resetSessionReasoningEffortEffect(path.sessionId).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        ),
  );
}
