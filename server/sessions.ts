import { desc, eq, sql } from "drizzle-orm";
import { messages, sessions as sessionsTable } from "./db/drizzle-schema.ts";
import { drizzleDb } from "./db/index.ts";
import { DbSession, validateDb } from "./db/schemas.ts";
import { getCachedOpenCodeStatus } from "./opencode/cache.ts";
import { enrichSessionForList } from "./session-enrich.ts";
import { getOrganization } from "./session-folders.ts";
import { detectSessionBackend, sessionHref } from "./session-id.ts";
import { startPaseoChatListener, stopPaseoChatListener } from "./paseo/chat-listener-lifecycle.ts";
import { paseoUiUrlsForSession } from "./paseo/ui.ts";

const sessionSelectColumns = {
  id: sessionsTable.id,
  state: sessionsTable.state,
  alias: sessionsTable.alias,
  revision: sessionsTable.revision,
  createdAt: sessionsTable.createdAt,
  updatedAt: sessionsTable.updatedAt,
  opencodeProjectId: sessionsTable.opencodeProjectId,
  opencodeWorkspaceId: sessionsTable.opencodeWorkspaceId,
  opencodeDirectory: sessionsTable.opencodeDirectory,
  opencodeWorktree: sessionsTable.opencodeWorktree,
  opencodePath: sessionsTable.opencodePath,
  opencodeProjectName: sessionsTable.opencodeProjectName,
  opencodeBranch: sessionsTable.opencodeBranch,
  opencodeSelectedModelProvider: sessionsTable.opencodeSelectedModelProvider,
  opencodeSelectedModel: sessionsTable.opencodeSelectedModel,
  reasoningEffort: sessionsTable.reasoningEffort,
  cwd: sessionsTable.cwd,
  t3InstanceId: sessionsTable.t3InstanceId,
  paseoInstanceId: sessionsTable.paseoInstanceId,
};

export function getSession(sessionId: string): DbSession | null {
  const row = drizzleDb
    .select(sessionSelectColumns)
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1)
    .get();
  return row ? validateDb(DbSession, row, "getSession") : null;
}

