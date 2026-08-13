import { afterAll, describe, expect, it } from "vite-plus/test";

const { createTestRequest, expectHandledResponse, teardownApi } = await import("../api.harness.ts");
const { dispatchEffectApiRequest } = await import("./effect-api.ts");

describe("merged Effect API dispatch", () => {
  afterAll(async () => {
    await teardownApi();
  });

  it("returns a Response for a known route and null for an unmatched API path", async () => {
    const queueRequest = createTestRequest("/api/queue");
    const queue = expectHandledResponse(await dispatchEffectApiRequest(queueRequest), queueRequest);
    expect(queue.status).toBe(200);
    expect(await queue.json()).toHaveProperty("messages");

    const missing = await dispatchEffectApiRequest(createTestRequest("/api/definitely-missing"));
    expect(missing).toBeNull();
  });

  it("returns null for SSE-only paths", async () => {
    const sse = await dispatchEffectApiRequest(createTestRequest("/api/sessions/default/events"));
    expect(sse).toBeNull();
  });
});
