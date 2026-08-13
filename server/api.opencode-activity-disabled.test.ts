import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer } from "node:http";

process.env.SAY_TO_ME_OPENCODE_ACTIVITY_PREVIEW = "false";

const { createApiMiddleware, teardownApi } = await import("./api.harness.ts");

type TestServer = ReturnType<typeof createServer>;

function listen(
  app: ReturnType<typeof createApiMiddleware>,
): Promise<{ server: TestServer; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe("say API: OpenCode activity preview disabled", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("reports the disabled capability and does not register activity routes", async () => {
    try {
      const capabilities = await fetch(`${origin}/api/capabilities`).then((response) =>
        response.json(),
      );
      const activity = await fetch(
        `${origin}/api/debug/opencode-activity/ses_0ba6105a4711HC2q3wT2EPhEW9`,
      );

      expect(capabilities.openCodeActivityPreview).toBe(false);
      expect(activity.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