export function requireSession(sessionId: string): DbSession {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

export function ensureSession(sessionId: string): DbSession {
  drizzleDb
    .insert(sessionsTable)
    .values({ id: sessionId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .onConflictDoUpdate({
      target: sessionsTable.id,
      set: { updatedAt: sql`CURRENT_TIMESTAMP` },
    })
    .run();
  return requireSession(sessionId);
}

export function setSessionCwd(sessionId: string, cwd: string | null): DbSession {
  ensureSession(sessionId);
  drizzleDb
    .update(sessionsTable)
    .set({ cwd, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(sessionsTable.id, sessionId))
    .run();
  return requireSession(sessionId);
}

export function setSessionT3InstanceId(sessionId: string, t3InstanceId: string | null): DbSession {
  ensureSession(sessionId);
  drizzleDb
    .update(sessionsTable)
    .set({ t3InstanceId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(sessionsTable.id, sessionId))
    .run();
  return requireSession(sessionId);
}

export function setSessionPaseoInstanceId(
  sessionId: string,
  paseoInstanceId: string | null,
): DbSession {
  ensureSession(sessionId);
  drizzleDb
    .update(sessionsTable)
    .set({ paseoInstanceId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(sessionsTable.id, sessionId))
    .run();
  return requireSession(sessionId);
}

export function touchSessionRevision(sessionId: string): DbSession {
  ensureSession(sessionId);
  drizzleDb
    .update(sessionsTable)
    .set({ revision: sql`${sessionsTable.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(sessionsTable.id, sessionId))
    .run();
  return requireSession(sessionId);
}

export function getSessionByAlias(alias: string): DbSession | null {
  const trimmed = alias.trim();
  if (!trimmed) return null;
  const row = drizzleDb
    .select(sessionSelectColumns)
    .from(sessionsTable)
    .where(sql`lower(${sessionsTable.alias}) = lower(${trimmed})`)
    .limit(1)
    .get();
  return row ? validateDb(DbSession, row, "getSessionByAlias") : null;
}

export function setSessionAliasIfSafe(sessionId: string, alias: string): void {
  updateSessionAlias(sessionId, alias);
}

export function updateSessionAlias(
  sessionId: string,
  alias: string | null,
): { ok: true } | { ok: false; error: string } {
  ensureSession(sessionId);
  const trimmed = alias?.trim() ?? "";
  if (!trimmed) {
    drizzleDb
      .update(sessionsTable)
      .set({ alias: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(sessionsTable.id, sessionId))
      .run();
    return { ok: true };
  }
  if (trimmed.length > 80) {
    return { ok: false, error: "Session aliases must be 80 characters or fewer." };
  }
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, error: "Session aliases must be a single line." };
  }

  const existing = drizzleDb
    .select(sessionSelectColumns)
    .from(sessionsTable)
    .where(sql`lower(${sessionsTable.alias}) = lower(${trimmed})`)
    .limit(1)
    .get();
  if (existing) {
    const existingSession = validateDb(DbSession, existing, "getSessionByAlias");
    if (existingSession.id !== sessionId) {
      return { ok: false, error: "That alias is already used by another session." };
    }
  }

  drizzleDb
    .update(sessionsTable)
    .set({ alias: trimmed, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(sessionsTable.id, sessionId))
    .run();
  return { ok: true };
}

export function listSessions({
  includeCachedStatus = false,
  includeJarvisOverviewDetails = false,
} = {}) {
  const rows = drizzleDb
    .select({
      ...sessionSelectColumns,
      messageCount: sql<number>`COUNT(${messages.id})`,
      latestMessageText: sql<string | null>`(
        SELECT text FROM messages latest
        WHERE latest.session_id = ${sessionsTable.id}
        ORDER BY latest.id DESC
        LIMIT 1
      )`,
      latestMessageAuthor: sql<"agent" | "user" | null>`(
        SELECT author FROM messages latest
        WHERE latest.session_id = ${sessionsTable.id}
        ORDER BY latest.id DESC
        LIMIT 1
      )`,
      latestMessageCreatedAt: sql<string | null>`(
        SELECT created_at FROM messages latest
        WHERE latest.session_id = ${sessionsTable.id}
        ORDER BY latest.id DESC
        LIMIT 1
      )`,
      latestOpencodeDeliveryStatus: sql<string | null>`(
        SELECT opencode_delivery_status FROM messages latest
        WHERE latest.session_id = ${sessionsTable.id}
        ORDER BY latest.id DESC
        LIMIT 1
      )`,
      latestForwardStatus: sql<string | null>`(
        SELECT forward_status FROM messages latest
        WHERE latest.session_id = ${sessionsTable.id}
        ORDER BY latest.id DESC
        LIMIT 1
      )`,
      latestCompletionWatchStatus: sql<string | null>`(
        SELECT completion_watch_status FROM messages latest
        WHERE latest.session_id = ${sessionsTable.id}
        ORDER BY latest.id DESC
        LIMIT 1
      )`,
    })
    .from(sessionsTable)
    .leftJoin(messages, eq(messages.sessionId, sessionsTable.id))
    .groupBy(sessionsTable.id)
    .orderBy(desc(sessionsTable.updatedAt), desc(sessionsTable.createdAt))
    .all();
  const organization = getOrganization();
  return rows.map((row) => {
    const {
      latestMessageText,
      latestMessageAuthor,
      latestMessageCreatedAt,
      latestOpencodeDeliveryStatus,
      latestForwardStatus,
      latestCompletionWatchStatus,
      ...sessionRow
    } = row;
    const session = validateDb(DbSession, sessionRow, "allSessions");
    const cachedStatus = includeCachedStatus ? getCachedOpenCodeStatus(session.id) : null;
    const enriched = enrichSessionForList(session.id, organization);
    const paseoUiUrls = paseoUiUrlsForSession(session);
    const base = {
      ...session,
      href: sessionHref(session.id),
      backend: detectSessionBackend(session.id),
      ...paseoUiUrls,
      opencodeTitle: enriched.opencodeTitle,
      organizePath: enriched.organizePath,
    };
    const withStatus = cachedStatus ? { ...base, opencodeStatus: cachedStatus } : base;
    const withJarvisDetails = includeJarvisOverviewDetails
      ? {
          ...withStatus,
          jarvisOverviewDetails: {
            latestMessageText,
            latestMessageAuthor,
            latestMessageCreatedAt,
            latestOpencodeDeliveryStatus,
            latestForwardStatus,
            latestCompletionWatchStatus,
          },
        }
      : withStatus;
    return {
      ...withJarvisDetails,
      opencodeAgent: enriched.opencodeAgent,
      opencodeModelProvider: enriched.opencodeModelProvider,
      opencodeModel: enriched.opencodeModel,
    };
  });
}

export function updateSessionState(sessionId: string, state: string): void {
  drizzleDb
    .update(sessionsTable)
    .set({ state, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(sessionsTable.id, sessionId))
    .run();
  if (detectSessionBackend(sessionId) === "paseo-chat") {
    if (state === "archived") stopPaseoChatListener(sessionId);
    else startPaseoChatListener(sessionId);
  }
}

export function updateSessionOpenCodeModel(
  sessionId: string,
  providerId: string,
  modelId: string,
): void {
  drizzleDb
    .update(sessionsTable)
    .set({
      opencodeSelectedModelProvider: providerId,
      opencodeSelectedModel: modelId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(sessionsTable.id, sessionId))
    .run();
}

export function updateSessionModelAndReasoningEffort(
  sessionId: string,
  providerId: string,
  modelId: string,
  reasoningEffort: string | null,
): void {
  drizzleDb.transaction((tx) => {
    tx.update(sessionsTable)
      .set({
        opencodeSelectedModelProvider: providerId,
        opencodeSelectedModel: modelId,
        reasoningEffort,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(sessionsTable.id, sessionId))
      .run();
  });
}

export function updateSessionReasoningEffort(
  sessionId: string,
  reasoningEffort: string | null,
): void {
  drizzleDb
    .update(sessionsTable)
    .set({ reasoningEffort, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(sessionsTable.id, sessionId))
    .run();
}

export function setOpenCodeContext(
  sessionId: string,
  context: {
    projectId: string | null;
    workspaceId: string | null;
    directory: string | null;
    worktree: string | null;
    path: string | null;
    projectName: string | null;
    branch: string | null;
  },
): void {
  drizzleDb
    .update(sessionsTable)
    .set({
      opencodeProjectId: context.projectId,
      opencodeWorkspaceId: context.workspaceId,
      opencodeDirectory: context.directory,
      cwd: context.directory,
      opencodeWorktree: context.worktree,
      opencodePath: context.path,
      opencodeProjectName: context.projectName,
      opencodeBranch: context.branch,
    })
    .where(eq(sessionsTable.id, sessionId))
    .run();
}

export function deleteSessionMessages(sessionId: string): void {
  drizzleDb.delete(messages).where(eq(messages.sessionId, sessionId)).run();
}

export function deleteSession(sessionId: string): void {
  if (sessionId === "default") return;
  stopPaseoChatListener(sessionId);
  drizzleDb.delete(sessionsTable).where(eq(sessionsTable.id, sessionId)).run();
}
