import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Context, Effect, Layer, Schema } from "effect";
import { drizzleSqlite, getDbInitError } from "../db/index.ts";
import { openApiDocs } from "./openapi-docs.ts";

export type HealthStatus = { ok: true } | { ok: false; error: string };

export type HealthService = {
  check: () => Effect.Effect<HealthStatus>;
};

export const Health = Context.GenericTag<HealthService>("say-to-me/Health");

export const HealthLive = Layer.succeed(Health, {
  check: () => {
    const initError = getDbInitError();
    if (initError) {
      return Effect.succeed({ ok: false, error: initError.message } satisfies HealthStatus);
    }
    return Effect.try({
      try: () => drizzleSqlite.prepare("SELECT 1").get(),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(
      Effect.match({
        onSuccess: () => ({ ok: true }) satisfies HealthStatus,
        onFailure: (error) => ({ ok: false, error: error.message }) satisfies HealthStatus,
      }),
    );
  },
} satisfies HealthService);

const HealthPayload = Schema.Unknown;

export function getHealthEffect(): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HealthService
> {
  return Effect.gen(function* () {
    const status = yield* (yield* Health).check();
    return HttpServerResponse.unsafeJson(status, { status: status.ok ? 200 : 503 });
  });
}

export const HealthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("getHealth", "/api/health")
    .annotateContext(
      openApiDocs(
        "Check service health",
        "Returns database connectivity. Responds 200 when healthy and 503 when the DB is unavailable.",
      ),
    )
    .addSuccess(HealthPayload),
);

export const HealthApi = HttpApi.make("health").add(HealthGroup);

export function buildHealthHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof HealthGroup, E, R>,
    "health",
    (handlers) => handlers.handle("getHealth", () => getHealthEffect()),
  );
}
