import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";

const { teardownApi } = await import("../api.harness.ts");
const { workerVersion } = await import("../external-cli/worker-env.ts");
const { dispatchCursorDeliveryInternalRequest } = await import("./cursor-delivery-internal.ts");
const { listMessages } = await import("../messages.ts");
const { getSessionWorkStatus } = await import("../external-cli/session-work-status.ts");
const { isCursorSessionBusy } = await import("../cursor/delivery.ts");

const base = "http://127.0.0.1/api/internal/cursor-delivery";

function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-say-to-me-internal-token"] = token;
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

  it("posts stream progress without ending the turn or posting idle", async () => {
    const sessionId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";
    const response = await post(
      "/progress",
      { cursorSessionId: sessionId, text: "STARTING" },
      "test-internal-api-token",
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ ok: true });
    expect(listMessages(sessionId).at(-1)).toMatchObject({
      author: "agent",
      text: "STARTING",
      status: "received",
    });
    expect(isCursorSessionBusy(sessionId)).toBe(false);
    expect(await getSessionWorkStatus(sessionId)).toBe("idle");
  });

  it("does not treat an idle-notice progress payload as a spoken idle ding", async () => {
    const sessionId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";
    const before = listMessages(sessionId).length;
    const response = await post(
      "/progress",
      { cursorSessionId: sessionId, text: "Session is now idle." },
      "test-internal-api-token",
    );
    expect(response?.status).toBe(200);
    expect(listMessages(sessionId)).toHaveLength(before);
  });
});
