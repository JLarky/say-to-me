import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SAY_TO_ME_URL,
  buildRequestHeaders,
  executeRawApiRequest,
  fetchSameOrigin,
  findOpenApiOperationHelp,
  formatApiRecoveryHint,
  formatOpenApiCatalog,
  formatOpenApiOperationHelp,
  interpolatePath,
  isSameOriginApiPath,
  listOpenApiOperations,
  parseApiCliArgs,
  parseHeaderFlag,
  rawRequest,
  readBodySource,
  resolveBaseUrl,
  resolveCliRequest,
  resolveOperation,
  resolveRequestUrl,
  type SameOriginFetch,
  writeText,
} from "./api-request.ts";

describe("rawRequest", () => {
  it("resolves curl-like method and path input", () => {
    expect(rawRequest(["post", "/api/foo"])).toEqual({ method: "POST", path: "/api/foo" });
    expect(rawRequest(["GET", "/api/queue"])).toEqual({ method: "GET", path: "/api/queue" });
  });

  it("rejects non raw method/path forms", () => {
    expect(rawRequest(["v2.session.list"])).toBeUndefined();
    expect(rawRequest(["GET"])).toBeUndefined();
    expect(rawRequest(["GET", "api/queue"])).toBeUndefined();
    expect(rawRequest(["FETCH", "/api/queue"])).toBeUndefined();
  });

  it("rejects protocol-relative paths that escape the server origin", () => {
    expect(isSameOriginApiPath("/api/queue")).toBe(true);
    expect(isSameOriginApiPath("//evil.example/api")).toBe(false);
    expect(rawRequest(["GET", "//evil.example/api"])).toBeUndefined();
    expect(rawRequest(["GET", "\\\\evil.example/api"])).toBeUndefined();
  });
});

describe("resolveOperation", () => {
  const spec = {
    paths: {
      "/api/sessions/{sessionId}/messages": {
        get: { operationId: "queue.getSessionQueue" },
      },
      "/api/health": {
        get: { operationId: "health.getHealth" },
      },
    },
  };

  it("resolves an operation ID with path and query parameters", () => {
    expect(
      resolveOperation(spec, "queue.getSessionQueue", {
        sessionId: "ses/a",
        limit: "5",
      }),
    ).toEqual({
      method: "GET",
      path: "/api/sessions/ses%2Fa/messages?limit=5",
    });
  });

  it("rejects a missing path parameter", () => {
    expect(() => resolveOperation(spec, "queue.getSessionQueue", {})).toThrow(
      /Missing path parameter: sessionId\nFor request shape and required params, run: say-to-me api help queue\.getSessionQueue/,
    );
  });

  it("throws when operation is unknown", () => {
    expect(() => resolveOperation(spec, "nope", {})).toThrow(
      /Operation not found: nope\nList operations with: say-to-me api list/,
    );
  });
});

describe("operation help helpers", () => {
  const spec = {
    paths: {
      "/api/sessions/{sessionId}/messages": {
        post: {
          operationId: "message-create.createSessionMessage",
          summary: "Create a session message",
        },
      },
    },
  };

  it("finds and formats operation help", () => {
    const help = findOpenApiOperationHelp(spec, "message-create.createSessionMessage");
    expect(help).toEqual({
      operationId: "message-create.createSessionMessage",
      method: "POST",
      path: "/api/sessions/{sessionId}/messages",
      summary: "Create a session message",
      pathParams: ["sessionId"],
    });
    const formatted = formatOpenApiOperationHelp(help!);
    expect(formatted).toContain("--param sessionId=<value>");
    expect(formatted).toContain("say-to-me api message-create.createSessionMessage");
    expect(formatted).toContain(`-d '{"…":…}'`);
  });

  it("formats recovery hints for agents", () => {
    expect(
      formatApiRecoveryHint(400, {
        kind: "operation",
        operationId: "message-create.createSessionMessage",
      }),
    ).toBe(
      "HTTP 400\n" +
        "You just got a 400 response from this API. " +
        "For request shape and required params, run: say-to-me api help message-create.createSessionMessage\n",
    );
    expect(formatApiRecoveryHint(500, { kind: "raw", method: "POST", path: "/api/x" })).toBe(
      "HTTP 500\n" +
        "You just got a 500 response from this API. " +
        "For request shape and required params, run: say-to-me api --help\n",
    );
  });
});

