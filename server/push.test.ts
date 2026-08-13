import { describe, expect, it } from "vite-plus/test";
import { hasPushSubscription, listPushSubscriptions, savePushSubscription } from "./push.ts";

describe("push subscription persistence", () => {
  it("persists a subscription to the DB so it is found again", () => {
    const endpoint = `https://push.example/persist-${Date.now()}`;
    expect(hasPushSubscription(endpoint)).toBe(false);
    savePushSubscription({ endpoint, keys: { p256dh: "p256dh", auth: "auth" } });
    expect(hasPushSubscription(endpoint)).toBe(true);
  });

  it("upserts on re-subscribe: one row for the endpoint, with updated keys", () => {
    const endpoint = `https://push.example/upsert-${Date.now()}`;
    savePushSubscription({ endpoint, keys: { p256dh: "p1", auth: "a1" } });
    savePushSubscription({ endpoint, keys: { p256dh: "p2", auth: "a2" } });
    const matches = listPushSubscriptions().filter((s) => s.endpoint === endpoint);
    expect(matches).toEqual([{ endpoint, keys: { p256dh: "p2", auth: "a2" } }]);
  });
});
