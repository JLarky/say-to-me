import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";

const DEFAULT_INTERNAL_URL = "https://say.local:1355";

const AstroDevJson = arktype({
  "port?": "number",
  "url?": "string",
});

export type ResolveWorkerInternalUrlOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string, encoding: "utf8") => string;
};

function isSharedPortlessUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "say.local" || hostname.endsWith(".local");
  } catch {
    return false;
  }
}

function readAstroDevLoopbackUrl(
  cwd: string,
  exists: (path: string) => boolean,
  read: (path: string, encoding: "utf8") => string,
): string | null {
  const astroDevPath = path.join(cwd, ".astro", "dev.json");
  if (!exists(astroDevPath)) return null;
  let text: string;
  try {
    text = read(astroDevPath, "utf8");
  } catch {
    // existsSync can race or lie (permissions, disappearing file); keep configured URL.
    return null;
  }
  const raw = safeJsonParse(AstroDevJson, text);
  if (!raw) return null;
  if (typeof raw.port === "number" && Number.isFinite(raw.port) && raw.port > 0) {
    return `http://127.0.0.1:${raw.port}`;
  }
  if (typeof raw.url === "string" && /^https?:\/\//i.test(raw.url)) {
    return raw.url.replace(/\/$/, "");
  }
  return null;
}

/**
 * URL workers should use for claim/complete.
 *
 * Isolated `vp run dev` worktrees often inherit `SAY_TO_ME_INTERNAL_URL=https://say.local:1355`
 * while listening on a different port/checkout. Prefer this process's Astro listen port in that
 * case so claim resolves flags with the same code that enqueued the job.
 */
export function resolveWorkerInternalUrl(options: ResolveWorkerInternalUrlOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const exists = options.existsSync ?? existsSync;
  const read = options.readFileSync ?? readFileSync;
  const configured = (env.SAY_TO_ME_INTERNAL_URL ?? DEFAULT_INTERNAL_URL).replace(/\/$/, "");
  const local = readAstroDevLoopbackUrl(cwd, exists, read);
  if (local && isSharedPortlessUrl(configured)) return local;
  return configured;
}

export function listenPortFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) return parsed.port;
    if (parsed.protocol === "https:") return "443";
    if (parsed.protocol === "http:") return "80";
    return null;
  } catch {
    return null;
  }
}

/**
 * Origins agents should treat as the live shared instance.
 * Isolated `vp run dev` ports (e.g. 5412) must pass `--server` on every CLI call
 * and use port-prefixed Boo names (`stm_5412_<id>`).
 */
export function isNonLiveAgentCliOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "say.local" || hostname.endsWith(".local")) return false;
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    if (port === "5411" || port === "1355") return false;
    // Test dummy used by the API harness / vitest db setup — not a real instance.
    if (hostname === "127.0.0.1" && port === "1") return false;
    return true;
  } catch {
    return false;
  }
}

export function resolveAgentCliServerUrl(
  options: ResolveWorkerInternalUrlOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const fromEnv = (env.SAY_TO_ME_URL ?? "").replace(/\/$/, "");
  if (fromEnv && isNonLiveAgentCliOrigin(fromEnv)) return fromEnv;
  const internal = resolveWorkerInternalUrl({ ...options, env });
  if (internal && isNonLiveAgentCliOrigin(internal)) return internal;
  return null;
}

export function booWorkerNameForSession(
  sessionId: string,
  options: ResolveWorkerInternalUrlOptions = {},
): string {
  const origin = resolveWorkerInternalUrl(options);
  if (!isNonLiveAgentCliOrigin(origin)) return `stm-${sessionId}`;
  const port = listenPortFromUrl(origin);
  if (!port) return `stm-${sessionId}`;
  return `stm_${port}_${sessionId}`;
}
