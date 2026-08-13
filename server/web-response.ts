import type { Response as ExpressResponse } from "express";
import { Effect } from "effect";

export function pipeWebResponseToExpress(
  res: ExpressResponse,
  response: globalThis.Response,
  options: { detachStream?: boolean } = {},
): Effect.Effect<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));

  if (!response.body) {
    return Effect.sync(() => {
      res.end();
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    return Effect.promise(async () => {
      res.send(Buffer.from(await response.arrayBuffer()));
    });
  }

  const pipe = Effect.promise(async () => {
    const reader = response.body!.getReader();
    res.on("close", () => {
      void reader.cancel().catch(() => {});
    });
    res.flushHeaders?.();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buffer = Buffer.from(value);
        if (!res.write(buffer)) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
    } finally {
      res.end();
    }
  });

  if (options.detachStream) {
    return Effect.sync(() => {
      void Effect.runPromise(pipe);
    });
  }

  return pipe;
}
