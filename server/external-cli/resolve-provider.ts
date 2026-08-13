import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { Effect } from "effect";
import { claudeProjectDirName } from "../claude/delivery.ts";
import { claudeCwdFromSessionPath, claudeSessionJsonlPath } from "../claude/resolve.ts";
import { codexCwdFromSessionPath, codexSessionJsonlPath } from "../codex/resolve.ts";
import { cursorProjectDirName } from "../cursor/delivery.ts";
import type { DbSession } from "../db/schemas.ts";
import { getSession, setSessionCwd } from "../sessions.ts";
import { importNotFoundError, type ImportNotFoundError } from "../session-import-error.ts";
import { externalCliBackend, type ExternalCliBackend } from "./session-backend.ts";
import { externalCliStateRoot } from "./state-root.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CursorChatMeta = arktype({
  "cwd?": "string",
});

export function isBareExternalCliUuid(input: string): boolean {
  return UUID.test(input.trim());
}

function chatIdFromInput(input: string): { chatId: string; provider: ExternalCliBackend | null } {
  const trimmed = input.trim();
  if (trimmed.startsWith("cc_")) return { chatId: trimmed.slice(3), provider: "claude" };
  if (trimmed.startsWith("cur_")) return { chatId: trimmed.slice(4), provider: "cursor" };
  if (trimmed.startsWith("cx_")) return { chatId: trimmed.slice(3), provider: "codex" };
  if (trimmed.startsWith("gr_")) return { chatId: trimmed.slice(3), provider: "grok" };
  return { chatId: trimmed, provider: null };
}

export function cursorChatMetaPath(chatId: string): string | null {
  const chatsRoot = path.join(externalCliStateRoot(), ".cursor", "chats");
  if (!existsSync(chatsRoot)) return null;
  for (const hashDir of readdirSync(chatsRoot, { withFileTypes: true })) {
    if (!hashDir.isDirectory()) continue;
    const metaPath = path.join(chatsRoot, hashDir.name, chatId, "meta.json");
    if (existsSync(metaPath)) return metaPath;
  }
  return null;
}

function cursorCwdFromChatMeta(chatId: string): string | null {
  const metaPath = cursorChatMetaPath(chatId);
  if (!metaPath) return null;
  try {
    const meta = safeJsonParse(CursorChatMeta, readFileSync(metaPath, "utf8"));
    return meta?.cwd?.trim() || null;
  } catch {
    return null;
  }
}

export function cursorTranscriptPath(chatId: string): string | null {
  const projectsRoot = path.join(externalCliStateRoot(), ".cursor", "projects");
  if (!existsSync(projectsRoot)) return null;
  for (const projectDir of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!projectDir.isDirectory()) continue;
    const jsonlPath = path.join(
      projectsRoot,
      projectDir.name,
      "agent-transcripts",
      chatId,
      `${chatId}.jsonl`,
    );
    if (existsSync(jsonlPath)) return jsonlPath;
  }
  return null;
}

export function grokTranscriptPathForChat(chatId: string): string | null {
  const sessionsRoot = path.join(externalCliStateRoot(), ".grok", "sessions");
  if (!existsSync(sessionsRoot)) return null;
  for (const projDir of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!projDir.isDirectory()) continue;
    const p = path.join(sessionsRoot, projDir.name, chatId, "chat_history.jsonl");
    if (existsSync(p)) return p;
  }
  return null;
}

function projectSlugFromSessionPath(sessionPath: string): string | null {
  const parts = sessionPath.split("/");
  let idx = parts.indexOf("projects");
  if (idx === -1) idx = parts.indexOf("sessions");
  if (idx === -1 || idx + 1 >= parts.length) return null;
  return parts[idx + 1] ?? null;
}

/** Invert project-dir encoding; segment names may contain dashes (e.g. say-to-me). */
export function cwdFromProjectSlug(slug: string, provider: ExternalCliBackend): string | null {
  const encode = provider === "cursor" ? cursorProjectDirName : claudeProjectDirName;

  function backtrack(remaining: string, segments: string[]): string | null {
    if (remaining === "") {
      const segs = segments[0]?.startsWith("-")
        ? [segments[0].slice(1), ...segments.slice(1)]
        : segments;
      const candidate = `/${segs.join("/")}`;
      if (!existsSync(candidate)) return null;
      try {
        const resolved = realpathSync(candidate);
        return encode(resolved) === slug ? resolved : null;
      } catch {
        return encode(candidate) === slug ? candidate : null;
      }
    }
    for (let end = 1; end <= remaining.length; end += 1) {
      const head = remaining.slice(0, end);
      const rest = remaining.slice(end);
      if (rest !== "" && !rest.startsWith("-")) continue;
      const next = rest.startsWith("-") ? rest.slice(1) : rest;
      const found = backtrack(next, [...segments, head]);
      if (found) return found;
    }
    return null;
  }

  return backtrack(slug, []);
}

