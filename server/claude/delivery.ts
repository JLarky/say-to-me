import { existsSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { claudeDeliveryJobs } from "../db/drizzle-schema.ts";
import { drizzleDb } from "../db/index.ts";
import { canonicalCwd } from "../external-cli/canonical-cwd.ts";
import { externalCliStateRoot } from "../external-cli/state-root.ts";
import { claudeSessionUuid } from "../session-id.ts";
import { getSession } from "../sessions.ts";

export { canonicalCwd } from "../external-cli/canonical-cwd.ts";

export type ClaudeSessionFlag = ["--resume" | "--session-id", string];

/**
 * Claude Code stores sessions under a per-cwd project dir.
 * Both `/` and `.` become `-` (e.g. `/home/u.v/.app` → `-home-u-v--app`).
 */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

export function claudeSessionFilePath(cwd: string, sessionId: string): string {
  return path.join(
    externalCliStateRoot(),
    ".claude",
    "projects",
    claudeProjectDirName(cwd),
    `${claudeSessionUuid(sessionId)}.jsonl`,
  );
}

export type ClaudeTranscriptFsDeps = {
  existsSync?: (path: string) => boolean;
  readdirSync?: (path: string, options: { withFileTypes: true }) => Dirent[];
};

export function claudeTranscriptExistsAnywhere(
  sessionId: string,
  deps: ClaudeTranscriptFsDeps = {},
): boolean {
  const exists = deps.existsSync ?? existsSync;
  const readdir = deps.readdirSync ?? readdirSync;
  const uuid = claudeSessionUuid(sessionId);
  const projectsRoot = path.join(externalCliStateRoot(), ".claude", "projects");
  if (!exists(projectsRoot)) return false;
  let entries: Dirent[];
  try {
    // existsSync can race; readdir may also fail on permissions — never throw into Effect.async.
    entries = readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const projectDir of entries) {
    if (!projectDir.isDirectory()) continue;
    if (exists(path.join(projectsRoot, projectDir.name, `${uuid}.jsonl`))) return true;
  }
  return false;
}

export function claudeTranscriptExists(
  cwd: string,
  sessionId: string,
  deps: ClaudeTranscriptFsDeps = {},
): boolean {
  const exists = deps.existsSync ?? existsSync;
  if (exists(claudeSessionFilePath(canonicalCwd(cwd), sessionId))) return true;
  // Fallback for encoding drift / alternate project slugs (lima path remaps, older helpers).
  return claudeTranscriptExistsAnywhere(sessionId, deps);
}

/**
 * Resume when the Claude transcript already exists; otherwise create with this exact id.
 *
 * Brand-new Jarvis/Claude sessions allocate a local `cc_<uuid>` before any Claude
 * conversation exists. `--resume` then fails with "No conversation found". `--session-id`
 * creates the conversation on first delivery. Once the jsonl exists, prefer `--resume`
 * (otherwise Claude errors with "Session ID … is already in use").
 */
export function resolveClaudeSessionFlag(
  cwd: string,
  sessionId: string,
  deps: ClaudeTranscriptFsDeps = {},
): ClaudeSessionFlag {
  const uuid = claudeSessionUuid(sessionId);
  return claudeTranscriptExists(cwd, sessionId, deps) ? ["--resume", uuid] : ["--session-id", uuid];
}

export function resolveClaudeModel(_cwd: string, sessionId: string): string | null {
  const session = getSession(sessionId);
  return session?.opencodeSelectedModel || null;
}

export function isClaudeSessionBusy(sessionId: string): boolean {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(claudeDeliveryJobs)
    .where(
      and(
        eq(claudeDeliveryJobs.claudeSessionId, sessionId),
        eq(claudeDeliveryJobs.status, "running"),
      ),
    )
    .get();
  return (row?.count ?? 0) > 0;
}
