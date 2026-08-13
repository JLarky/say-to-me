import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { closeTestServer } from "./test-http.ts";
import { pipeWebResponseToExpress } from "./web-response.ts";

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

describe("pipeWebResponseToExpress", () => {
  it("buffers JSON responses", async () => {
    const app = express();
    app.get("/json", (_req, res) => {
      void Effect.runPromise(
        pipeWebResponseToExpress(res, Response.json({ ok: true }, { status: 201 })),
      );
    });
    const { origin, server } = await listen(app);

    try {
      const response = await fetch(`${origin}/json`);
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await closeTestServer(server);
    }
  });

  it("streams non-JSON bodies without buffering the full payload", async () => {
    let readCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        readCount += 1;
        if (readCount === 1) {
          controller.enqueue(new TextEncoder().encode("chunk-1"));
          return;
        }
        controller.close();
      },
    });

    const app = express();
    app.get("/file", (_req, res) => {
      void Effect.runPromise(
        pipeWebResponseToExpress(
          res,
          new Response(stream, {
            headers: {
              "Content-Type": "image/png",
              "Content-Disposition": 'inline; filename="file.png"',
            },
          }),
        ),
      );
    });
    const { origin, server } = await listen(app);

    try {
      const response = await fetch(`${origin}/file`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
      expect(await response.text()).toBe("chunk-1");
      expect(readCount).toBeGreaterThan(0);
    } finally {
      await closeTestServer(server);
    }
  });
});
