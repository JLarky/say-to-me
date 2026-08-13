import { afterAll, describe, expect, it } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { createCapabilityHttpHandler } from "./test-capability-http.ts";
import type { PushService } from "./api-routes/push.ts";
import {
  Push,
  PushApi,
  buildPushHandlers,
  checkPushSubscriptionEffect,
  getVapidPublicKeyEffect,
  subscribeToPushEffect,
} from "./api-routes/push.ts";

process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.VAPID_SUBJECT = "";

function pushLayer(service: Partial<PushService> = {}) {
  const calls: string[] = [];
  const base: PushService = {
    publicKey: () =>
      Effect.sync(() => {
        calls.push("publicKey");
        return "test-public-key";
      }),
    subscribe: (subscription) =>
      Effect.sync(() => {
        calls.push(`subscribe:${subscription.endpoint}`);
      }),
    isSubscribed: (endpoint) =>
      Effect.sync(() => {
        calls.push(`isSubscribed:${endpoint}`);
        return endpoint === "https://push.example/known";
      }),
  };
  return { calls, layer: Layer.succeed(Push, { ...base, ...service }) };
}

describe("push route effects", () => {
  it("returns the configured VAPID public key through the injected service", async () => {
    const { calls, layer } = pushLayer();

    await expect(
      Effect.runPromise(getVapidPublicKeyEffect().pipe(Effect.provide(layer))),
    ).resolves.toEqual({
      publicKey: "test-public-key",
    });
    expect(calls).toEqual(["publicKey"]);
  });

  it("subscribes valid push payloads through the injected service", async () => {
    const { calls, layer } = pushLayer();

    await expect(
      Effect.runPromise(
        subscribeToPushEffect({
          endpoint: "https://push.example/sub",
          keys: { p256dh: "p256dh", auth: "auth" },
        }).pipe(Effect.provide(layer)),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["publicKey", "subscribe:https://push.example/sub"]);
  });

  it("validates subscription requests before storing them", async () => {
    const { calls, layer } = pushLayer();

    await expect(
      Effect.runPromiseExit(subscribeToPushEffect({ endpoint: 123 }).pipe(Effect.provide(layer))),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: {
          _tag: "PushValidationError",
          error: "Invalid subscription.",
          status: 400,
        },
      },
    });
    expect(calls).toEqual(["publicKey"]);
  });

  it("reports whether the server knows this browser's subscription", async () => {
    const { calls, layer } = pushLayer();

    await expect(
      Effect.runPromise(
        checkPushSubscriptionEffect({ endpoint: "https://push.example/known" }).pipe(
          Effect.provide(layer),
        ),
      ),
    ).resolves.toEqual({ subscribed: true });
    await expect(
      Effect.runPromise(
        checkPushSubscriptionEffect({ endpoint: "https://push.example/unknown" }).pipe(
          Effect.provide(layer),
        ),
      ),
    ).resolves.toEqual({ subscribed: false });
    expect(calls).toEqual([
      "isSubscribed:https://push.example/known",
      "isSubscribed:https://push.example/unknown",
    ]);
  });

  it("validates the subscription status endpoint", async () => {
    const { layer } = pushLayer();
    await expect(
      Effect.runPromiseExit(
        checkPushSubscriptionEffect({ endpoint: 123 }).pipe(Effect.provide(layer)),
      ),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "PushValidationError", status: 400 } },
    });
  });
});

describe("push HTTP contract", () => {
  const { layer } = pushLayer({
    publicKey: () => Effect.succeed(null),
  });
  const webHandler = createCapabilityHttpHandler({
    api: PushApi,
    handlers: buildPushHandlers(PushApi),
    services: layer,
  });

  afterAll(() => webHandler.dispose());

  it("registers push routes on the capability API", async () => {
    expect(
      await webHandler.handler(new Request("http://say.test/api/vapid-public-key")),
    ).not.toBeNull();
    expect(
      await webHandler.handler(
        new Request("http://say.test/api/push-subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            endpoint: "https://push.example/sub",
            keys: { p256dh: "p256dh", auth: "auth" },
          }),
        }),
      ),
    ).not.toBeNull();
    expect(
      await webHandler.handler(
        new Request("http://say.test/api/push-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: "https://push.example/known" }),
        }),
      ),
    ).not.toBeNull();
  });

  it("keeps the missing VAPID response shape at the capability boundary", async () => {
    const response = await webHandler.handler(new Request("http://say.test/api/vapid-public-key"));
    expect(response.status).toBe(404);
    // Effect public errors carry status on the Response; Express JSON fallback may
    // also mirror status into the body for host-mounted routes.
    await expect(response.json()).resolves.toEqual({
      error: "VAPID not configured.",
    });
  });
});
