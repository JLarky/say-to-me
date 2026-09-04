import { resolveListDisplayName, workspaceBasename } from "../src/session-display.ts";
import { sessionHref } from "./session-id.ts";

export const MAX_QUICK_SEARCH_QUERY_LENGTH = 120;
export const QUICK_SEARCH_RESULT_LIMIT = 8;

export type QuickSearchMatchReason =
  | "exact-id"
  | "exact-alias"
  | "exact-title"
  | "exact-name"
  | "id-prefix"
  | "name-prefix"
  | "alias-prefix"
  | "title-prefix"
  | "token-prefix"
  | "substring-id"
  | "substring-alias"
  | "substring-title"
  | "substring-cwd"
  | "substring-name"
  | "substring-context"
  | "recent";

const TIER = {
  "exact-id": 0,
  "exact-alias": 1,
  "exact-title": 1,
  "exact-name": 1,
  "id-prefix": 2,
  "name-prefix": 2,
  "alias-prefix": 2,
  "title-prefix": 2,
  "token-prefix": 3,
  "substring-id": 4,
  "substring-alias": 4,
  "substring-title": 4,
  "substring-cwd": 4,
  "substring-name": 4,
  "substring-context": 5,
  recent: 6,
} satisfies Record<QuickSearchMatchReason, number>;

export function normalizeQuickSearchQuery(raw: string | undefined | null): string {
  const collapsed = (raw ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  return collapsed.slice(0, MAX_QUICK_SEARCH_QUERY_LENGTH);
}

/** Escape user text for SQLite LIKE with ESCAPE '\\'. */
export function escapeLikeLiteral(literal: string): string {
  return literal.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function likeContainsPattern(normalizedQuery: string): string {
  return `%${escapeLikeLiteral(normalizedQuery)}%`;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_+.-]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function bestReason(
  candidates: Array<{ ok: boolean; reason: QuickSearchMatchReason }>,
): QuickSearchMatchReason | null {
  let best: QuickSearchMatchReason | null = null;
  for (const c of candidates) {
    if (!c.ok) continue;
    if (!best || TIER[c.reason] < TIER[best]) best = c.reason;
  }
  return best;
}

function tokenPrefixMatch(query: string, haystacks: string[]): boolean {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return false;
  const hayTokens = haystacks.flatMap(tokens);
  if (hayTokens.length === 0) return false;
  return qTokens.every((qt) => hayTokens.some((ht) => ht.startsWith(qt)));
}

export type QuickSearchSessionCandidate = {
  id: string;
  alias: string | null;
  durableTitle: string | null;
  cachedTitle: string | null;
  cwd: string | null;
  state: string;
  updatedAt: string;
  ownerSpaceId: string | null;
  ownerSpaceName: string | null;
};

export type QuickSearchSpaceCandidate = {
  id: string;
  name: string;
  context: string;
  updatedAt: string;
};

export type QuickSearchSessionHit = {
  id: string;
  title: string;
  alias: string | null;
  state: string;
  archived: boolean;
  ownerSpaceId: string | null;
  ownerSpaceName: string | null;
  href: string;
  matchReason: QuickSearchMatchReason;
};

export type QuickSearchSpaceHit = {
  id: string;
  name: string;
  context: string;
  href: string;
  matchReason: QuickSearchMatchReason;
};

/**
 * Visible session label for ranking/display.
 * Precedence: alias → in-memory cached provider title → project/workspace label
 * (sessions.opencodeProjectName) → cwd basename → id.
 * Never prefer projectName over a real cached session title.
 */
function sessionDisplayTitle(candidate: QuickSearchSessionCandidate): string {
  const cached = candidate.cachedTitle?.trim() || null;
  const projectLabel = candidate.durableTitle?.trim() || null;
  return resolveListDisplayName({
    id: candidate.id,
    alias: candidate.alias,
    opencodeTitle: cached || projectLabel,
    cwd: candidate.cwd,
  });
}

function matchSession(
  query: string,
  candidate: QuickSearchSessionCandidate,
): QuickSearchMatchReason | null {
  const q = query.toLowerCase();
  const id = candidate.id.toLowerCase();
  const alias = candidate.alias?.trim().toLowerCase() ?? "";
  const durable = candidate.durableTitle?.trim().toLowerCase() ?? "";
  const cached = candidate.cachedTitle?.trim().toLowerCase() ?? "";
  const title = sessionDisplayTitle(candidate).toLowerCase();
  const cwdBase = (workspaceBasename(candidate.cwd) ?? "").toLowerCase();

  return bestReason([
    { ok: id === q, reason: "exact-id" },
    { ok: Boolean(alias) && alias === q, reason: "exact-alias" },
    {
      ok: Boolean(title) && title === q,
      reason: "exact-title",
    },
    { ok: id.startsWith(q), reason: "id-prefix" },
    { ok: Boolean(alias) && alias.startsWith(q), reason: "alias-prefix" },
    {
      ok:
        (Boolean(durable) && durable.startsWith(q)) ||
        (Boolean(cached) && cached.startsWith(q)) ||
        title.startsWith(q),
      reason: "title-prefix",
    },
    {
      ok: tokenPrefixMatch(q, [id, alias, durable, cached, title, cwdBase]),
      reason: "token-prefix",
    },
    { ok: id.includes(q), reason: "substring-id" },
    { ok: Boolean(alias) && alias.includes(q), reason: "substring-alias" },
    {
      ok:
        (Boolean(durable) && durable.includes(q)) ||
        (Boolean(cached) && cached.includes(q)) ||
        title.includes(q),
      reason: "substring-title",
    },
    { ok: Boolean(cwdBase) && cwdBase.includes(q), reason: "substring-cwd" },
  ]);
}

function matchSpace(
  query: string,
  candidate: QuickSearchSpaceCandidate,
): QuickSearchMatchReason | null {
  const q = query.toLowerCase();
  const name = candidate.name.toLowerCase();
  const context = candidate.context.toLowerCase();

  return bestReason([
    { ok: name === q, reason: "exact-name" },
    { ok: name.startsWith(q), reason: "name-prefix" },
    { ok: tokenPrefixMatch(q, [name, context]), reason: "token-prefix" },
    { ok: name.includes(q), reason: "substring-name" },
    { ok: Boolean(context) && context.includes(q), reason: "substring-context" },
  ]);
}

function compareUpdatedAtDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

export function rankQuickSearchSessions(
  query: string,
  candidates: QuickSearchSessionCandidate[],
  currentSpaceId?: string | null,
  limit = QUICK_SEARCH_RESULT_LIMIT,
): QuickSearchSessionHit[] {
  const q = normalizeQuickSearchQuery(query);
  type Scored = QuickSearchSessionHit & { tier: number; boost: number; updatedAt: string };

  const scored: Scored[] = [];
  for (const candidate of candidates) {
    const archived = candidate.state === "archived";
    if (!q) {
      if (archived) continue;
      scored.push({
        id: candidate.id,
        title: sessionDisplayTitle(candidate),
        alias: candidate.alias,
        state: candidate.state,
        archived: false,
        ownerSpaceId: candidate.ownerSpaceId,
        ownerSpaceName: candidate.ownerSpaceName,
        href: sessionHref(candidate.id),
        matchReason: "recent",
        tier: TIER.recent,
        boost: 0,
        updatedAt: candidate.updatedAt,
      });
      continue;
    }
    const reason = matchSession(q, candidate);
    if (!reason) continue;
    const boost = currentSpaceId && candidate.ownerSpaceId === currentSpaceId ? 1 : 0;
    scored.push({
      id: candidate.id,
      title: sessionDisplayTitle(candidate),
      alias: candidate.alias,
      state: candidate.state,
      archived,
      ownerSpaceId: candidate.ownerSpaceId,
      ownerSpaceName: candidate.ownerSpaceName,
      href: sessionHref(candidate.id),
      matchReason: reason,
      tier: TIER[reason] + (archived ? 0.5 : 0),
      boost,
      updatedAt: candidate.updatedAt,
    });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.boost !== b.boost) return b.boost - a.boost;
    const byTime = compareUpdatedAtDesc(a.updatedAt, b.updatedAt);
    if (byTime !== 0) return byTime;
    return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });

  return scored.slice(0, limit).map(({ tier: _t, boost: _b, updatedAt: _u, ...hit }) => hit);
}

