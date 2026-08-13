import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { type as arktype } from "arktype";
import { Context, Effect, Layer, Schema } from "effect";
import { SessionState } from "../../src/types.ts";
import { broadcastQueue, broadcastSessions, sessionsPayload } from "../broadcast.ts";
import type { DbSession } from "../db/schemas.ts";
import { addOpenCodeStatus, updateOpenCodeTitle } from "../opencode/client.ts";

import { normalizeSessionId } from "../session-id.ts";
import { importSessionIfKnown } from "../session-import.ts";
import { getOrganizePathForSession } from "../session-folders.ts";
import {
  deleteSession,
  deleteSessionMessages,
  ensureSession,
  listSessions,
  setSessionCwd,
  updateSessionAlias,
  updateSessionState,
} from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { resolveDashboardPlacement } from "../dashboard-placement.ts";
import { toSpacesError } from "../spaces.ts";
import { openApiDocs } from "./openapi-docs.ts";

const SessionsQuery = Schema.Struct({
  includeCachedStatus: Schema.optional(
    Schema.String.annotations({
      description:
        'Pass "1" to include cached OpenCode/provider status on each session in the list.',
    }),
  ),
  jarvisOverviewDetails: Schema.optional(
    Schema.String.annotations({
      description: 'Pass "1" to include expanded Jarvis overview details for Jarvis sessions.',
    }),
  ),
});

const SessionsListed = Schema.Struct({
  sessions: Schema.Array(Schema.Unknown),
  presence: Schema.Array(Schema.Unknown),
});

const SessionPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const DashboardPlacementQuery = Schema.Struct({
  targetSpaceId: Schema.optional(Schema.String),
});

const SessionImportQuery = Schema.Struct({
  instanceId: Schema.optional(Schema.String),
});

const DashboardPlacementBlockReason = Schema.Literal(
  "no-spaces",
  "cwd-deleted",
  "non-git",
  "owner-archived",
  "context-unresolved",
  "main-clone-ambiguous",
);

const DashboardRepairState = Schema.Literal(
  "owner-missing",
  "owner-archived",
  "repo-detached",
  "worktree-detached",
  "context-unresolved",
  "main-clone-ambiguous",
);

const DiscoveredCheckoutDescriptor = Schema.Struct({
  checkoutPath: Schema.String,
  branch: Schema.String,
  isMain: Schema.Boolean,
  repositoryIdentity: Schema.String,
  repositoryRootPath: Schema.String,
  repositoryName: Schema.String,
});

const DashboardPlacementResult = Schema.Struct({
  sessionId: Schema.String,
  title: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  ownerSpaceId: Schema.NullOr(Schema.String),
  ownerSpaceName: Schema.NullOr(Schema.String),
  ownerArchived: Schema.Boolean,
  repositoryId: Schema.NullOr(Schema.String),
  worktreeId: Schema.NullOr(Schema.String),
  isMainCheckout: Schema.NullOr(Schema.Boolean),
  placementPossible: Schema.Boolean,
  placementBlockReason: Schema.NullOr(DashboardPlacementBlockReason),
  repairState: Schema.NullOr(DashboardRepairState),
  canonicalDashboardPath: Schema.NullOr(Schema.String),
  needsChooser: Schema.Boolean,
  chooserMode: Schema.NullOr(Schema.Literal("claim", "move")),
  discovered: Schema.NullOr(DiscoveredCheckoutDescriptor),
  preview: Schema.Struct({
    targetSpaceId: Schema.NullOr(Schema.String),
    wouldAttachRepository: Schema.Boolean,
    wouldAttachWorktree: Schema.Boolean,
    warnings: Schema.Array(Schema.String),
  }),
});

/** Public error body — matches `publicRouteErrorResponse` (`{ error }` only). */
const DashboardPlacementError = Schema.Struct({
  error: Schema.String,
});

const UpdateSessionPayload = Schema.Unknown;
const UpdateOpenCodeTitlePayload = Schema.Unknown;

const SessionUpdated = Schema.Struct({
  session: Schema.Unknown,
});

const SessionDeleted = Schema.Struct({
  ok: Schema.Literal(true),
});

