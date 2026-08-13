import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { externalCliStateRoot } from "../external-cli/state-root.ts";
import { grokSessionUuid } from "../session-id.ts";
import { grokTitleCacheMs } from "../config.ts";

const titleCache = new Map<string, { title: string | null; time: number }>();

export function clearGrokTitleCache(): void {
  titleCache.clear();
}

function grokSummaryPath(chatId: string): string | null {
  const sessionsRoot = path.join(externalCliStateRoot(), ".grok", "sessions");
  if (!existsSync(sessionsRoot)) return null;
  for (const proj of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const p = path.join(sessionsRoot, proj.name, chatId, "summary.json");
    if (existsSync(p)) return p;
  }
  return null;
}

const GrokSummaryJson = arktype({ "title?": "string" });

/** Pure reader (no internal cache). The SessionTitle Layer owns caching via Ref+Clock. */
export function readGrokTitle(sessionId: string): string | null {
  try {
    const p = grokSummaryPath(grokSessionUuid(sessionId));
    if (p) {
      const data = safeJsonParse(GrokSummaryJson, readFileSync(p, "utf8"));
      const t = typeof data?.title === "string" ? data.title.trim() : "";
      return t || null;
    }
  } catch {}
  return null;
}

/** @deprecated use readGrokTitle + the SessionTitle service (which owns caching) */
export function getGrokTitle(sessionId: string, now = Date.now()): string | null {
  const cached = titleCache.get(sessionId);
  if (cached && now - cached.time < grokTitleCacheMs) return cached.title;
  const title = readGrokTitle(sessionId);
  titleCache.set(sessionId, { title, time: now });
  return title;
}
