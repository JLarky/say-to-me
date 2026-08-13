import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseAiTitle } from "../claude/title.ts";
import { readCodexTitle } from "../codex/title.ts";
import { codexCwdFromSessionPath } from "../codex/resolve.ts";
import { readCursorTitle } from "../cursor/title.ts";
import { cursorProjectDirName, cursorSessionFilePath } from "../cursor/delivery.ts";
import { readGrokTitle } from "../grok/title.ts";
import { grokProjectDirName, grokTranscriptPath } from "../grok/delivery.ts";
import { canonicalCwd } from "./canonical-cwd.ts";
import { claudeProjectDirName, claudeSessionFilePath } from "../claude/delivery.ts";
import { CLAUDE_SESSION, CODEX_SESSION, CURSOR_SESSION, GROK_SESSION } from "../session-id.ts";
import { prefixedUuidSessionId } from "./prefixed-session.ts";
import { externalCliStateRoot } from "./state-root.ts";
import { getSession } from "../sessions.ts";
import { normalizeWorkspacePath } from "../workspace.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DiscoverableExternalCliProvider = "claude" | "codex" | "cursor" | "grok";

export type DiscoverableExternalCliSession = {
  sessionId: string;
  chatId: string;
  title: string | null;
  modifiedAt: number | null;
  imported: boolean;
};

function cwdMatchesTarget(sessionCwd: string | null, targetCwd: string): boolean {
  if (!sessionCwd) return false;
  try {
    return canonicalCwd(sessionCwd) === canonicalCwd(targetCwd);
  } catch {
    return sessionCwd === targetCwd;
  }
}

function discoverClaudeSessions(targetCwd: string): DiscoverableExternalCliSession[] {
  const cwd = canonicalCwd(targetCwd);
  const projectDir = path.join(
    externalCliStateRoot(),
    ".claude",
    "projects",
    claudeProjectDirName(cwd),
  );
  if (!existsSync(projectDir)) return [];

  const sessions: DiscoverableExternalCliSession[] = [];
  for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const chatId = entry.name.slice(0, -".jsonl".length);
    if (!UUID.test(chatId)) continue;
    const sessionId = prefixedUuidSessionId(CLAUDE_SESSION, chatId);
    if (!sessionId) continue;
    const filePath = path.join(projectDir, entry.name);
    if (!existsSync(claudeSessionFilePath(cwd, sessionId))) continue;
    let title: string | null = null;
    let modifiedAt: number | null = null;
    try {
      title = parseAiTitle(readFileSync(filePath, "utf8"));
      modifiedAt = statSync(filePath).mtimeMs;
    } catch {
      // Keep the session discoverable even when metadata reads fail.
    }
    sessions.push({
      sessionId,
      chatId,
      title,
      modifiedAt,
      imported: getSession(sessionId) != null,
    });
  }
  return sessions;
}

function chatIdFromCodexFilename(filename: string): string | null {
  const match = filename.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
  );
  return match?.[1] ?? null;
}

function walkCodexSessions(
  dir: string,
  targetCwd: string,
  sessions: DiscoverableExternalCliSession[],
): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCodexSessions(full, targetCwd, sessions);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const chatId = chatIdFromCodexFilename(entry.name);
    if (!chatId) continue;
    const sessionCwd = codexCwdFromSessionPath(full);
    if (!cwdMatchesTarget(sessionCwd, targetCwd)) continue;
    const sessionId = prefixedUuidSessionId(CODEX_SESSION, chatId);
    if (!sessionId) continue;
    let modifiedAt: number | null = null;
    try {
      modifiedAt = statSync(full).mtimeMs;
    } catch {
      // Keep the session discoverable even when stat fails.
    }
    sessions.push({
      sessionId,
      chatId,
      title: readCodexTitle(sessionId),
      modifiedAt,
      imported: getSession(sessionId) != null,
    });
  }
}

