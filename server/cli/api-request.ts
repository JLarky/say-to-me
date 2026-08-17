import type { Writable } from "node:stream";
import { type as arktype } from "arktype";
import { Agent, fetch as undiciFetch } from "undici";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { portlessCaPem } from "../external-cli/portless-ca.ts";

/** HTTP methods accepted for curl-like `METHOD /path` requests. */
const methods = new Set(["delete", "get", "head", "options", "patch", "post", "put"]);

export const DEFAULT_SAY_TO_ME_URL = "http://localhost:5411";
export const OPENAPI_PATH = "/openapi.json";

let httpsAgent: Agent | null = null;

function sayToMeHttpsAgent(): Agent | null {
  if (httpsAgent) return httpsAgent;
  const ca = portlessCaPem();
  if (!ca) return null;
  httpsAgent = new Agent({ connect: { ca } });
  return httpsAgent;
}

/**
 * Default fetch for the CLI: trust the local portless CA for https://say.local
 * (same pattern as OpenCode HTTPS). Plain Node fetch fails with
 * SELF_SIGNED_CERT_IN_CHAIN → opaque "fetch failed".
 */
export async function sayToMeCliFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  if (new URL(url).protocol === "https:") {
    const agent = sayToMeHttpsAgent();
    if (agent) {
      const requestInit =
        input instanceof Request
          ? {
              body: input.body,
              duplex: input.body ? "half" : undefined,
              headers: input.headers,
              method: input.method,
              redirect: input.redirect,
              signal: input.signal,
              ...init,
            }
          : init;
      const response = await undiciFetch(url, {
        ...requestInit,
        dispatcher: agent,
      } as Parameters<typeof undiciFetch>[1]);
      // @ts-expect-error SAFETY: Undici implements the Fetch Response contract returned by this local HTTPS adapter.
      return response as Response;
    }
  }
  return fetch(input, init);
}

/**
 * Write the full chunk to a stream, waiting for `drain` when the pipe buffer is full.
 * Callers must not `process.exit` until this resolves, or large piped output truncates
 * at the OS pipe buffer (~64KiB). Prefer `process.exitCode` + natural exit after await.
 */
export function writeText(stream: Writable, text: string): Promise<void> {
  if (text.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      stream.off("drain", onDrain);
      reject(error);
    };
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };
    // write() returns false when the internal buffer is full; wait for drain
    // before treating the write as complete so piped consumers see the full body.
    if (stream.write(text)) {
      resolve();
      return;
    }
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

export type RawApiRequest = {
  method: string;
  path: string;
};

/** Runtime schema for the OpenAPI fields we use (operationId lookup + catalog). */
const OpenApiOperationSchema = arktype({
  "operationId?": "string",
  "summary?": "string",
  "tags?": "string[]",
});

const OpenApiDocumentSchema = arktype({
  "paths?": "Record<string, Record<string, unknown>>",
});

export type OpenApiDocument = typeof OpenApiDocumentSchema.infer;

export type OpenApiCatalogEntry = {
  operationId: string;
  method: string;
  path: string;
  summary: string | null;
  group: string;
};

export type OpenApiOperationHelp = {
  operationId: string;
  method: string;
  path: string;
  summary: string | null;
  pathParams: string[];
};

/**
 * Flatten live OpenAPI paths into a sorted catalog for `say-to-me api list`.
 * Groups by first tag when present, else by the first `/api/<segment>` path piece.
 */
export function listOpenApiOperations(spec: OpenApiDocument): OpenApiCatalogEntry[] {
  const entries: OpenApiCatalogEntry[] = [];
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!methods.has(method)) continue;
      const parsedOp = OpenApiOperationSchema(operation);
      if (parsedOp instanceof arktype.errors) continue;
      const operationId = parsedOp.operationId?.trim();
      if (!operationId) continue;
      const tag = parsedOp.tags?.find((value) => value.trim())?.trim();
      const pathGroup = path.split("/").filter(Boolean)[1] ?? "root";
      entries.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: parsedOp.summary?.trim() || null,
        group: tag || pathGroup,
      });
    }
  }
  entries.sort((a, b) => {
    const byGroup = a.group.localeCompare(b.group);
    if (byGroup !== 0) return byGroup;
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return a.method.localeCompare(b.method);
  });
  return entries;
}