describe("listOpenApiOperations", () => {
  it("flattens and groups operations with summaries", () => {
    const entries = listOpenApiOperations({
      paths: {
        "/api/health": {
          get: {
            operationId: "health.getHealth",
            summary: "Health check",
            tags: ["health"],
          },
        },
        "/api/queue": {
          get: { operationId: "queue.getSessionQueue", summary: "Read queue" },
          post: { summary: "missing id skipped" },
        },
      },
    });
    expect(entries).toEqual([
      {
        operationId: "health.getHealth",
        method: "GET",
        path: "/api/health",
        summary: "Health check",
        group: "health",
      },
      {
        operationId: "queue.getSessionQueue",
        method: "GET",
        path: "/api/queue",
        summary: "Read queue",
        group: "queue",
      },
    ]);
    expect(formatOpenApiCatalog(entries)).toContain(
      "health.getHealth  GET /api/health — Health check",
    );
    expect(formatOpenApiCatalog(entries)).toContain("2 operations");
  });
});

describe("interpolatePath", () => {
  it("encodes path params and appends unused as query", () => {
    expect(interpolatePath("/api/x/{id}", { id: "a/b", q: "1" })).toBe("/api/x/a%2Fb?q=1");
  });

  it("merges --param into an existing query string without a second ?", () => {
    expect(interpolatePath("/api/x?a=1", { b: "2" })).toBe("/api/x?a=1&b=2");
    expect(interpolatePath("/api/x/{id}?a=1", { id: "z", b: "2" })).toBe("/api/x/z?a=1&b=2");
  });
});

describe("resolveRequestUrl", () => {
  it("keeps requests on the configured origin", () => {
    expect(resolveRequestUrl("https://say.local:1355", "/api/queue").href).toBe(
      "https://say.local:1355/api/queue",
    );
  });

  it("throws for protocol-relative paths instead of rewriting origin", () => {
    expect(() => resolveRequestUrl("https://say.local:1355", "//evil.example/api")).toThrow(
      /same-origin|origin/i,
    );
  });
});

describe("resolveBaseUrl", () => {
  it("prefers --server, then SAY_TO_ME_URL, then default", () => {
    expect(resolveBaseUrl("http://127.0.0.1:5411/", {})).toBe("http://127.0.0.1:5411");
    expect(resolveBaseUrl(undefined, { SAY_TO_ME_URL: "https://say.local:1355/" })).toBe(
      "https://say.local:1355",
    );
    expect(resolveBaseUrl(undefined, {})).toBe(DEFAULT_SAY_TO_ME_URL);
  });
});