const SessionValidationError = Schema.Struct({
  _tag: Schema.Literal("SessionValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const SessionUpstreamError = Schema.Struct({
  _tag: Schema.Literal("SessionUpstreamError"),
  error: Schema.String,
  status: Schema.Number,
});

type SessionsListed = Schema.Schema.Type<typeof SessionsListed>;
type SessionUpdated = Schema.Schema.Type<typeof SessionUpdated>;
type SessionDeleted = Schema.Schema.Type<typeof SessionDeleted>;
type SessionValidationError = Schema.Schema.Type<typeof SessionValidationError>;
type SessionUpstreamError = Schema.Schema.Type<typeof SessionUpstreamError>;

type OpenCodeTitleResult = { ok: true } | { ok: false; status: number; error: string };

export type SessionMutationService = {
  ensure: (sessionId: string) => Effect.Effect<DbSession>;
  updateState: (sessionId: string, state: string) => Effect.Effect<void>;
  setCwd: (sessionId: string, cwd: string | null) => Effect.Effect<void>;
  setAlias: (
    sessionId: string,
    alias: string | null,
  ) => Effect.Effect<{ ok: true } | { ok: false; error: string }>;
  updateOpenCodeTitle: (sessionId: string, title: string) => Effect.Effect<OpenCodeTitleResult>;
  deleteMessages: (sessionId: string) => Effect.Effect<void>;
  deleteSession: (sessionId: string) => Effect.Effect<void>;
  broadcastQueue: (sessionId: string) => Effect.Effect<void>;
  broadcastSessions: () => Effect.Effect<void>;
  addStatus: (session: DbSession) => Effect.Effect<unknown>;
};

export const SessionMutations = Context.GenericTag<SessionMutationService>(
  "say-to-me/SessionMutations",
);

export const SessionMutationsLive = Layer.succeed(SessionMutations, {
  ensure: (sessionId) => Effect.sync(() => ensureSession(sessionId)),
  updateState: (sessionId, state) => Effect.sync(() => updateSessionState(sessionId, state)),
  setCwd: (sessionId, cwd) => Effect.sync(() => setSessionCwd(sessionId, cwd)),
  setAlias: (sessionId, alias) => Effect.sync(() => updateSessionAlias(sessionId, alias)),
  updateOpenCodeTitle: (sessionId, title) =>
    Effect.promise(() => updateOpenCodeTitle(sessionId, title)),
  deleteMessages: (sessionId) => Effect.sync(() => deleteSessionMessages(sessionId)),
  deleteSession: (sessionId) => Effect.sync(() => deleteSession(sessionId)),
  broadcastQueue: (sessionId) => Effect.sync(() => broadcastQueue(sessionId)),
  broadcastSessions: () => Effect.sync(() => broadcastSessions()),
  addStatus: (session) =>
    Effect.promise(async () => ({
      ...(await addOpenCodeStatus(session)),
      organizePath: getOrganizePathForSession(session.id),
    })),
} satisfies SessionMutationService);

export function listSessionsEffect({
  includeCachedStatus = false,
  includeJarvisOverviewDetails = false,
} = {}): Effect.Effect<SessionsListed> {
  listSessions({ includeCachedStatus });
  return Effect.succeed(sessionsPayload({ includeCachedStatus, includeJarvisOverviewDetails }));
}

export function updateSessionEffect(
  rawSessionId: string,
  payload: unknown,
): Effect.Effect<SessionUpdated, SessionValidationError, SessionMutationService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    const record =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const hasState = "state" in record;
    const hasCwd = "cwd" in record;
    const hasAlias = "alias" in record;
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "SessionValidationError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    if (!hasState && !hasCwd && !hasAlias) {
      return yield* Effect.fail({
        _tag: "SessionValidationError" as const,
        error: "Session update must include state, cwd, or alias.",
        status: 400,
      });
    }

    const state = hasState ? SessionState(record.state) : null;
    if (state instanceof arktype.errors) {
      return yield* Effect.fail({
        _tag: "SessionValidationError" as const,
        error: "Invalid session state.",
        status: 400,
      });
    }

    let cwd: string | null = null;
    if (hasCwd) {
      const raw = typeof record.cwd === "string" ? record.cwd.trim() : "";
      if (!raw) {
        return yield* Effect.fail({
          _tag: "SessionValidationError" as const,
          error: "Working directory is required.",
          status: 400,
        });
      }
      cwd = raw;
    }

    let alias: string | null | undefined;
    if (hasAlias) {
      const raw = record.alias;
      if (raw === null) {
        alias = null;
      } else if (typeof raw === "string") {
        alias = raw.trim() || null;
      } else {
        return yield* Effect.fail({
          _tag: "SessionValidationError" as const,
          error: "Invalid session alias.",
          status: 400,
        });
      }
    }

    const sessions = yield* SessionMutations;
    yield* sessions.ensure(sessionId);
    if (state !== null) yield* sessions.updateState(sessionId, state);
    if (cwd !== null) yield* sessions.setCwd(sessionId, cwd);
    if (alias !== undefined) {
      const updated = yield* sessions.setAlias(sessionId, alias);
      if (!updated.ok) {
        return yield* Effect.fail({
          _tag: "SessionValidationError" as const,
          error: updated.error,
          status: 400,
        });
      }
    }
    yield* sessions.broadcastQueue(sessionId);
    yield* sessions.broadcastSessions();
    const session = yield* sessions.ensure(sessionId).pipe(Effect.flatMap(sessions.addStatus));
    return { session };
  });
}