function discoverCodexSessions(targetCwd: string): DiscoverableExternalCliSession[] {
  const sessionsRoot = path.join(externalCliStateRoot(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return [];
  const sessions: DiscoverableExternalCliSession[] = [];
  walkCodexSessions(sessionsRoot, targetCwd, sessions);
  return sessions;
}

function discoverCursorSessions(targetCwd: string): DiscoverableExternalCliSession[] {
  const cwd = canonicalCwd(targetCwd);
  const transcriptsRoot = path.join(
    externalCliStateRoot(),
    ".cursor",
    "projects",
    cursorProjectDirName(cwd),
    "agent-transcripts",
  );
  if (!existsSync(transcriptsRoot)) return [];

  const sessions: DiscoverableExternalCliSession[] = [];
  for (const entry of readdirSync(transcriptsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const chatId = entry.name;
    if (!UUID.test(chatId)) continue;
    const sessionId = prefixedUuidSessionId(CURSOR_SESSION, chatId);
    if (!sessionId) continue;
    if (!existsSync(cursorSessionFilePath(cwd, sessionId))) continue;
    let modifiedAt: number | null = null;
    try {
      modifiedAt = statSync(cursorSessionFilePath(cwd, sessionId)).mtimeMs;
    } catch {
      // Keep the session discoverable even when stat fails.
    }
    sessions.push({
      sessionId,
      chatId,
      title: readCursorTitle(sessionId),
      modifiedAt,
      imported: getSession(sessionId) != null,
    });
  }
  return sessions;
}

function discoverGrokSessions(targetCwd: string): DiscoverableExternalCliSession[] {
  const cwd = canonicalCwd(targetCwd);
  const projectDir = path.join(
    externalCliStateRoot(),
    ".grok",
    "sessions",
    grokProjectDirName(cwd),
  );
  if (!existsSync(projectDir)) return [];

  const sessions: DiscoverableExternalCliSession[] = [];
  for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const chatId = entry.name;
    if (!UUID.test(chatId)) continue;
    const sessionId = prefixedUuidSessionId(GROK_SESSION, chatId);
    if (!sessionId) continue;
    if (!existsSync(grokTranscriptPath(cwd, sessionId))) continue;
    let modifiedAt: number | null = null;
    try {
      modifiedAt = statSync(grokTranscriptPath(cwd, sessionId)).mtimeMs;
    } catch {
      // Keep the session discoverable even when stat fails.
    }
    sessions.push({
      sessionId,
      chatId,
      title: readGrokTitle(sessionId),
      modifiedAt,
      imported: getSession(sessionId) != null,
    });
  }
  return sessions;
}

function discoverSessionsForProvider(
  provider: DiscoverableExternalCliProvider,
  workspacePath: string,
): DiscoverableExternalCliSession[] {
  switch (provider) {
    case "claude":
      return discoverClaudeSessions(workspacePath);
    case "codex":
      return discoverCodexSessions(workspacePath);
    case "cursor":
      return discoverCursorSessions(workspacePath);
    case "grok":
      return discoverGrokSessions(workspacePath);
  }
}

function sortDiscoverableSessions(
  sessions: DiscoverableExternalCliSession[],
): DiscoverableExternalCliSession[] {
  return [...sessions].sort((left, right) => {
    const leftTime = left.modifiedAt ?? 0;
    const rightTime = right.modifiedAt ?? 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.sessionId.localeCompare(right.sessionId);
  });
}

export function discoverExternalCliSessions(
  provider: DiscoverableExternalCliProvider,
  workspacePathInput: string,
):
  | { ok: true; path: string; sessions: DiscoverableExternalCliSession[] }
  | { ok: false; error: string } {
  const workspacePath = normalizeWorkspacePath(workspacePathInput);
  if (!workspacePath) return { ok: false, error: "Enter a folder path." };
  if (!existsSync(workspacePath)) return { ok: false, error: "Folder does not exist." };
  try {
    if (!statSync(workspacePath).isDirectory()) {
      return { ok: false, error: "Path is not a folder." };
    }
  } catch {
    return { ok: false, error: "Unable to read folder." };
  }

  const sessions = discoverSessionsForProvider(provider, workspacePath);
  return { ok: true, path: workspacePath, sessions: sortDiscoverableSessions(sessions) };
}
