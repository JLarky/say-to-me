import { desc, eq, ne } from "drizzle-orm";
import { sessions, spaceSessions, spaces } from "./db/drizzle-schema.ts";
import { drizzleDb } from "./db/index.ts";
import { peekInMemoryProviderTitle } from "./session-enrich.ts";
import {
  normalizeQuickSearchQuery,
  QUICK_SEARCH_RESULT_LIMIT,
  rankQuickSearchSessions,
  rankQuickSearchSpaces,
  type QuickSearchSessionCandidate,
  type QuickSearchSpaceCandidate,
} from "./quick-search-rank.ts";

export type QuickSearchPayload = {
  query: string;
  sessions: ReturnType<typeof rankQuickSearchSessions>;
  spaces: ReturnType<typeof rankQuickSearchSpaces>;
};

export { peekInMemoryProviderTitle };

function ownerBySessionId(sessionIds: string[]): Map<string, { id: string; name: string }> {
  const map = new Map<string, { id: string; name: string }>();
  if (sessionIds.length === 0) return map;
  const idSet = new Set(sessionIds);
  const rows = drizzleDb
    .select({
      sessionId: spaceSessions.sessionId,
      spaceId: spaces.id,
      spaceName: spaces.name,
      archived: spaces.archived,
    })
    .from(spaceSessions)
    .innerJoin(spaces, eq(spaces.id, spaceSessions.spaceId))
    .all()
    .filter((row) => idSet.has(row.sessionId));
  for (const row of rows) {
    if (row.archived) continue;
    if (map.has(row.sessionId)) continue;
    map.set(row.sessionId, { id: row.spaceId, name: row.spaceName });
  }
  return map;
}

function toSessionCandidate(
  row: {
    id: string;
    alias: string | null;
    durableTitle: string | null;
    cwd: string | null;
    state: string;
    updatedAt: string;
  },
  owners: Map<string, { id: string; name: string }>,
): QuickSearchSessionCandidate {
  const owner = owners.get(row.id);
  return {
    id: row.id,
    alias: row.alias ?? null,
    durableTitle: row.durableTitle ?? null,
    cachedTitle: peekInMemoryProviderTitle(row.id),
    cwd: row.cwd ?? null,
    state: row.state,
    updatedAt: row.updatedAt,
    ownerSpaceId: owner?.id ?? null,
    ownerSpaceName: owner?.name ?? null,
  };
}

/** All compact session rows — ranked in process so exact/prefix tiers cannot be capped away. */
function loadAllSessionCandidates(): QuickSearchSessionCandidate[] {
  const rows = drizzleDb
    .select({
      id: sessions.id,
      alias: sessions.alias,
      durableTitle: sessions.opencodeProjectName,
      cwd: sessions.cwd,
      state: sessions.state,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .all();
  const owners = ownerBySessionId(rows.map((r) => r.id));
  return rows.map((row) => toSessionCandidate(row, owners));
}

function loadRecentSessionCandidates(): QuickSearchSessionCandidate[] {
  const rows = drizzleDb
    .select({
      id: sessions.id,
      alias: sessions.alias,
      durableTitle: sessions.opencodeProjectName,
      cwd: sessions.cwd,
      state: sessions.state,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .where(ne(sessions.state, "archived"))
    .orderBy(desc(sessions.updatedAt))
    .limit(QUICK_SEARCH_RESULT_LIMIT)
    .all();
  const owners = ownerBySessionId(rows.map((r) => r.id));
  return rows.map((row) => toSessionCandidate(row, owners));
}

function loadAllSpaceCandidates(): QuickSearchSpaceCandidate[] {
  return drizzleDb
    .select({
      id: spaces.id,
      name: spaces.name,
      context: spaces.context,
      updatedAt: spaces.updatedAt,
    })
    .from(spaces)
    .where(eq(spaces.archived, 0))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      context: row.context,
      updatedAt: row.updatedAt,
    }));
}

function loadRecentSpaceCandidates(): QuickSearchSpaceCandidate[] {
  return drizzleDb
    .select({
      id: spaces.id,
      name: spaces.name,
      context: spaces.context,
      updatedAt: spaces.updatedAt,
    })
    .from(spaces)
    .where(eq(spaces.archived, 0))
    .orderBy(desc(spaces.updatedAt))
    .limit(QUICK_SEARCH_RESULT_LIMIT)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      context: row.context,
      updatedAt: row.updatedAt,
    }));
}

/**
 * Compact quick-search: durable DB fields + already-in-memory OpenCode title Map only.
 * Never triggers provider network/disk discovery for titles.
 */
export function runQuickSearch(
  rawQuery: string | undefined,
  currentSpaceId?: string | null,
): QuickSearchPayload {
  const query = normalizeQuickSearchQuery(rawQuery);
  if (!query) {
    return {
      query: "",
      sessions: rankQuickSearchSessions("", loadRecentSessionCandidates(), currentSpaceId),
      spaces: rankQuickSearchSpaces("", loadRecentSpaceCandidates(), currentSpaceId),
    };
  }

  return {
    query,
    sessions: rankQuickSearchSessions(query, loadAllSessionCandidates(), currentSpaceId),
    spaces: rankQuickSearchSpaces(query, loadAllSpaceCandidates(), currentSpaceId),
  };
}
