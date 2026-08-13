import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { queuePayload } from "../broadcast.ts";
import { enableOpenCodeActivityPreview, opencodeDirectory } from "../config.ts";
import { browserOtelConfig } from "../otel-config.ts";
import { serverCapabilities } from "../capabilities.ts";
import { normalizeSessionId } from "../session-id.ts";
import { getSession } from "../sessions.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const SessionPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const QueuePayload = Schema.Unknown;
const CapabilitiesPayload = Schema.Unknown;
const OtelConfigPayload = Schema.Unknown;
const VersionPayload = Schema.Struct({
  version: Schema.Number,
});

const QueueRouteError = Schema.Struct({
  _tag: Schema.Literal("QueueRouteError"),
  error: Schema.String,
  status: Schema.Number,
});

type QueueRouteError = Schema.Schema.Type<typeof QueueRouteError>;

export function getSessionQueueEffect(
  rawSessionId: string,
): Effect.Effect<unknown, QueueRouteError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "QueueRouteError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    if (!getSession(sessionId)) {
      return yield* Effect.fail({
        _tag: "QueueRouteError" as const,
        error: "Session not found.",
        status: 404,
      });
    }
    return yield* Effect.promise(() => queuePayload(sessionId, { forceRefresh: true }));
  });
}

export const getQueueEffect: Effect.Effect<unknown> = Effect.promise(() =>
  queuePayload("default", { forceRefresh: true }),
);

export const getCapabilitiesEffect: Effect.Effect<unknown> = Effect.sync(() =>
  serverCapabilities({ enableOpenCodeActivityPreview, opencodeDirectory }),
);

export const getOtelConfigEffect: Effect.Effect<unknown> = Effect.sync(() => browserOtelConfig());

export const getVersionEffect: Effect.Effect<{ version: number }> = Effect.succeed({ version: 1 });

export const QueueGroup = HttpApiGroup.make("queue")
  .add(
    HttpApiEndpoint.get("getSessionQueue", "/api/sessions/:sessionId/messages")
      .setPath(SessionPath)
      .annotateContext(
        openApiDocs(
          "Get session message queue",
          "Returns the message queue payload for a specific session, forcing a fresh refresh.",
        ),
      )
      .addSuccess(QueuePayload)
      .addError(QueueRouteError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.get("getQueue", "/api/queue")
      .annotateContext(
        openApiDocs(
          "Get default queue",
          "Returns the message queue payload for the default session.",
        ),
      )
      .addSuccess(QueuePayload),
  )
  .add(
    HttpApiEndpoint.get("getCapabilities", "/api/capabilities")
      .annotateContext(
        openApiDocs(
          "Get server capabilities",
          "Lists feature flags and server capabilities available to the client.",
        ),
      )
      .addSuccess(CapabilitiesPayload),
  )
  .add(
    HttpApiEndpoint.get("getOtelConfig", "/api/otel-config")
      .annotateContext(
        openApiDocs(
          "Get browser OTEL config",
          "Returns OpenTelemetry browser exporter configuration for client-side tracing.",
        ),
      )
      .addSuccess(OtelConfigPayload),
  )
  .add(
    HttpApiEndpoint.get("getVersion", "/api/version")
      .annotateContext(
        openApiDocs(
          "Get API version",
          "Returns the queue API version number used by clients for compatibility checks.",
        ),
      )
      .addSuccess(VersionPayload),
  );

export const QueueApi = HttpApi.make("queue").add(QueueGroup);

export function buildQueueHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof QueueGroup, E, R>,
    "queue",
    (handlers) =>
      handlers
        .handle("getSessionQueue", ({ path }) =>
          getSessionQueueEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("getQueue", () => getQueueEffect)
        .handle("getCapabilities", () => getCapabilitiesEffect)
        .handle("getOtelConfig", () => getOtelConfigEffect)
        .handle("getVersion", () => getVersionEffect),
  );
}
