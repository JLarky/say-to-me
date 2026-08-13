import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { type TestServer, createApiMiddleware, listen } from "./api.harness.ts";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("say API: browser otel config", () => {
  let server: TestServer;
  let origin: string;
  const previousApiKey = process.env.HONEYCOMB_API_KEY;
  const previousOtelEnabled = process.env.OTEL_ENABLED;
  const previousBrowserEnabled = process.env.OTEL_BROWSER_ENABLED;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    process.env.HONEYCOMB_API_KEY = "test-key";
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_BROWSER_ENABLED;
  });

  afterAll(async () => {
    restoreEnv("HONEYCOMB_API_KEY", previousApiKey);
    restoreEnv("OTEL_ENABLED", previousOtelEnabled);
    restoreEnv("OTEL_BROWSER_ENABLED", previousBrowserEnabled);
  });

  it("vends browser tracing config through the API", async () => {
    process.env.OTEL_BROWSER_ENABLED = "true";

    try {
      const payload = await fetch(`${origin}/api/otel-config`).then((response) => response.json());

      expect(payload).toMatchObject({
        enabled: true,
        apiKey: "test-key",
      });
    } finally {
      server.close();
    }
  });
});
