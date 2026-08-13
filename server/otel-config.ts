export type BrowserOtelConfig =
  | { enabled: false }
  | { apiKey: string; enabled: true; serviceName: string };

export function browserOtelConfig(env: NodeJS.ProcessEnv = process.env): BrowserOtelConfig {
  const apiKey = env.HONEYCOMB_API_KEY;
  const enabled = env.OTEL_ENABLED !== "false" && env.OTEL_BROWSER_ENABLED === "true" && !!apiKey;

  if (!enabled) return { enabled: false };

  return {
    apiKey,
    enabled: true,
    serviceName: env.OTEL_SERVICE_NAME || "say-to-me-browser",
  };
}
