/**
 * OpenTelemetry server-side tracing.
 *
 * Must be imported before any other modules in server/index.ts so that
 * auto-instrumentation patches are applied before Express/http are loaded.
 *
 * Required env vars:
 *   HONEYCOMB_API_KEY  — Honeycomb ingest API key
 *
 * Optional env vars:
 *   OTEL_SERVICE_NAME  — defaults to "say-to-me-server"
 *   OTEL_ENABLED       — set to "false" to disable entirely
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env before reading any env vars — tracing.ts runs before api.ts
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // ignore if not supported (Node < 20.12)
  }
}

const enabled =
  process.env.OTEL_ENABLED !== "false" &&
  process.env.VITEST !== "true" &&
  !!process.env.HONEYCOMB_API_KEY;

if (enabled) {
  const apiKey = process.env.HONEYCOMB_API_KEY!;
  const serviceName = process.env.OTEL_SERVICE_NAME || "say-to-me-server";

  const exporter = new OTLPTraceExporter({
    url: "https://api.honeycomb.io/v1/traces",
    headers: {
      "x-honeycomb-team": apiKey,
    },
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy fs instrumentation
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[otel] tracing enabled → Honeycomb (service: ${serviceName})`);

  process.on("SIGTERM", () => {
    void sdk.shutdown().finally(() => process.exit(0));
  });
} else if (!process.env.HONEYCOMB_API_KEY) {
  console.log("[otel] tracing disabled (set HONEYCOMB_API_KEY to enable)");
}
