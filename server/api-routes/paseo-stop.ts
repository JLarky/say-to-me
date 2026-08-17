import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { queuePayload } from "../broadcast.ts";
import { detectSessionBackend, normalizeSessionId } from "../session-id.ts";
import { PaseoSessionLayers } from "../session-services/provider-layers.ts";
import { SessionStopper } from "../session-services/interfaces.ts";
import { openApiDocs } from "./openapi-docs.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";

const SessionPath = Schema.Struct({ sessionId: Schema.String });
const StopError = Schema.Struct({
  _tag: Schema.Literal("StopPaseoError"),
  error: Schema.String,
  status: Schema.Number,
});
type StopResult = { ok: true } | { ok: false; status: number; error: string };
type StopPaseoRouteError = Schema.Schema.Type<typeof StopError>;

type StopPaseoService = {
  stopSession: (sessionId: string) => Effect.Effect<StopResult>;
  queuePayload: (sessionId: string) => Effect.Effect<Awaited<ReturnType<typeof queuePayload>>>;
};

export const StopPaseo = Context.GenericTag<StopPaseoService>("say-to-me/StopPaseo");
export const StopPaseoLive = Layer.succeed(StopPaseo, {
  stopSession: (sessionId) =>
    SessionStopper.pipe(
      Effect.provide(PaseoSessionLayers),
      Effect.flatMap((service) => service.stop(sessionId)),
      Effect.catchAll((error) =>
        Effect.succeed({ ok: false as const, status: 500, error: error.message }),
      ),
    ),
  queuePayload: (sessionId) => Effect.promise(() => queuePayload(sessionId)),
} satisfies StopPaseoService);

export function stopPaseoSessionProgram(
  rawSessionId: string,
): Effect.Effect<unknown, StopPaseoRouteError, StopPaseoService> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId || detectSessionBackend(sessionId) !== "paseo") {
      return yield* Effect.fail({
        _tag: "StopPaseoError" as const,
        error: "Invalid Paseo session id.",
        status: 400,
      });
    }
    const paseo = yield* StopPaseo;
    const stopped = yield* paseo.stopSession(sessionId);
    if (!stopped.ok) {
      return yield* Effect.fail({
        _tag: "StopPaseoError" as const,
        error: stopped.error,
        status: stopped.status,
      });
    }
    return { ok: true, ...(yield* paseo.queuePayload(sessionId)) };
  });
}

export const PaseoStopGroup = HttpApiGroup.make("paseo-stop").add(
  HttpApiEndpoint.post("stopPaseoSession", "/api/sessions/:sessionId/stop-paseo")
    .setPath(SessionPath)
    .annotateContext(
      openApiDocs(
        "Stop Paseo agent session",
        "Interrupts a running Paseo agent session. Paseo Chat rooms are not supported.",
      ),
    )
    .addSuccess(Schema.Unknown)
    .addError(StopError, { status: 400 })
    .addError(StopError, { status: 404 })
    .addError(StopError, { status: 500 }),
);

export function buildPaseoStopHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing PaseoStopGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof PaseoStopGroup, E, R>,
    "paseo-stop",
    (handlers) =>
      handlers.handle("stopPaseoSession", ({ path }) =>
        stopPaseoSessionProgram(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