export function rankQuickSearchSpaces(
  query: string,
  candidates: QuickSearchSpaceCandidate[],
  currentSpaceId?: string | null,
  limit = QUICK_SEARCH_RESULT_LIMIT,
): QuickSearchSpaceHit[] {
  const q = normalizeQuickSearchQuery(query);
  type Scored = QuickSearchSpaceHit & { tier: number; boost: number; updatedAt: string };

  const scored: Scored[] = [];
  for (const candidate of candidates) {
    if (!q) {
      scored.push({
        id: candidate.id,
        name: candidate.name,
        context: candidate.context,
        href: `/dashboard/${candidate.id}`,
        matchReason: "recent",
        tier: TIER.recent,
        boost: 0,
        updatedAt: candidate.updatedAt,
      });
      continue;
    }
    const reason = matchSpace(q, candidate);
    if (!reason) continue;
    const boost = currentSpaceId && candidate.id === currentSpaceId ? 1 : 0;
    scored.push({
      id: candidate.id,
      name: candidate.name,
      context: candidate.context,
      href: `/dashboard/${candidate.id}`,
      matchReason: reason,
      tier: TIER[reason],
      boost,
      updatedAt: candidate.updatedAt,
    });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.boost !== b.boost) return b.boost - a.boost;
    const byTime = compareUpdatedAtDesc(a.updatedAt, b.updatedAt);
    if (byTime !== 0) return byTime;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });

  return scored.slice(0, limit).map(({ tier: _t, boost: _b, updatedAt: _u, ...hit }) => hit);
}

export { isQuickSearchPath } from "../src/quick-search-path.ts";
