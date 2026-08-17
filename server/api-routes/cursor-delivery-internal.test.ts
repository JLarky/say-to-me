import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import type { JsonValue } from "@say-to-me/runtime-validation";

process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";

const { teardownApi } = await import("../api.harness.ts");
const { workerVersion } = await import("../external-cli/worker-env.ts");
const { dispatchCursorDeliveryInternalRequest } = await import("./cursor-delivery-internal.ts");

const base = "http://127.0.0.1/api/internal/cursor-delivery";

function post(path: string, body: JsonValue, token?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("x-say-to-me-internal-token", token);
  return dispatchCursorDeliveryInternalRequest(
    new Request(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) }),
  );
}

describe("Cursor delivery internal API auth", () => {
  afterAll(async () => {
    await teardownApi();
  });

  beforeEach(() => {
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
  });

  it("rejects requests without a token", async () => {
    const response = await post("/claim", { workerId: "w1" });
    expect(response?.status).toBe(401);
  });

  it("rejects requests with the wrong token", async () => {
    const response = await post("/claim", { workerId: "w1" }, "wrong-token");
    expect(response?.status).toBe(401);
  });

  it("accepts requests with the correct token", async () => {
    const response = await post(
      "/claim",
      { workerId: "w1", workerVersion: workerVersion("CURSOR") },
      "test-internal-api-token",
    );
    expect(response?.status).toBe(200);
  });

  it("rejects idle workers when their version does not match", async () => {
    const response = await post(
      "/claim",
      { workerId: "w1", workerVersion: workerVersion("CURSOR") - 1 },
      "test-internal-api-token",
    );
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      error: `Stale Cursor delivery worker. Expected ${workerVersion("CURSOR")}.`,
    });
  });
});
