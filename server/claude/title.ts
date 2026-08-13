import { existsSync, readFileSync } from "node:fs";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { claudeTitleCacheMs } from "../config.ts";
import { getSession } from "../sessions.ts";
import { canonicalCwd, claudeSessionFilePath } from "./delivery.ts";

const ClaudeAiTitleEntry = arktype({
  "type?": "string",
  "aiTitle?": "string",
});

const titleCache = new Map<string, { title: string | null; time: number }>();

export function parseAiTitle(jsonl: string): string | null {
  let title: string | null = null;
  for (const line of jsonl.split("\n")) {
    if (!line.includes('"aiTitle"')) continue;
    try {
      const entry = safeJsonParse(ClaudeAiTitleEntry, line.trim());
      if (entry?.aiTitle?.trim()) {
        title = entry.aiTitle.trim();
      }
    } catch {}
  }
  return title;
}

/** Pure reader (no internal cache). The SessionTitle Layer owns caching via Ref+Clock. */
export function readClaudeTitle(sessionId: string): string | null {
  try {
    const cwd = getSession(sessionId)?.cwd;
    if (cwd) {
      const filePath = claudeSessionFilePath(canonicalCwd(cwd), sessionId);
      if (existsSync(filePath)) return parseAiTitle(readFileSync(filePath, "utf8"));
    }
  } catch {}
  return null;
}

/** @deprecated use readClaudeTitle + the SessionTitle service (which owns caching) */
export function getClaudeTitle(sessionId: string, now = Date.now()): string | null {
  const cached = titleCache.get(sessionId);
  if (cached && now - cached.time < claudeTitleCacheMs) return cached.title;
  const title = readClaudeTitle(sessionId);
  titleCache.set(sessionId, { title, time: now });
  return title;
}