export function cwdFromSessionPath(
  sessionPath: string,
  provider: ExternalCliBackend,
): string | null {
  const slug = projectSlugFromSessionPath(sessionPath);
  if (!slug) return null;
  return cwdFromProjectSlug(slug, provider);
}

function resolveCursorCwd(chatId: string, sessionPath: string | null): string | null {
  return (
    cursorCwdFromChatMeta(chatId) ??
    (sessionPath ? cwdFromSessionPath(sessionPath, "cursor") : null)
  );
}

export type ResolvedExternalCli = {
  provider: ExternalCliBackend | null;
  ambiguous: boolean;
  cwd: string | null;
};

/** Resolve provider + cwd from local Claude/Cursor session files. */
export function resolveExternalCliSession(input: string): ResolvedExternalCli {
  const trimmed = input.trim();
  const { chatId, provider: forcedProvider } = chatIdFromInput(trimmed);
  if (!UUID.test(chatId)) return { provider: null, ambiguous: false, cwd: null };

  if (forcedProvider === "codex") {
    const sessionPath = codexSessionJsonlPath(chatId);
    const cwd =
      (sessionPath ? codexCwdFromSessionPath(sessionPath) : null) ??
      getSession(trimmed)?.cwd ??
      null;
    return { provider: "codex", ambiguous: false, cwd };
  }

  const hasCursor = cursorChatMetaPath(chatId) != null || cursorTranscriptPath(chatId) != null;
  const hasClaude = claudeSessionJsonlPath(chatId) != null;
  const hasCodex = codexSessionJsonlPath(chatId) != null;
  const hasGrok = grokTranscriptPathForChat(chatId) != null;

  let provider: ExternalCliBackend | null = forcedProvider;
  if (!provider) {
    const matches = [
      hasCursor ? ("cursor" as const) : null,
      hasClaude ? ("claude" as const) : null,
      hasCodex ? ("codex" as const) : null,
      hasGrok ? ("grok" as const) : null,
    ].filter((value): value is ExternalCliBackend => value != null);
    if (matches.length === 1) provider = matches[0]!;
    else if (matches.length > 1) return { provider: null, ambiguous: true, cwd: null };
    else return { provider: null, ambiguous: false, cwd: null };
  }

  const sessionPath =
    provider === "cursor"
      ? cursorTranscriptPath(chatId)
      : provider === "codex"
        ? codexSessionJsonlPath(chatId)
        : provider === "grok"
          ? grokTranscriptPathForChat(chatId)
          : claudeSessionJsonlPath(chatId);
  const slug = sessionPath ? projectSlugFromSessionPath(sessionPath) : null;
  let cwd: string | null = null;
  if (provider === "codex") {
    cwd = sessionPath ? codexCwdFromSessionPath(sessionPath) : null;
  } else if (provider === "cursor") {
    cwd = resolveCursorCwd(chatId, sessionPath);
  } else if (provider === "grok" && slug) {
    try {
      cwd = decodeURIComponent(slug);
    } catch {
      cwd = null;
    }
  } else if (provider === "claude" && sessionPath) {
    cwd =
      claudeCwdFromSessionPath(sessionPath) ??
      cwdFromSessionPath(sessionPath, provider) ??
      getSession(trimmed.startsWith("cc_") ? trimmed : `cc_${chatId}`)?.cwd ??
      null;
  } else if (sessionPath) {
    cwd = cwdFromSessionPath(sessionPath, provider);
  }
  return { provider, ambiguous: false, cwd };
}

/** @deprecated use resolveExternalCliSession */
export function resolveBareExternalCliUuid(input: string): ResolvedExternalCli {
  return resolveExternalCliSession(input);
}

/** Does a local transcript for this prefixed session id genuinely exist on disk? */
export function externalCliSessionExists(sessionId: string): boolean {
  const backend = externalCliBackend(sessionId);
  if (!backend) return false;
  const { chatId } = chatIdFromInput(sessionId);
  if (!UUID.test(chatId)) return false;
  switch (backend) {
    case "claude":
      return claudeSessionJsonlPath(chatId) != null;
    case "cursor":
      return cursorChatMetaPath(chatId) != null || cursorTranscriptPath(chatId) != null;
    case "codex":
      return codexSessionJsonlPath(chatId) != null;
    case "grok":
      return grokTranscriptPathForChat(chatId) != null;
  }
}

// Mirrors importOpenCodeSessionIfKnown (server/opencode/client.ts): confirms the
// session genuinely exists (here, via its local transcript file) before creating
// a row for it, so a plain 404 (typo, stale link) still doesn't auto-create one.
export function importExternalCliSessionIfKnown(
  sessionId: string,
): Effect.Effect<DbSession, ImportNotFoundError> {
  if (!externalCliSessionExists(sessionId)) return Effect.fail(importNotFoundError(sessionId));
  const { cwd } = resolveExternalCliSession(sessionId);
  return Effect.sync(() => setSessionCwd(sessionId, cwd));
}
