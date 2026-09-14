import type { Response as ExpressResponse } from "express";
import { sseRetryLine, type SseClient } from "./client.ts";

// Shared SSE response headers. `openExpressSseStream` remains for reference until
// Phase 4 removes the Express host; migrated routes use `createSseWebResponse`.

export const sseStreamHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export function expressResponseToSseClient(res: ExpressResponse): SseClient {
  return {
    write(chunk: string) {
      res.write(chunk);
    },
    close() {
      if (!res.writableEnded) res.end();
    },
  };
}

export function openExpressSseStream(
  res: ExpressResponse,
  options: { accelBuffering?: boolean; retry?: boolean } = {},
): SseClient {
  const accelBuffering = options.accelBuffering ?? true;
  const retry = options.retry ?? true;
  const headers: typeof sseStreamHeaders & { "X-Accel-Buffering"?: string } = {
    ...sseStreamHeaders,
  };
  if (accelBuffering) headers["X-Accel-Buffering"] = "no";

  res.writeHead(200, headers);
  res.flushHeaders?.();

  const client = expressResponseToSseClient(res);
  if (retry) void client.write(sseRetryLine);
  return client;
}