describe("parseApiCliArgs", () => {
  it("parses list mode with optional --server", () => {
    expect(parseApiCliArgs(["list"])).toEqual({ kind: "list" });
    expect(parseApiCliArgs(["list", "--server", "http://127.0.0.1:5411"])).toEqual({
      kind: "list",
      server: "http://127.0.0.1:5411",
    });
    expect(parseApiCliArgs(["--server=http://127.0.0.1:5411", "list"])).toEqual({
      kind: "list",
      server: "http://127.0.0.1:5411",
    });
  });

  it("parses method path and optional server", () => {
    expect(parseApiCliArgs(["GET", "/api/queue"])).toEqual({
      kind: "request",
      params: {},
      headers: [],
      body: { kind: "none" },
      target: { kind: "raw", method: "GET", path: "/api/queue" },
    });
    expect(parseApiCliArgs(["--server", "http://127.0.0.1:5411", "get", "/api/health"])).toEqual({
      kind: "request",
      server: "http://127.0.0.1:5411",
      params: {},
      headers: [],
      body: { kind: "none" },
      target: { kind: "raw", method: "GET", path: "/api/health" },
    });
  });

  it("parses operation id and --param pairs", () => {
    expect(
      parseApiCliArgs([
        "queue.getSessionQueue",
        "--param",
        "sessionId=ses_eeb39d7c36ddkBg335I61iPEwh",
        "--param=limit=3",
      ]),
    ).toEqual({
      kind: "request",
      params: { sessionId: "ses_eeb39d7c36ddkBg335I61iPEwh", limit: "3" },
      headers: [],
      body: { kind: "none" },
      target: { kind: "operation", operationId: "queue.getSessionQueue" },
    });
  });

  it("parses --data and --header flags", () => {
    expect(
      parseApiCliArgs([
        "POST",
        "/api/sessions/ses_ff03000e647805ix8IqxyDL5i7/messages",
        "--data",
        '{"author":"agent","text":"hi"}',
        "-H",
        "X-Test: 1",
      ]),
    ).toEqual({
      kind: "request",
      params: {},
      headers: [{ name: "X-Test", value: "1" }],
      body: { kind: "literal", value: '{"author":"agent","text":"hi"}' },
      target: {
        kind: "raw",
        method: "POST",
        path: "/api/sessions/ses_ff03000e647805ix8IqxyDL5i7/messages",
      },
    });
    expect(parseApiCliArgs(["POST", "/api/x", "--data=-"])).toEqual({
      kind: "request",
      params: {},
      headers: [],
      body: { kind: "stdin" },
      target: { kind: "raw", method: "POST", path: "/api/x" },
    });
    expect(parseApiCliArgs(["POST", "/api/x", "--data=@-"])).toEqual({
      kind: "request",
      params: {},
      headers: [],
      body: { kind: "stdin" },
      target: { kind: "raw", method: "POST", path: "/api/x" },
    });
  });

  it("parses operation help mode", () => {
    expect(parseApiCliArgs(["help", "message-create.createSessionMessage"])).toEqual({
      kind: "operation-help",
      operationId: "message-create.createSessionMessage",
    });
    expect(
      parseApiCliArgs(["help", "--server", "http://127.0.0.1:5411", "queue.getSessionQueue"]),
    ).toEqual({
      kind: "operation-help",
      operationId: "queue.getSessionQueue",
      server: "http://127.0.0.1:5411",
    });
  });

  it("returns help and parse errors", () => {
    expect(parseApiCliArgs([])).toEqual({ kind: "help" });
    expect(parseApiCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseApiCliArgs(["help"])).toEqual({ kind: "help" });
    expect(parseApiCliArgs(["GET"])).toEqual({
      kind: "error",
      message: "Expected an HTTP method and path (example: GET /api/queue)",
    });
    expect(parseApiCliArgs(["--unknown", "GET", "/api/queue"])).toEqual({
      kind: "error",
      message: "Unknown option: --unknown",
    });
    expect(parseApiCliArgs(["GET", "//evil.example/api"])).toEqual({
      kind: "error",
      message:
        "Path must stay on the configured server origin (protocol-relative // paths are rejected)",
    });
    expect(parseApiCliArgs(["health.getHealth", "--param", "nocolon"])).toEqual({
      kind: "error",
      message: "Invalid --param, expected name=value: nocolon",
    });
    expect(parseApiCliArgs(["POST", "/api/x", "-H", "bad"])).toEqual({
      kind: "error",
      message: "Invalid header, expected name:value: bad",
    });
  });
});

