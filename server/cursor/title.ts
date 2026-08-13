import { readFileSync } from "node:fs";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { cursorChatMetaPath } from "../external-cli/resolve-provider.ts";
import { cursorSessionUuid } from "../session-id.ts";

const CursorChatMeta = arktype({
  title: "string",
});

export function parseCursorMetaTitle(json: string): string | null {
  try {
    const entry = safeJsonParse(CursorChatMeta, json);
    if (!entry) return null;
    const title = entry.title.trim();
    return title || null;
  } catch {
    return null;
  }
}

function cursorMetaFilePath(chatId: string): string | null {
  return cursorChatMetaPath(chatId);
}

/** Pure reader (no internal cache). The SessionTitle Layer owns caching via Ref+Clock. */
export function readCursorTitle(sessionId: string): string | null {
  try {
    const metaPath = cursorMetaFilePath(cursorSessionUuid(sessionId));
    if (metaPath) return parseCursorMetaTitle(readFileSync(metaPath, "utf8"));
  } catch {}
  return null;
}

/** @deprecated use readCursorTitle + SessionTitle service for cached access */
export function getCursorTitle(sessionId: string): string | null {
  return readCursorTitle(sessionId);
}
