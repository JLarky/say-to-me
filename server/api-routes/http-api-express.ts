import type { RequestHandler } from "express";
import { Readable } from "node:stream";

export function httpApiExpressHandler(
  handler: (request: Request) => Promise<Response>,
): RequestHandler {
  return (req, res, next) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }

    const protocol = req.protocol || "http";
    const host = req.get("host") ?? "127.0.0.1";
    const canHaveBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`${protocol}://${host}${req.originalUrl}`, {
      method: req.method,
      headers,
      ...(canHaveBody
        ? {
            body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
            duplex: "half" as const,
          }
        : {}),
    } as RequestInit & { duplex: "half" });

    void handler(request)
      .then(async (response) => {
        res.status(response.status);
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.send(Buffer.from(await response.arrayBuffer()));
      })
      .catch(next);
  };
}
