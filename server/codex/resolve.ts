import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { externalCliStateRoot } from "../external-cli/state-root.ts";

/** Immutable once a rollout file exists; avoids re-walking on activity polls. */
const sessionJsonlPathByChatId = new Map<string, string>();
const missingSessionJsonlPathByChatId = new Map<string, number>();
const missingSessionJsonlPathCacheMs = 10_000;

export function clearCodexSessionJsonlPathCache(): void {
  sessionJsonlPathByChatId.clear();
  missingSessionJsonlPathByChatId.clear();
}

function findCodexSessionJsonlPath(chatId: string): string | null {
  const sessionsRoot = path.join(externalCliStateRoot(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return null;
  const suffix = `-${chatId}.jsonl`;

  function walk(dir: string): string | null {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        return full;
      }
    }
    return null;
  }

  return walk(sessionsRoot);
}

/** Codex rollout jsonl under ~/.codex/sessions (filename ends with -<chatId>.jsonl). */
export function codexSessionJsonlPath(chatId: string, now = Date.now()): string | null {
  const cached = sessionJsonlPathByChatId.get(chatId);
  if (cached) return cached;
  const missingCachedAt = missingSessionJsonlPathByChatId.get(chatId);
  if (missingCachedAt !== undefined && now - missingCachedAt < missingSessionJsonlPathCacheMs) {
    return null;
  }

  const found = findCodexSessionJsonlPath(chatId);
  if (found) {
    sessionJsonlPathByChatId.set(chatId, found);
    missingSessionJsonlPathByChatId.delete(chatId);
  } else {
    missingSessionJsonlPathByChatId.set(chatId, now);
  }
  return found;
}

export const CodexSessionMetaLine = arktype({
  "type?": "string",
  payload: {
    "cwd?": "string",
    "git?": {
      "repository_url?": "string",
      "branch?": "string",
    },
  },
});

export function codexCwdFromSessionPath(sessionPath: string): string | null {
  try {
    const firstLine = readFileSync(sessionPath, "utf8").split("\n")[0];
    if (!firstLine) return null;
    const parsed = safeJsonParse(CodexSessionMetaLine, firstLine);
    if (!parsed || parsed.type !== "session_meta") return null;
    const cwd = parsed.payload?.cwd?.trim();
    return cwd || null;
  } catch {
    return null;
  }
}
