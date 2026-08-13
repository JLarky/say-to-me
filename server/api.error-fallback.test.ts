import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vite-plus/test";
import { jsonErrorHandler, jsonErrorResponseFallback } from "./api-json-errors.ts";
import { closeTestServer } from "./test-http.ts";

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

describe("API JSON error fallback", () => {
  it("fills in a JSON body for status-only 400 responses", async () => {
    const app = express();
    app.use(jsonErrorResponseFallback());
    app.get("/status-only", (_req, res) => res.status(400).end());
    app.use(jsonErrorHandler);
    const { origin, server } = await listen(app);

    try {
      const response = await fetch(`${origin}/status-only`);

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "HTTP 400", status: 400 });
    } finally {
      await closeTestServer(server);
    }
  });

  it("fills in a JSON body for empty JSON-typed 500 responses", async () => {
    const app = express();
    app.use(jsonErrorResponseFallback());
    app.get("/empty-json", (_req, res) => res.status(500).type("json").end());
    app.use(jsonErrorHandler);
    const { origin, server } = await listen(app);

    try {
      const response = await fetch(`${origin}/empty-json`);

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "HTTP 500", status: 500 });
    } finally {
      await closeTestServer(server);
    }
  });

  it("normalizes raw text error bodies to JSON", async () => {
    const app = express();
    app.use(jsonErrorResponseFallback());
    app.get("/raw-text", (_req, res) => res.status(500).type("text").end("Boom"));
    app.use(jsonErrorHandler);
    const { origin, server } = await listen(app);

    try {
      const response = await fetch(`${origin}/raw-text`);

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "Boom", status: 500 });
    } finally {
      await closeTestServer(server);
    }
  });

  it("adds status to existing JSON error bodies", async () => {
    const app = express();
    app.use(jsonErrorResponseFallback());
    app.get("/json-error", (_req, res) => res.status(400).json({ error: "Nope" }));
    app.use(jsonErrorHandler);
    const { origin, server } = await listen(app);

    try {
      const response = await fetch(`${origin}/json-error`);

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "Nope", status: 400 });
    } finally {
      await closeTestServer(server);
    }
  });

  it("maps thrown errors to JSON with status and error", async () => {
    const app = express();
    app.use(jsonErrorResponseFallback());
    app.get("/throws", () => {
      const error = new Error("Exploded");
      Object.assign(error, { status: 418 });
      throw error;
    });
    app.use(jsonErrorHandler);
    const { origin, server } = await listen(app);

    try {
      const response = await fetch(`${origin}/throws`);

      expect(response.status).toBe(418);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "Exploded", status: 418 });
    } finally {
      await closeTestServer(server);
    }
  });
});
