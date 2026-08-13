import { createServer } from "node:http";
import { Effect } from "effect";
import type { Express } from "express";

export type TestServer = ReturnType<typeof createServer>;

export function closeTestServerEffect(server: TestServer): Effect.Effect<void, Error> {
  return Effect.async<void, Error>((resume) => {
    server.closeIdleConnections?.();
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
        resume(Effect.fail(error));
        return;
      }
      resume(Effect.void);
    });
    server.closeAllConnections?.();
  });
}

export function closeTestServer(server: TestServer): Promise<void> {
  return Effect.runPromise(closeTestServerEffect(server));
}

export function listen(
  app: Express,
): Promise<{ server: ReturnType<typeof createServer>; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}