export function updateOpenCodeTitleEffect(
  rawSessionId: string,
  payload: unknown,
): Effect.Effect<
  SessionUpdated,
  SessionUpstreamError | SessionValidationError,
  SessionMutationService
> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    const title =
      payload && typeof payload === "object" && "title" in payload
        ? typeof (payload as { title?: unknown }).title === "string"
          ? (payload as { title: string }).title.trim()
          : ""
        : "";
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "SessionValidationError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    if (!title) {
      return yield* Effect.fail({
        _tag: "SessionValidationError" as const,
        error: "Title is required.",
        status: 400,
      });
    }

    const sessions = yield* SessionMutations;
    yield* sessions.ensure(sessionId);
    const updated = yield* sessions.updateOpenCodeTitle(sessionId, title);
    if (!updated.ok) {
      if (updated.status === 400) {
        return yield* Effect.fail({
          _tag: "SessionValidationError" as const,
          error: updated.error,
          status: updated.status,
        });
      }
      return yield* Effect.fail({
        _tag: "SessionUpstreamError" as const,
        error: updated.error,
        status: updated.status,
      });
    }
    yield* sessions.broadcastQueue(sessionId);
    const session = yield* sessions.ensure(sessionId).pipe(Effect.flatMap(sessions.addStatus));
    return { session };
  });
}

// Explicit, deliberate import: the only way (option 3) a session id that was
// never created through this app's own flows gets a row here. Verifies against
// the backend's own source of truth first, so a typo'd/unknown id still 404s.
export function importSessionEffect(
  rawSessionId: string,
  instanceId?: string,
): Effect.Effect<
  SessionUpdated,
  SessionValidationError | SessionUpstreamError,
  SessionMutationService
> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "SessionValidationError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }

    const imported = yield* importSessionIfKnown(sessionId, instanceId).pipe(
      Effect.catchTag("ImportNotFoundError", () =>
        Effect.fail({
          _tag: "SessionValidationError" as const,
          error: "No matching session was found for this id.",
          status: 404,
        }),
      ),
      Effect.catchTag("ImportUpstreamError", ({ error }) =>
        Effect.fail({
          _tag: "SessionUpstreamError" as const,
          error,
          status: 502,
        }),
      ),
    );

    const sessions = yield* SessionMutations;
    yield* sessions.broadcastQueue(sessionId);
    yield* sessions.broadcastSessions();
    const session = yield* sessions.addStatus(imported);
    return { session };
  });
}

export function deleteSessionEffect(
  rawSessionId: string,
): Effect.Effect<SessionDeleted, SessionValidationError, SessionMutationService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "SessionValidationError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    if (sessionId === "default") {
      return yield* Effect.fail({
        _tag: "SessionValidationError" as const,
        error: "Cannot delete default session.",
        status: 400,
      });
    }

    const sessions = yield* SessionMutations;
    yield* sessions.deleteMessages(sessionId);
    yield* sessions.deleteSession(sessionId);
    // Session-list only: broadcastQueue would ensureSession and recreate the row.
    yield* sessions.broadcastSessions();
    return { ok: true };
  });
}

