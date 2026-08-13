import { afterAll, describe, expect, it } from "vite-plus/test";
import webpush from "web-push";

const vapidKeys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("./api.harness.ts");
const { hasPushSubscription } = await import("./push.ts");

describe("say API: configured push routes", () => {
  afterAll(async () => {
    await teardownApi();
  });

  it("stores push subscriptions through the mounted Effect HttpApi route", async () => {
    const { origin, server } = await listen(createApiMiddleware());
    try {
      const subscription = {
        endpoint: "https://push.example/subscription",
        keys: { p256dh: "p256dh", auth: "auth" },
      };

      const response = await fetch(`${origin}/api/push-subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(hasPushSubscription(subscription.endpoint)).toBe(true);
    } finally {
      await closeTestServer(server);
    }
  });
});
