/**
 * OpenTelemetry browser-side tracing.
 *
 * Initializes a WebTracerProvider that:
 *  - Auto-instruments fetch() calls (captures URL, method, status, duration)
 *  - Propagates W3C traceparent headers so client fetch spans link to server spans
 *  - Exports traces to Honeycomb via OTLP/HTTP
 *
 * Required: window.__OTEL_CONFIG__ must be set before this module is imported.
 * The server injects this via the /api/otel-config endpoint (or it can be
 * baked into index.html at build time).
 *
 * If HONEYCOMB_API_KEY is not configured server-side, the config endpoint
 * returns { enabled: false } and this module does nothing.
 */

import { type as arktype } from "arktype";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-web";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { trace, context, type Tracer } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { safeResponseJson } from "@say-to-me/runtime-validation";

export type OtelConfig =
  | { enabled: false }
  | { enabled: true; apiKey: string; serviceName: string };

const OtelConfigSchema = arktype({
  enabled: "false",
}).or(
  arktype({
    enabled: "true",
    apiKey: "string",
    serviceName: "string",
  }),
);

let _tracer: Tracer | null = null;

export function getTracer(): Tracer | null {
  return _tracer;
}

export async function initBrowserTracing(): Promise<void> {
  // Fetch OTel config from server — avoids baking the API key into client bundle
  let config: OtelConfig;
  try {
    const res = await fetch("/api/otel-config");
    config = await safeResponseJson(res, OtelConfigSchema);
  } catch {
    return; // server unreachable or endpoint missing — silently skip
  }

  if (!config.enabled) return;

  const exporter = new OTLPTraceExporter({
    url: "https://api.honeycomb.io/v1/traces",
    headers: {
      "x-honeycomb-team": config.apiKey,
      "x-honeycomb-dataset": config.serviceName,
    },
  });

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ "service.name": config.serviceName }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        // Only instrument same-origin API calls; exclude the Honeycomb
        // export endpoint to avoid an infinite trace-about-traces loop.
        ignoreUrls: [/honeycomb\.io/, /api\.honeycomb/],
        // Propagate trace context to same-origin API calls only
        propagateTraceHeaderCorsUrls: [/\/api\//],
        // Add response content-length as span attribute when available
        applyCustomAttributesOnSpan(span, request, result) {
          if (result instanceof Response) {
            span.setAttribute(
              "http.response_content_length",
              result.headers.get("content-length") ?? "",
            );
          }
          // Tag message-send fetches so they're easy to filter in Honeycomb
          const url = request instanceof Request ? request.url : undefined;
          if (url?.includes("/messages")) {
            span.setAttribute("say_to_me.is_message_send", true);
          }
        },
      }),
    ],
  });

  _tracer = trace.getTracer(config.serviceName);
  console.log(`[otel] browser tracing enabled (service: ${config.serviceName})`);
}

/**
 * Wrap sendOptimisticMessage calls in a manual span so we can see:
 *  - Exactly when the client decided to send
 *  - The call stack via Error.stack (attached as an attribute)
 *  - Whether two spans fire for one user action
 */
export function tracedSend<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = _tracer;
  if (!tracer) return fn();

  return context.with(context.active(), async () => {
    const span = tracer.startSpan(name, {
      attributes: { ...attributes, "code.stacktrace": new Error().stack ?? "" },
    });
    try {
      const result = await fn();
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (err) {
      span.setStatus({ code: 2, message: String(err) }); // ERROR
      throw err;
    } finally {
      span.end();
    }
  });
}
