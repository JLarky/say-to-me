import type { DbSession } from "../db/schemas.ts";
import { canonicalCwd } from "./canonical-cwd.ts";
import {
  discoverExternalCliSessions,
  type DiscoverableExternalCliProvider,
} from "./discover-sessions.ts";
import { detectSessionBackend } from "../session-id.ts";
import { listSessions } from "../sessions.ts";
import { workspacePathStatus } from "../workspace.ts";

const DISCOVERABLE_PROVIDERS = ["claude", "codex", "cursor", "grok"] as const;

export type WorkspaceSessionContextSession = {
  id: string;
  provider: string;
  title: string | null;
};

export type WorkspaceSessionContext = {
  path: string;
  pathStatus: {
    exists: boolean;
    isDirectory: boolean;
    writable: boolean;
    creatable: boolean;
    parentPath: string | null;
  };
  providers: Record<
    DiscoverableExternalCliProvider,
    { importableCount: number; inAppCount: number }
  >;
  sessionsHere: WorkspaceSessionContextSession[];
  opencodeProject: { id: string; sessionCount: number } | null;
};

function normalizePath(path: string): string {
  return path.replace(/[/\\]+$/, "");
}

function resolvedPathKey(path: string): string {
  try {
    return normalizePath(canonicalCwd(path));
  } catch {
    return normalizePath(path);
  }
}

function sessionMatchesPath(session: DbSession, targetPath: string): boolean {
  const target = resolvedPathKey(targetPath);
  if (session.cwd && resolvedPathKey(session.cwd) === target) return true;
  if (session.opencodeDirectory && resolvedPathKey(session.opencodeDirectory) === target) {
    return true;
  }
  return false;
}

function sessionTitle(session: DbSession): string | null {
  return session.alias?.trim() || null;
}

function providerLabel(sessionId: string): string {
  const backend = detectSessionBackend(sessionId);
  switch (backend) {
    case "opencode":
      return "OpenCode";
    case "claude":
      return "Claude";
    case "cursor":
      return "Cursor";
    case "codex":
      return "Codex";
    case "grok":
      return "Grok";
    case "voice":
      return "Voice";
    default:
      return "Local";
  }
}

export function getWorkspaceSessionContext(
  workspacePathInput: string,
): { ok: true; context: WorkspaceSessionContext } | { ok: false; error: string } {
  const status = workspacePathStatus(workspacePathInput);
  if (!status.ok) return { ok: false, error: status.error };

  const allSessions = listSessions();
  const sessionsHere = allSessions
    .filter((session) => session.id !== "default" && sessionMatchesPath(session, status.path))
    .map((session) => ({
      id: session.id,
      provider: providerLabel(session.id),
      title: sessionTitle(session),
    }));

  // SAFETY: Object.fromEntries widens to Record<string, ...>, but the entries are
  // built by mapping the exhaustive DISCOVERABLE_PROVIDERS tuple 1:1, so every
  // DiscoverableExternalCliProvider key is present exactly once.
  const providers = Object.fromEntries(
    DISCOVERABLE_PROVIDERS.map((provider) => {
      let importable = 0;
      if (status.exists && status.isDirectory) {
        const discovered = discoverExternalCliSessions(provider, status.path);
        if (discovered.ok) {
          importable = discovered.sessions.filter((entry) => !entry.imported).length;
        }
      }
      const inAppCount = sessionsHere.filter((session) => {
        const backend = detectSessionBackend(session.id);
        return backend === provider;
      }).length;
      return [provider, { importableCount: importable, inAppCount }];
    }),
  ) as WorkspaceSessionContext["providers"];

  const pathMatch = allSessions.find(
    (session) => session.opencodeProjectId && sessionMatchesPath(session, status.path),
  );
  const opencodeProjectId = pathMatch?.opencodeProjectId ?? null;
  const opencodeProject = opencodeProjectId
    ? {
        id: opencodeProjectId,
        sessionCount: allSessions.filter(
          (session) => session.opencodeProjectId === opencodeProjectId,
        ).length,
      }
    : null;

  return {
    ok: true,
    context: {
      path: status.path,
      pathStatus: {
        exists: status.exists,
        isDirectory: status.isDirectory,
        writable: status.writable,
        creatable: status.creatable,
        parentPath: status.parentPath,
      },
      providers,
      sessionsHere,
      opencodeProject,
    },
  };
}
