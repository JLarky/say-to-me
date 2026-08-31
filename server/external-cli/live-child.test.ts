import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";

process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { clearLiveChild, hasLiveChild, registerLiveChild, resetLiveChildrenForTests } =
  await import("./live-child.ts");

describe("live child register must land on the API map", () => {
  afterEach(() => {
    resetLiveChildrenForTests();
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("adds locally when INTERNAL_URL is unset", async () => {
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    const sessionId = `cur_${randomUUID()}`;
    await registerLiveChild(sessionId, 1);
    expect(hasLiveChild(sessionId)).toBe(true);
  });

  it("lands on the API map over INTERNAL_URL even when VITEST is true", async () => {
    expect(process.env.VITEST).toBe("true");
    const started = await listen(createApiMiddleware());
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    const sessionId = `cur_${randomUUID()}`;
    try {
      await registerLiveChild(sessionId, 4242);
      expect(hasLiveChild(sessionId)).toBe(true);
    } finally {
      await closeTestServer(started.server);
    }
  });

  it("fails if register never reaches the API map", async () => {
    const fake = createServer((_req, res) => {
      res.writeHead(500);
      res.end("no");
    });
    await new Promise<void>((resolve) => {
      fake.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = fake.address();
    if (addr === null || typeof addr === "string") {
      throw new Error("fake register server did not bind a TCP port");
    }
    process.env.SAY_TO_ME_INTERNAL_URL = `http://127.0.0.1:${addr.port}`;
    const sessionId = `cur_${randomUUID()}`;
    try {
      await expect(registerLiveChild(sessionId, 7)).rejects.toThrow(/did not land/);
      expect(hasLiveChild(sessionId)).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        fake.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("clear stays best-effort when the API is down", async () => {
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    const sessionId = `cur_${randomUUID()}`;
    await registerLiveChild(sessionId, 3);
    process.env.SAY_TO_ME_INTERNAL_URL = "http://127.0.0.1:1";
    expect(() => clearLiveChild(sessionId, 3)).not.toThrow();
    expect(hasLiveChild(sessionId)).toBe(false);
  });
});
