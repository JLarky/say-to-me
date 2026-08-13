import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { externalCliStateRoot } from "../external-cli/state-root.ts";
import { claudeSessionUuid } from "../session-id.ts";
import { getSession } from "../sessions.ts";
import { canonicalCwd, claudeSessionFilePath } from "./delivery.ts";

const ClaudeCwdEntry = arktype({
  "cwd?": "string",
});

/** Find a Claude session jsonl by chat id across all project folders. */
export function claudeSessionJsonlPath(chatId: string): string | null {
  const projectsRoot = path.join(externalCliStateRoot(), ".claude", "projects");
  if (!existsSync(projectsRoot)) return null;
  for (const projectDir of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!projectDir.isDirectory()) continue;
    const jsonlPath = path.join(projectsRoot, projectDir.name, `${chatId}.jsonl`);
    if (existsSync(jsonlPath)) return jsonlPath;
  }
  return null;
}

/** Prefer cwd-based path when it exists; otherwise scan Claude project dirs. */
export function resolveClaudeSessionJsonlPath(sessionId: string): string | null {
  const cwd = getSession(sessionId)?.cwd;
  if (cwd) {
    const fromCwd = claudeSessionFilePath(canonicalCwd(cwd), sessionId);
    if (existsSync(fromCwd)) return fromCwd;
  }
  return claudeSessionJsonlPath(claudeSessionUuid(sessionId));
}

/** Read cwd from Claude session jsonl lines (user/attachment records carry cwd). */
export function claudeCwdFromSessionPath(sessionPath: string): string | null {
  try {
    for (const line of readFileSync(sessionPath, "utf8").split("\n").slice(0, 100)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const entry = safeJsonParse(ClaudeCwdEntry, trimmed);
      const cwd = entry?.cwd?.trim();
      if (cwd) return cwd;
    }
    return null;
  } catch {
    return null;
  }
}