export const SessionsGroup = HttpApiGroup.make("sessions")
  .add(
    HttpApiEndpoint.get("listSessions", "/api/sessions")
      .setUrlParams(SessionsQuery)
      .annotateContext(
        openApiDocs(
          "List all sessions",
          "Returns known sessions and presence. Optional query flags add cached provider status and Jarvis overview details.",
        ),
      )
      .addSuccess(SessionsListed),
  )
  .add(
    HttpApiEndpoint.patch("updateSession", "/api/sessions/:sessionId")
      .setPath(SessionPath)
      .setPayload(UpdateSessionPayload)
      .annotateContext(
        openApiDocs(
          "Update session metadata",
          "Patches session fields such as alias, state, or working directory for the given session id.",
        ),
      )
      .addSuccess(SessionUpdated)
      .addError(SessionValidationError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.patch("updateOpenCodeTitle", "/api/sessions/:sessionId/opencode-title")
      .setPath(SessionPath)
      .setPayload(UpdateOpenCodeTitlePayload)
      .annotateContext(
        openApiDocs(
          "Update OpenCode session title",
          "Sets the remote OpenCode session title and returns the refreshed local session record.",
        ),
      )
      .addSuccess(SessionUpdated)
      .addError(SessionValidationError, { status: 400 })
      .addError(SessionUpstreamError, { status: 502 }),
  )
  .add(
    HttpApiEndpoint.del("deleteSession", "/api/sessions/:sessionId")
      .setPath(SessionPath)
      .annotateContext(
        openApiDocs(
          "Delete a session",
          "Deletes the session and its messages. The default session cannot be deleted.",
        ),
      )
      .addSuccess(SessionDeleted)
      .addError(SessionValidationError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("importSession", "/api/sessions/:sessionId/import")
      .setPath(SessionPath)
      .setUrlParams(SessionImportQuery)
      .annotateContext(
        openApiDocs(
          "Import known session",
          "Imports a previously known external or OpenCode session into the local session list.",
        ),
      )
      .addSuccess(SessionUpdated)
      .addError(SessionValidationError, { status: 400 })
      .addError(SessionUpstreamError, { status: 502 }),
  )
  .add(
    HttpApiEndpoint.get("dashboardPlacement", "/api/sessions/:sessionId/dashboard-placement")
      .setPath(SessionPath)
      .setUrlParams(DashboardPlacementQuery)
      .annotateContext(
        openApiDocs(
          "Resolve dashboard placement",
          "Returns where a session belongs on the Spaces dashboard (owner space, repo/worktree, chooser mode).",
        ),
      )
      .addSuccess(DashboardPlacementResult)
      .addError(DashboardPlacementError, { status: 404 })
      .addError(DashboardPlacementError, { status: 400 }),
  );

export const SessionsApi = HttpApi.make("sessions").add(SessionsGroup);

export function buildSessionsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof SessionsGroup, E, R>,
    "sessions",
    (handlers) =>
      handlers
        .handle("listSessions", ({ urlParams }) =>
          listSessionsEffect({
            includeCachedStatus: urlParams.includeCachedStatus === "1",
            includeJarvisOverviewDetails: urlParams.jarvisOverviewDetails === "1",
          }),
        )
        .handle("updateSession", ({ path, payload }) =>
          updateSessionEffect(path.sessionId, payload).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("updateOpenCodeTitle", ({ path, payload }) =>
          updateOpenCodeTitleEffect(path.sessionId, payload).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("deleteSession", ({ path }) =>
          deleteSessionEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("importSession", ({ path, urlParams }) =>
          importSessionEffect(path.sessionId, urlParams.instanceId).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("dashboardPlacement", ({ path, urlParams }) =>
          Effect.tryPromise({
            try: () => resolveDashboardPlacement(path.sessionId, urlParams.targetSpaceId),
            catch: toSpacesError,
          }).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
