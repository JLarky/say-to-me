import { readFileSync } from "node:fs";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { codexSessionJsonlPath, CodexSessionMetaLine } from "./resolve.ts";
import { codexSessionUuid } from "../session-id.ts";

/** Pure reader (no cache). Used by the cached SessionTitle Layer. */
export function readCodexTitle(sessionId: string): string | null {
  try {
    const chatId = codexSessionUuid(sessionId);
    const sessionPath = codexSessionJsonlPath(chatId);
    if (!sessionPath) return null;
    const firstLine = readFileSync(sessionPath, "utf8").split("\n")[0];
    if (!firstLine) return null;
    const parsed = safeJsonParse(CodexSessionMetaLine, firstLine);
    if (!parsed || parsed.type !== "session_meta" || !parsed.payload?.git?.repository_url)
      return null;
    const repoName = repoNameFromUrl(parsed.payload.git.repository_url);
    const branch = parsed.payload.git.branch;
    if (!repoName) return null;
    if (branch && branch !== "main" && branch !== "master") {
      return `${repoName} (${branch})`;
    }
    return repoName;
  } catch {
    return null;
  }
}

function repoNameFromUrl(url: string): string | null {
  const name = url
    .replace(/\.git$/, "")
    .split("/")
    .pop();
  return name || null;
}

/** @deprecated use readCodexTitle + the SessionTitle service (which owns caching) */
export function getCodexTitle(sessionId: string, _now?: number): string | null {
  return readCodexTitle(sessionId);
}

export function clearCodexTitleCache(): void {
  // no-op: caching is now owned by the SessionTitle Layer (Ref + Clock)
}
