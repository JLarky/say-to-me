import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";

const { teardownApi } = await import("../api.harness.ts");
const { workerVersion } = await import("../external-cli/worker-env.ts");
const { dispatchClaudeDeliveryInternalRequest } = await import("./claude-delivery-internal.ts");

const base = "http://127.0.0.1/api/internal/claude-delivery";

function post(path: string, body: unknown, token?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("x-say-to-me-internal-token", token);
  return dispatchClaudeDeliveryInternalRequest(
    new Request(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) }),
  );
}

describe("Claude delivery internal API auth", () => {
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
      { workerId: "w1", workerVersion: workerVersion("CLAUDE") },
      "test-internal-api-token",
    );
    expect(response?.status).toBe(200);
  });

  it("rejects idle workers when their version does not match", async () => {
    const response = await post(
      "/claim",
      { workerId: "w1", workerVersion: workerVersion("CLAUDE") - 1 },
      "test-internal-api-token",
    );
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      error: `Stale Claude delivery worker. Expected ${workerVersion("CLAUDE")}.`,
    });
  });
});
