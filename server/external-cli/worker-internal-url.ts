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
