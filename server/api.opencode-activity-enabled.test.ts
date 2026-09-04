import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer } from "node:http";

const { createApiMiddleware, teardownApi } = await import("./api.harness.ts");

type TestServer = ReturnType<typeof createServer>;

function listen(
  app: ReturnType<typeof createApiMiddleware>,
): Promise<{ server: TestServer; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      // SAFETY: address() is called inside the listen() callback, so the server
      // is already bound to a TCP port; it always returns AddressInfo here, never
      // a string or null.
      const address = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe("say API: OpenCode activity preview enabled by default", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("reports the enabled capability and registers activity routes", async () => {
    try {
      const capabilities = await fetch(`${origin}/api/capabilities`).then((response) =>
        response.json(),
      );
      const activity = await fetch(
        `${origin}/api/debug/opencode-activity/ses_ac200cc51875N4p2jr0Gx62tmv`,
      );

      expect(capabilities.openCodeActivityPreview).toBe(true);
      expect(activity.status).not.toBe(404);
    } finally {
      server.close();
    }
  });
});