describe("headers and body helpers", () => {
  it("parses name:value headers", () => {
    expect(parseHeaderFlag("Accept: application/json")).toEqual({
      name: "Accept",
      value: "application/json",
    });
    expect(parseHeaderFlag("nocolon")).toEqual({
      error: "Invalid header, expected name:value: nocolon",
    });
  });

  it("defaults Content-Type to application/json when body is set", () => {
    const headers = buildRequestHeaders([{ name: "X-A", value: "1" }], '{"ok":true}');
    expect(headers.get("x-a")).toBe("1");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("does not override an explicit Content-Type", () => {
    const headers = buildRequestHeaders([{ name: "Content-Type", value: "text/plain" }], "hello");
    expect(headers.get("content-type")).toBe("text/plain");
  });

  it("reads literal and stdin body sources", async () => {
    await expect(readBodySource({ kind: "none" })).resolves.toBeUndefined();
    await expect(readBodySource({ kind: "literal", value: "x" })).resolves.toBe("x");
    await expect(readBodySource({ kind: "stdin" }, async () => "from-stdin")).resolves.toBe(
      "from-stdin",
    );
  });
});

describe("resolveCliRequest", () => {
  it("loads openapi.json for operation ids", async () => {
    const fetchImpl = vi.fn<SameOriginFetch>(async (input: URL | RequestInfo) => {
      const href =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- input is the declared `URL | RequestInfo` (RequestInfo = Request | string) union; typeof narrows the already-typed union.
        input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
      if (href.endsWith("/openapi.json")) {
        return new Response(
          JSON.stringify({
            paths: {
              "/api/health": { get: { operationId: "health.getHealth" } },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    });

    await expect(
      resolveCliRequest({
        baseUrl: "https://say.local:1355",
        target: { kind: "operation", operationId: "health.getHealth" },
        params: {},
        fetchImpl,
      }),
    ).resolves.toEqual({ method: "GET", path: "/api/health" });
  });
});

describe("executeRawApiRequest", () => {
  it("returns status, ok, and body from fetch", async () => {
    const fetchImpl = vi.fn<SameOriginFetch>(
      async () => new Response('{"ok":true}', { status: 200 }),
    );
    await expect(
      executeRawApiRequest({
        baseUrl: "https://say.local:1355",
        method: "GET",
        path: "/api/health",
        fetchImpl,
      }),
    ).resolves.toEqual({ status: 200, ok: true, body: '{"ok":true}' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0].href).toBe("https://say.local:1355/api/health");
    expect(call[1].method).toBe("GET");
  });

  it("forwards headers and request body", async () => {
    const fetchImpl = vi.fn<SameOriginFetch>(async () => new Response('{"id":1}', { status: 200 }));
    const headers = buildRequestHeaders([], '{"author":"agent","text":"hi"}');
    await executeRawApiRequest({
      baseUrl: "https://say.local:1355",
      method: "POST",
      path: "/api/sessions/ses_ff03000e647805ix8IqxyDL5i7/messages",
      headers,
      body: '{"author":"agent","text":"hi"}',
      fetchImpl,
    });
    const call = fetchImpl.mock.calls[0]!;
    expect(call[1].method).toBe("POST");
    expect(call[1].body).toBe('{"author":"agent","text":"hi"}');
    expect((call[1].headers as Headers).get("content-type")).toBe("application/json");
  });

  it("preserves non-2xx bodies", async () => {
    const fetchImpl = vi.fn<SameOriginFetch>(
      async () => new Response('{"status":404,"error":"Not found."}', { status: 404 }),
    );
    await expect(
      executeRawApiRequest({
        baseUrl: "https://say.local:1355",
        method: "GET",
        path: "/api/missing",
        fetchImpl,
      }),
    ).resolves.toEqual({
      status: 404,
      ok: false,
      body: '{"status":404,"error":"Not found."}',
    });
  });

  it("uses redirect: manual so fetch does not auto-follow", async () => {
    const fetchImpl = vi.fn<SameOriginFetch>(
      async () => new Response('{"ok":true}', { status: 200 }),
    );
    await executeRawApiRequest({
      baseUrl: "https://say.local:1355",
      method: "GET",
      path: "/api/health",
      fetchImpl,
    });
    const call = fetchImpl.mock.calls[0]!;
    expect(call[1].redirect).toBe("manual");
  });
});

describe("fetchSameOrigin", () => {
  it("refuses cross-origin redirects so custom headers are not replayed", async () => {
    const secret = new Headers({ "X-Secret": "s3cr3t" });
    const fetchImpl = vi.fn<SameOriginFetch>(async () => {
      return new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1:9/steal" },
      });
    });

    await expect(
      fetchSameOrigin(
        new URL("https://say.local:1355/api/health"),
        { method: "GET", headers: secret },
        fetchImpl,
      ),
    ).rejects.toThrow(/cross-origin redirect/i);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0].href).toBe("https://say.local:1355/api/health");
    expect(call[1].redirect).toBe("manual");
    // Headers only went to the original same-origin request, never to 127.0.0.1:9.
    expect((call[1].headers as Headers).get("X-Secret")).toBe("s3cr3t");
  });

  it("follows same-origin redirects while keeping headers on that origin", async () => {
    const secret = new Headers({ "X-Secret": "s3cr3t" });
    const fetchImpl = vi.fn<SameOriginFetch>(async (input: URL | RequestInfo) => {
      const href =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- input is the declared `URL | RequestInfo` (RequestInfo = Request | string) union; typeof narrows the already-typed union.
        input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
      if (href.endsWith("/api/old")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/api/health" },
        });
      }
      return new Response('{"ok":true}', { status: 200 });
    });

    const response = await fetchSameOrigin(
      new URL("https://say.local:1355/api/old"),
      { method: "GET", headers: secret },
      fetchImpl,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const second = fetchImpl.mock.calls[1]!;
    expect(second[0].href).toBe("https://say.local:1355/api/health");
    expect((second[1].headers as Headers).get("X-Secret")).toBe("s3cr3t");
    expect(second[1].redirect).toBe("manual");
  });

  it.each(["PUT", "PATCH", "DELETE"] as const)(
    "preserves %s method and body across same-origin 302",
    async (method) => {
      const body = method === "DELETE" ? undefined : '{"name":"n"}';
      const fetchImpl = vi.fn<SameOriginFetch>(async (input: URL | RequestInfo) => {
        const href =
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- input is the declared `URL | RequestInfo` (RequestInfo = Request | string) union; typeof narrows the already-typed union.
          input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
        if (href.endsWith("/api/old")) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/api/new" },
          });
        }
        return new Response('{"ok":true}', { status: 200 });
      });

      const response = await fetchSameOrigin(
        new URL("https://say.local:1355/api/old"),
        { method, body, headers: new Headers({ "X-Secret": "s3cr3t" }) },
        fetchImpl,
      );
      expect(response.status).toBe(200);
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      const first = fetchImpl.mock.calls[0]!;
      const second = fetchImpl.mock.calls[1]!;
      expect(first[1].method).toBe(method);
      expect(first[1].body).toBe(body);
      expect(second[0].href).toBe("https://say.local:1355/api/new");
      expect(second[1].method).toBe(method);
      expect(second[1].body).toBe(body);
      expect((second[1].headers as Headers).get("X-Secret")).toBe("s3cr3t");
      expect(second[1].redirect).toBe("manual");
    },
  );

  it("converts POST to GET with empty body on same-origin 303", async () => {
    const fetchImpl = vi.fn<SameOriginFetch>(async (input: URL | RequestInfo) => {
      const href =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- input is the declared `URL | RequestInfo` (RequestInfo = Request | string) union; typeof narrows the already-typed union.
        input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
      if (href.endsWith("/api/old")) {
        return new Response(null, {
          status: 303,
          headers: { Location: "/api/new" },
        });
      }
      return new Response('{"ok":true}', { status: 200 });
    });

    const response = await fetchSameOrigin(
      new URL("https://say.local:1355/api/old"),
      {
        method: "POST",
        body: '{"author":"agent","text":"hi"}',
        headers: new Headers({ "X-Secret": "s3cr3t" }),
      },
      fetchImpl,
    );
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const first = fetchImpl.mock.calls[0]!;
    const second = fetchImpl.mock.calls[1]!;
    expect(first[1].method).toBe("POST");
    expect(first[1].body).toBe('{"author":"agent","text":"hi"}');
    expect(second[0].href).toBe("https://say.local:1355/api/new");
    expect(second[1].method).toBe("GET");
    expect(second[1].body).toBeUndefined();
    expect((second[1].headers as Headers).get("X-Secret")).toBe("s3cr3t");
  });
});

describe("writeText", () => {
  it("writes payloads larger than the pipe highWaterMark without truncation", async () => {
    const chunks: Buffer[] = [];
    const stream = new Writable({
      highWaterMark: 16,
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        // Slow consumer so write() returns false and drain is required.
        setImmediate(callback);
      },
    });

    const payload = "x".repeat(70_000);
    await writeText(stream, payload);

    const written = Buffer.concat(chunks).toString("utf8");
    expect(written.length).toBe(70_000);
    expect(written).toBe(payload);
  });

  it("resolves immediately for empty payloads", async () => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("should not write"));
      },
    });
    await expect(writeText(stream, "")).resolves.toBeUndefined();
  });
});
