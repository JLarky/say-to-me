import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import {
  codexReasoningEfforts,
  type CodexReasoningEffort,
} from "../../src/codex-reasoning-effort.ts";
import { createVoiceSessionRecord } from "../create-voice-session.ts";
import { createCliSessionRecord } from "../external-cli/create-cli-session.ts";
import type { ExternalCliBackend } from "../external-cli/session-backend.ts";
import { workspacePathStatus } from "../workspace.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const CreateExternalCliSessionPayload = Schema.Struct({
  provider: Schema.Literal("claude", "codex", "cursor", "grok"),
  path: Schema.String.annotations({
    description: "Absolute workspace directory for the new CLI session.",
  }),
  modelID: Schema.String,
  reasoningEffort: Schema.optional(Schema.Literal(...codexReasoningEfforts)),
});

const CreateVoiceSessionPayload = Schema.Struct({
  provider: Schema.Literal("voice"),
  name: Schema.optional(
    Schema.String.annotations({
      description: "Optional display name; slugified into vo_<slug>. Generated when omitted.",
    }),
  ),
});

const CreateCliSessionPayload = Schema.Union(
  CreateExternalCliSessionPayload,
  CreateVoiceSessionPayload,
);

const CliSessionCreated = Schema.Struct({
  session: Schema.Unknown,
});

const CliSessionError = Schema.Struct({
  _tag: Schema.Literal("CliSessionError"),
  error: Schema.String,
  status: Schema.Number,
});

type CliSessionCreated = Schema.Schema.Type<typeof CliSessionCreated>;
type CliSessionError = Schema.Schema.Type<typeof CliSessionError>;
type CreateCliSessionPayload = Schema.Schema.Type<typeof CreateCliSessionPayload>;

function cliSessionError(error: string, status: number): CliSessionError {
  return { _tag: "CliSessionError", error, status };
}

export function createCliSessionEffect(
  provider: ExternalCliBackend,
  workspacePath: string,
  modelID: string,
  reasoningEffort?: CodexReasoningEffort,
): Effect.Effect<CliSessionCreated, CliSessionError> {
  return Effect.gen(function* () {
    const trimmedModelID = modelID.trim();
    if (!trimmedModelID) {
      return yield* Effect.fail(cliSessionError("Model is required.", 400));
    }
    const status = workspacePathStatus(workspacePath);
    if (!status.ok) {
      return yield* Effect.fail(cliSessionError(status.error, 400));
    }
    if (!status.exists || !status.isDirectory || !status.writable) {
      return yield* Effect.fail(cliSessionError("Folder must exist and be writable.", 400));
    }
    const session = yield* Effect.tryPromise({
      try: () => createCliSessionRecord(provider, status.path, trimmedModelID, {}, reasoningEffort),
      catch: (cause) =>
        cliSessionError(
          cause instanceof Error && cause.message.trim()
            ? cause.message
            : "Unable to create CLI session.",
          500,
        ),
    });
    return { session };
  });
}

export function createVoiceSessionEffect(
  name?: string,
): Effect.Effect<CliSessionCreated, CliSessionError> {
  return Effect.try({
    try: () => ({ session: createVoiceSessionRecord(name) }),
    catch: (cause) =>
      cliSessionError(
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : "Unable to create voice session.",
        500,
      ),
  });
}

function createSessionFromPayload(
  payload: CreateCliSessionPayload,
): Effect.Effect<CliSessionCreated, CliSessionError> {
  if (payload.provider === "voice") {
    return createVoiceSessionEffect(payload.name);
  }
  return createCliSessionEffect(
    payload.provider,
    payload.path,
    payload.modelID,
    payload.reasoningEffort,
  );
}

export const CliSessionsGroup = HttpApiGroup.make("cli-sessions").add(
  HttpApiEndpoint.post("createCliSession", "/api/cli-sessions")
    .setPayload(CreateCliSessionPayload)
    .annotateContext(
      openApiDocs(
        "Create CLI or voice session",
        "Creates a local CLI-backed session (Claude, Codex, Cursor, Grok) or a voice-only vo_<slug> session.",
      ),
    )
    .addSuccess(CliSessionCreated, { status: 201 })
    .addError(CliSessionError, { status: 400 }),
);

export function buildCliSessionsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof CliSessionsGroup, E, R>,
    "cli-sessions",
    (handlers) =>
      handlers.handle("createCliSession", ({ payload }) =>
        createSessionFromPayload(payload).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
