import { describe, expect, it } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { dispatchEffectApiRequest } from "./api-routes/effect-api.ts";
import {
  Health,
  HealthLive,
  getHealthEffect,
  type HealthService,
  type HealthStatus,
} from "./api-routes/health.ts";

function healthLayer(status: HealthStatus) {
  return Layer.succeed(Health, { check: () => Effect.succeed(status) } satisfies HealthService);
}

describe("health route", () => {
  it("returns 200 when healthy", async () => {
    const response = await Effect.runPromise(
      getHealthEffect().pipe(Effect.provide(healthLayer({ ok: true }))),
    );
    expect(response.status).toBe(200);
  });

  it("returns 503 when DB init failed", async () => {
    const response = await Effect.runPromise(
      getHealthEffect().pipe(Effect.provide(healthLayer({ ok: false, error: "boom" }))),
    );
    expect(response.status).toBe(503);
  });

  it("HealthLive reports ok against a working database", async () => {
    const status = await Effect.runPromise(
      Effect.flatMap(Health, (health) => health.check()).pipe(Effect.provide(HealthLive)),
    );
    expect(status).toEqual({ ok: true });
  });

  it("registers the health route in the Effect route table", async () => {
    expect(
      await dispatchEffectApiRequest(new Request("http://say.local/api/health")),
    ).not.toBeNull();
  });
});
