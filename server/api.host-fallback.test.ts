import express from "express";
import { describe, expect, it } from "vite-plus/test";
import { closeTestServer, createApiMiddleware, listen } from "./api.harness.ts";

describe("API host fallback", () => {
  it("falls through non-API misses so static and SPA handlers can run", async () => {
    const app = express();
    app.use(createApiMiddleware());
    app.get("/frontend-route", (_req, res) => {
      res.status(200).type("text/html").send("<html>spa</html>");
    });

    const { origin, server } = await listen(app);
    try {
      const response = await fetch(`${origin}/frontend-route`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<html>spa</html>");
    } finally {
      await closeTestServer(server);
    }
  });

  it("returns JSON 404 for unmatched /api paths", async () => {
    const { origin, server } = await listen(createApiMiddleware());
    try {
      const response = await fetch(`${origin}/api/does-not-exist`);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "Not found.", status: 404 });
    } finally {
      await closeTestServer(server);
    }
  });
});
