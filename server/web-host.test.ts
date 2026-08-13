import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vite-plus/test";

await import("./api.harness.ts");
const { createWebHostHandler, handleWebHostRequest } = await import("./web-host.ts");

function listenFetch(
  handler: (request: Request) => Promise<Response>,
): Promise<{ origin: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const host = req.headers.host ?? "127.0.0.1";
      const url = `http://${host}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      const request = new Request(url, {
        method: req.method,
        headers,
        body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });

      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const responseBody = await response.arrayBuffer();
      res.end(Buffer.from(responseBody));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ origin: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

function closeListenServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("web host", () => {
  it("serves migrated JSON routes through dispatchApiRequest", async () => {
    const handler = createWebHostHandler(async () => new Response("spa", { status: 200 }));
    const { origin, server } = await listenFetch(handler);
    try {
      const response = await fetch(`${origin}/api/version`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const payload = (await response.json()) as { version: number };
      expect(typeof payload.version).toBe("number");
    } finally {
      await closeListenServer(server);
    }
  });

  it("returns JSON 404 for unmatched /api paths", async () => {
    const handler = createWebHostHandler(async () => new Response("spa", { status: 200 }));
    const { origin, server } = await listenFetch(handler);
    try {
      const response = await fetch(`${origin}/api/does-not-exist`);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "Not found.", status: 404 });
    } finally {
      await closeListenServer(server);
    }
  });

  it("opens queue SSE with a snapshot event", async () => {
    const response = await handleWebHostRequest(new Request("http://127.0.0.1/api/events"));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/event-stream");
    const reader = response!.body!.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain("event:");
    void reader.cancel();
  });

  it("falls through non-API misses to the frontend handler", async () => {
    const handler = createWebHostHandler(async () => {
      return new Response("<html>spa</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    const { origin, server } = await listenFetch(handler);
    try {
      const response = await fetch(`${origin}/ses/default`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toBe("<html>spa</html>");
    } finally {
      await closeListenServer(server);
    }
  });
});
