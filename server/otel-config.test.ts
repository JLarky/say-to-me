import { describe, expect, it } from "vite-plus/test";
import { browserOtelConfig } from "./otel-config.ts";

describe("browserOtelConfig", () => {
  it("keeps browser tracing disabled unless explicitly enabled", () => {
    expect(browserOtelConfig({ HONEYCOMB_API_KEY: "test-key" })).toEqual({ enabled: false });
    expect(
      browserOtelConfig({
        HONEYCOMB_API_KEY: "test-key",
        OTEL_BROWSER_ENABLED: "true",
        OTEL_ENABLED: "false",
      }),
    ).toEqual({ enabled: false });
  });

  it("enables browser tracing with the configured browser service name", () => {
    expect(
      browserOtelConfig({ HONEYCOMB_API_KEY: "test-key", OTEL_BROWSER_ENABLED: "true" }),
    ).toEqual({ enabled: true, apiKey: "test-key", serviceName: "say-to-me-browser" });
    expect(
      browserOtelConfig({
        HONEYCOMB_API_KEY: "test-key",
        OTEL_BROWSER_ENABLED: "true",
        OTEL_SERVICE_NAME: "custom-browser",
      }),
    ).toEqual({ enabled: true, apiKey: "test-key", serviceName: "custom-browser" });
  });
});
