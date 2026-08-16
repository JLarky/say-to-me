import "./tracing.ts"; // must be first — patches http/express before they load
import express, { type RequestHandler } from "express";
import { Effect } from "effect";
import { Readable } from "node:stream";
import { dispatchApiRequest } from "./api-routes/dispatch-api-request.ts";
import { jsonErrorHandler, jsonErrorResponseFallback, sendJsonError } from "./api-json-errors.ts";
import { ensureInternalApiToken } from "./claude/internal-api-token.ts";
import { dbPath } from "./config.ts";
import { ensureHostRuntimeStartedWithOptions, stopHostRuntime } from "./host-runtime.ts";
import { pipeWebResponseToExpress } from "./web-response.ts";

function requestPathname(req: Parameters<RequestHandler>[0]): string {
  return new URL(req.originalUrl, "http://say.local").pathname;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/say" || pathname.startsWith("/api/");
}

function expressRequestToWebRequest(req: Parameters<RequestHandler>[0]): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }

  const protocol = req.protocol || "http";
  const host = req.get("host") ?? "127.0.0.1";
  const canHaveBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
  };
  if (canHaveBody) {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(`${protocol}://${host}${req.originalUrl}`, init);
}

function sendWebResponse(res: Parameters<RequestHandler>[1], response: globalThis.Response) {
  return pipeWebResponseToExpress(res, response, { detachStream: true });
}

export function createApiMiddleware() {
  ensureInternalApiToken();
  ensureHostRuntimeStartedWithOptions({ resume: true });
  const app = express();
  app.use(jsonErrorResponseFallback());
  app.use(createEffectOwnedApiMiddleware());
  app.use(jsonErrorHandler);
  return app;
}

function createEffectOwnedApiMiddleware(): RequestHandler {
  return (req, res, next) => {
    const pathname = requestPathname(req);
    const program = Effect.promise(() => dispatchApiRequest(expressRequestToWebRequest(req))).pipe(
      Effect.flatMap((response) => {
        if (response) return sendWebResponse(res, response);
        if (isApiPath(pathname)) {
          return Effect.sync(() => sendJsonError(res, 404, "Not found."));
        }
        return Effect.sync(() => next());
      }),
    );
    void Effect.runPromise(program).catch(next);
  };
}

export async function closeApi() {
  await stopHostRuntime();
}

export { dbPath, jsonErrorHandler, jsonErrorResponseFallback };