export function formatOpenApiCatalog(entries: readonly OpenApiCatalogEntry[]): string {
  if (entries.length === 0) return "No OpenAPI operations with operationId found.\n";
  const lines: string[] = [];
  let currentGroup = "";
  for (const entry of entries) {
    if (entry.group !== currentGroup) {
      currentGroup = entry.group;
      if (lines.length > 0) lines.push("");
      lines.push(`## ${currentGroup}`);
    }
    const summary = entry.summary ? ` — ${entry.summary}` : "";
    lines.push(`${entry.operationId}  ${entry.method} ${entry.path}${summary}`);
  }
  lines.push("");
  lines.push(`${entries.length} operations`);
  lines.push("");
  return lines.join("\n");
}

export function pathTemplateParams(path: string): string[] {
  const names: string[] = [];
  const pathPart = path.split("?")[0] ?? path;
  for (const match of pathPart.matchAll(/\{([^}]+)\}/g)) {
    names.push(match[1]);
  }
  return names;
}

export function findOpenApiOperationHelp(
  spec: OpenApiDocument,
  operationId: string,
): OpenApiOperationHelp | null {
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!methods.has(method)) continue;
      const parsedOp = OpenApiOperationSchema(operation);
      if (parsedOp instanceof arktype.errors) continue;
      if (parsedOp.operationId !== operationId) continue;
      return {
        operationId,
        method: method.toUpperCase(),
        path,
        summary: parsedOp.summary?.trim() || null,
        pathParams: pathTemplateParams(path),
      };
    }
  }
  return null;
}

/** Human-oriented recovery help for one OpenAPI operation. */
export function formatOpenApiOperationHelp(help: OpenApiOperationHelp): string {
  const lines: string[] = [help.operationId, `  ${help.method} ${help.path}`];
  if (help.summary) lines.push(`  ${help.summary}`);
  lines.push("");
  if (help.pathParams.length > 0) {
    lines.push("Required path params:");
    for (const name of help.pathParams) {
      lines.push(`  --param ${name}=<value>`);
    }
    lines.push("");
  }
  lines.push("Example:");
  const paramFlags = help.pathParams.map((name) => `--param ${name}=<${name}>`).join(" ");
  if (help.method === "GET" || help.method === "HEAD" || help.method === "DELETE") {
    lines.push(`  say-to-me api ${help.operationId}${paramFlags ? ` ${paramFlags}` : ""}`);
  } else {
    lines.push(`  say-to-me api ${help.operationId}${paramFlags ? ` ${paramFlags}` : ""} \\`);
    lines.push(`    -d '{"…":…}'`);
  }
  lines.push("");
  lines.push("Also:");
  lines.push(`  say-to-me api ${help.method} ${help.path.replaceAll(/\{([^}]+)\}/g, "<$1>")}`);
  lines.push("  say-to-me api list");
  lines.push("");
  return lines.join("\n");
}

/**
 * Stderr footer for agents after a failed HTTP request.
 * Prefer operation help over generic --help because `vp node … --help` is stolen by Vite+.
 * Callers should write this to stderr (keep the response body on stdout for jq).
 */
export function formatApiRecoveryHint(
  status: number,
  target:
    | {
        kind: "raw";
        method: string;
        path: string;
      }
    | {
        kind: "operation";
        operationId: string;
      },
): string {
  const nextStep =
    target.kind === "operation"
      ? `say-to-me api help ${target.operationId}`
      : "say-to-me api --help";
  return (
    `HTTP ${status}\n` +
    `You just got a ${status} response from this API. ` +
    `For request shape and required params, run: ${nextStep}\n`
  );
}

/**
 * True when `path` is a same-origin server path (leading `/`) and not a
 * protocol-relative URL (`//host/...`) that would escape the configured origin.
 */
export function isSameOriginApiPath(path: string): boolean {
  const pathOnly = path.split("?")[0] ?? path;
  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//")) return false;
  // Some parsers treat backslashes like slashes; reject them outright.
  if (pathOnly.includes("\\")) return false;
  // Absolute URLs with a scheme are not API paths.
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(pathOnly)) return false;
  return true;
}

/**
 * Parse curl-like `[METHOD, PATH]` input (OpenCode-compatible).
 * Returns undefined when the tokens are not a raw method/path pair.
 */
export function rawRequest(input: readonly string[]): RawApiRequest | undefined {
  if (input.length !== 2 || !methods.has(input[0].toLowerCase())) return undefined;
  if (!isSameOriginApiPath(input[1])) return undefined;
  return { method: input[0].toUpperCase(), path: input[1] };
}

/**
 * Interpolate OpenAPI `{param}` segments; leftover params merge into the query
 * string via URLSearchParams (preserves any existing `?` query on the path).
 *
 * Split on `?` manually so `{template}` braces are not percent-encoded the way
 * `new URL(...)` would do before substitution.
 */
export function interpolatePath(path: string, params: Record<string, string>): string {
  const used = new Set<string>();
  const queryStart = path.indexOf("?");
  const pathPart = queryStart === -1 ? path : path.slice(0, queryStart);
  const existingQuery = queryStart === -1 ? "" : path.slice(queryStart + 1);

  const pathname = pathPart.replaceAll(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter: ${name}`);
    used.add(name);
    return encodeURIComponent(value);
  });

  const search = new URLSearchParams(existingQuery);
  for (const [name, value] of Object.entries(params)) {
    if (used.has(name)) continue;
    search.set(name, value);
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Resolve an OpenAPI operationId to method + path (OpenCode-compatible).
 */
export function resolveOperation(
  spec: OpenApiDocument,
  operationId: string,
  params: Record<string, string> = {},
): RawApiRequest {
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!methods.has(method)) continue;
      const parsedOp = OpenApiOperationSchema(operation);
      if (parsedOp instanceof arktype.errors) continue;
      if (parsedOp.operationId !== operationId) continue;
      try {
        return { method: method.toUpperCase(), path: interpolatePath(path, params) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("Missing path parameter:")) {
          throw new Error(
            `${message}\n` +
              `For request shape and required params, run: say-to-me api help ${operationId}`,
          );
        }
        throw error;
      }
    }
  }
  throw new Error(
    `Operation not found: ${operationId}\n` + `List operations with: say-to-me api list`,
  );
}

export function resolveBaseUrl(
  server?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromFlag = server?.trim();
  if (fromFlag) return stripTrailingSlash(fromFlag);
  const fromEnv = env.SAY_TO_ME_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);
  return DEFAULT_SAY_TO_ME_URL;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export type ApiRequestResult = {
  status: number;
  ok: boolean;
  body: string;
};

export function resolveRequestUrl(baseUrl: string, path: string): URL {
  if (!isSameOriginApiPath(path)) {
    throw new Error(`Refusing path that is not same-origin: ${path}`);
  }
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new Error(`Refusing to leave server origin (${base.origin}): ${url.href}`);
  }
  return url;
}

const MAX_SAME_ORIGIN_REDIRECTS = 10;

/** The request shape used by the CLI's same-origin transport. */
export type SameOriginFetch = (url: URL, init: RequestInit) => Promise<Response>;

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Fetch that never follows cross-origin redirects (Node's default `follow`
 * would replay Authorization / custom headers to another origin).
 * Same-origin Location redirects are followed manually with `redirect: "manual"`.
 */
export async function fetchSameOrigin(
  url: URL,
  init: RequestInit,
  fetchImpl: SameOriginFetch = fetch,
): Promise<Response> {
  let current = url;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers = init.headers;

  for (let hop = 0; hop < MAX_SAME_ORIGIN_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current, {
      ...init,
      method,
      headers,
      body,
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      // Opaque redirect response with no Location — surface it as-is.
      return response;
    }

    const next = new URL(location, current);
    if (next.origin !== current.origin) {
      throw new Error(
        `Refusing cross-origin redirect from ${current.origin} to ${next.origin} (${next.href})`,
      );
    }

    // 301/302: preserve method and body (including PUT/PATCH/DELETE).
    // 303 See Other: standard fetch converts non-GET/HEAD (e.g. POST) to GET
    // with an empty body. Cross-origin Location is already rejected above.
    if (response.status === 303 && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
    }

    current = next;
  }

  throw new Error(`Too many same-origin redirects (limit ${MAX_SAME_ORIGIN_REDIRECTS})`);
}

export async function fetchOpenApiDocument(options: {
  baseUrl: string;
  fetchImpl?: SameOriginFetch;
}): Promise<OpenApiDocument> {
  const fetchImpl = options.fetchImpl ?? sayToMeCliFetch;
  const url = resolveRequestUrl(options.baseUrl, OPENAPI_PATH);
  const response = await fetchSameOrigin(url, { method: "GET" }, fetchImpl);
  if (!response.ok) {
    throw new Error(`Failed to load OpenAPI document: HTTP ${response.status}`);
  }
  const raw = await response.text();
  const parsed = safeJsonParse(OpenApiDocumentSchema, raw);
  if (!parsed) throw new Error("Failed to parse OpenAPI document JSON");
  return parsed;
}

export async function resolveCliRequest(options: {
  baseUrl: string;
  target:
    | { kind: "raw"; method: string; path: string }
    | { kind: "operation"; operationId: string };
  params: Record<string, string>;
  fetchImpl?: SameOriginFetch;
}): Promise<RawApiRequest> {
  if (options.target.kind === "raw") {
    if (Object.keys(options.params).length === 0) {
      return { method: options.target.method, path: options.target.path };
    }
    // Allow --param query extras on raw paths (path template params rarely used raw).
    return {
      method: options.target.method,
      path: interpolatePath(options.target.path, options.params),
    };
  }
  const spec = await fetchOpenApiDocument({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });
  return resolveOperation(spec, options.target.operationId, options.params);
}

export type HeaderPair = { name: string; value: string };

export type BodySource = { kind: "none" } | { kind: "literal"; value: string } | { kind: "stdin" };

/** Parse OpenCode-style `name:value` header flags. */
export function parseHeaderFlag(raw: string): HeaderPair | { error: string } {
  const index = raw.indexOf(":");
  if (index < 1) {
    return { error: `Invalid header, expected name:value: ${raw}` };
  }
  const name = raw.slice(0, index).trim();
  const value = raw.slice(index + 1).trim();
  if (!name) return { error: `Invalid header, expected name:value: ${raw}` };
  return { name, value };
}

/**
 * Build request headers. When a body is present and Content-Type is unset,
 * default to application/json (OpenCode-compatible).
 */
export function buildRequestHeaders(
  headerPairs: readonly HeaderPair[],
  body: string | undefined,
): Headers {
  const headers = new Headers();
  for (const header of headerPairs) {
    headers.set(header.name, header.value);
  }
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

export async function readBodySource(
  source: BodySource,
  readStdin: () => Promise<string> = defaultReadStdin,
): Promise<string | undefined> {
  if (source.kind === "none") return undefined;
  if (source.kind === "literal") return source.value;
  return readStdin();
}

async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function executeRawApiRequest(options: {
  baseUrl: string;
  method: string;
  path: string;
  headers?: Headers;
  body?: string;
  fetchImpl?: SameOriginFetch;
}): Promise<ApiRequestResult> {
  const fetchImpl = options.fetchImpl ?? sayToMeCliFetch;
  const url = resolveRequestUrl(options.baseUrl, options.path);
  const response = await fetchSameOrigin(
    url,
    {
      method: options.method,
      headers: options.headers,
      body: options.body,
    },
    fetchImpl,
  );
  const body = await response.text();
  return { status: response.status, ok: response.ok, body };
}

export type ParsedApiCliArgs =
  | { kind: "help" }
  | { kind: "list"; server?: string }
  | { kind: "operation-help"; operationId: string; server?: string }
  | {
      kind: "request";
      server?: string;
      params: Record<string, string>;
      headers: HeaderPair[];
      body: BodySource;
      target:
        | { kind: "raw"; method: string; path: string }
        | { kind: "operation"; operationId: string };
    };

function parseParamPair(raw: string): { key: string; value: string } | { error: string } {
  const eq = raw.indexOf("=");
  if (eq < 1) {
    return { error: `Invalid --param, expected name=value: ${raw}` };
  }
  const key = raw.slice(0, eq).trim();
  const value = raw.slice(eq + 1);
  if (!key) return { error: `Invalid --param, expected name=value: ${raw}` };
  return { key, value };
}

function parseDataFlag(raw: string): BodySource {
  if (raw === "-" || raw === "@-") return { kind: "stdin" };
  return { kind: "literal", value: raw };
}

/**
 * Argv parser: optional `--server`, `--param`, `--header`/`-H`, `--data`/`-d`,
 * then either `METHOD PATH` or a single OpenAPI `operationId`.
 */
export function parseApiCliArgs(
  argv: readonly string[],
): ParsedApiCliArgs | { kind: "error"; message: string } {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { kind: "help" };
  }

  // `say-to-me api help [OPERATION]` — bare `help` is general usage; with an
  // operationId it prints path params + example (vp steals `… --help`).
  if (argv[0] === "help") {
    let server: string | undefined;
    let operationId: string | undefined;
    for (let i = 1; i < argv.length; i += 1) {
      const token = argv[i];
      if (token === "--server") {
        const value = argv[i + 1];
        if (!value || value.startsWith("-")) {
          return { kind: "error", message: "Missing value for --server" };
        }
        server = value;
        i += 1;
        continue;
      }
      if (token.startsWith("--server=")) {
        server = token.slice("--server=".length);
        if (!server) return { kind: "error", message: "Missing value for --server" };
        continue;
      }
      if (token === "--help" || token === "-h") return { kind: "help" };
      if (token.startsWith("-")) {
        return { kind: "error", message: `Unknown option: ${token}` };
      }
      if (operationId) {
        return {
          kind: "error",
          message: `Unexpected argument for api help: ${token}`,
        };
      }
      operationId = token;
    }
    if (!operationId) return { kind: "help" };
    return { kind: "operation-help", operationId, server };
  }

  // `say-to-me api list` — catalog mode (optional --server before or after).
  if (argv.includes("list") && !argv.some((token) => methods.has(token.toLowerCase()))) {
    const listIndex = argv.indexOf("list");
    const withoutList = [...argv.slice(0, listIndex), ...argv.slice(listIndex + 1)];
    let server: string | undefined;
    for (let i = 0; i < withoutList.length; i += 1) {
      const token = withoutList[i];
      if (token === "--server") {
        const value = withoutList[i + 1];
        if (!value || value.startsWith("-")) {
          return { kind: "error", message: "Missing value for --server" };
        }
        server = value;
        i += 1;
        continue;
      }
      if (token.startsWith("--server=")) {
        server = token.slice("--server=".length);
        if (!server) return { kind: "error", message: "Missing value for --server" };
        continue;
      }
      if (token === "--help" || token === "-h") return { kind: "help" };
      if (token.startsWith("-")) {
        return { kind: "error", message: `Unknown option: ${token}` };
      }
      return {
        kind: "error",
        message: `Unexpected argument for api list: ${token}`,
      };
    }
    return { kind: "list", server };
  }

  let server: string | undefined;
  let body: BodySource = { kind: "none" };
  let sawData = false;
  const params: Record<string, string> = {};
  const headers: HeaderPair[] = [];
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--server") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        return { kind: "error", message: "Missing value for --server" };
      }
      server = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--server=")) {
      server = token.slice("--server=".length);
      if (!server) return { kind: "error", message: "Missing value for --server" };
      continue;
    }
    if (token === "--param") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        return { kind: "error", message: "Missing value for --param (expected name=value)" };
      }
      const pair = parseParamPair(value);
      if ("error" in pair) return { kind: "error", message: pair.error };
      params[pair.key] = pair.value;
      i += 1;
      continue;
    }
    if (token.startsWith("--param=")) {
      const pair = parseParamPair(token.slice("--param=".length));
      if ("error" in pair) return { kind: "error", message: pair.error };
      params[pair.key] = pair.value;
      continue;
    }
    if (token === "--header" || token === "-H") {
      const value = argv[i + 1];
      if (value == null) {
        return { kind: "error", message: "Missing value for --header (expected name:value)" };
      }
      const pair = parseHeaderFlag(value);
      if ("error" in pair) return { kind: "error", message: pair.error };
      headers.push(pair);
      i += 1;
      continue;
    }
    if (token.startsWith("--header=")) {
      const pair = parseHeaderFlag(token.slice("--header=".length));
      if ("error" in pair) return { kind: "error", message: pair.error };
      headers.push(pair);
      continue;
    }
    if (token === "--data" || token === "-d") {
      const value = argv[i + 1];
      if (value == null) {
        return { kind: "error", message: "Missing value for --data" };
      }
      if (sawData) return { kind: "error", message: "Only one --data flag is allowed" };
      body = parseDataFlag(value);
      sawData = true;
      i += 1;
      continue;
    }
    if (token.startsWith("--data=")) {
      if (sawData) return { kind: "error", message: "Only one --data flag is allowed" };
      body = parseDataFlag(token.slice("--data=".length));
      sawData = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return { kind: "help" };
    }
    if (token.startsWith("-")) {
      return { kind: "error", message: `Unknown option: ${token}` };
    }
    positionals.push(token);
  }

  if (positionals.length === 2 && positionals[1].startsWith("//")) {
    return {
      kind: "error",
      message:
        "Path must stay on the configured server origin (protocol-relative // paths are rejected)",
    };
  }

  const raw = rawRequest(positionals);
  if (raw) {
    return {
      kind: "request",
      server,
      params,
      headers,
      body,
      target: { kind: "raw", method: raw.method, path: raw.path },
    };
  }

  if (positionals.length === 1) {
    // Bare HTTP method without a path is a user error, not an operation id.
    if (methods.has(positionals[0].toLowerCase())) {
      return {
        kind: "error",
        message: "Expected an HTTP method and path (example: GET /api/queue)",
      };
    }
    return {
      kind: "request",
      server,
      params,
      headers,
      body,
      target: { kind: "operation", operationId: positionals[0] },
    };
  }

  return {
    kind: "error",
    message:
      "Expected an operation ID or an HTTP method and path (example: GET /api/queue or health.getHealth)",
  };
}

export const API_CLI_HELP = `say-to-me api — call a running Say To Me HTTP API

Usage:
  say-to-me api list
  say-to-me api help OPERATION_ID
  say-to-me api METHOD PATH
  say-to-me api OPERATION_ID [--param name=value ...]
  say-to-me api --server <url> METHOD PATH
  say-to-me api POST /api/... --data '{"...":true}'
  say-to-me api POST /api/... --data=- < body.json

Examples:
  say-to-me api list
  say-to-me api help message-create.createSessionMessage
  say-to-me api GET /api/queue
  say-to-me api GET /api/health
  say-to-me api health.getHealth
  say-to-me api queue.getSessionQueue --param sessionId=ses_1dd864100ffes6uqv2NbJatAKt
  say-to-me api POST /api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages \\
    --data '{"author":"agent","text":"hello"}'
  echo '{"author":"agent","text":"hello"}' | \\
    say-to-me api POST /api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages --data=-
  say-to-me api GET /api/health -H 'Accept: application/json'

Server URL:
  --server <url>     Override base URL (no automatic server start)
  SAY_TO_ME_URL      Env default when --server is omitted
  default            ${DEFAULT_SAY_TO_ME_URL}

Flags:
  --param name=value Path template or query parameter (repeatable)
  --header / -H      Request header as name:value (repeatable)
  --data / -d        Request body string; use - or @- to read stdin

OpenAPI:
  Operation IDs resolve via live GET ${OPENAPI_PATH} on the configured server.
  --param values fill {path} templates; unused params become query string.
  \`api list\` prints operationId + METHOD + path (+ summary) grouped from live /openapi.json.
  \`api help OPERATION_ID\` prints required --param flags and a copy-paste example.
  Prefer \`api help …\` over \`api … --help\` — Vite+ steals \`--help\` from \`vp node\`.

Body:
  When --data is set and Content-Type is omitted, defaults to application/json.

Output:
  Writes the response body to stdout (jq-friendly JSON when the API returns JSON).
  On non-2xx: exit non-zero; body stays on stdout; stderr prints HTTP <status> plus a recovery hint
  (prefer \`say-to-me api help OPERATION_ID\`).
`;
