import { detectSessionBackend } from "./session-id.ts";
import { layerForBackend } from "./session-services/session-router.ts";
import { SessionTitle } from "./session-services/interfaces.ts";
import { opencodeSessionInfoCache } from "./opencode/cache.ts";
import {
  getOrganizePathForSession,
  type OrganizePathCrumb,
  type Organization,
} from "./session-folders.ts";
import { Effect } from "effect";

/**
 * True in-memory peek only — OpenCode process Map.
 * External CLI backends intentionally return null: their SessionTitle layers
 * read provider disk and must not run on list/roster/search hot paths.
 */
export function peekInMemoryProviderTitle(sessionId: string): string | null {
  return opencodeSessionInfoCache.get(sessionId)?.title ?? null;
}

/** Cached provider title for all backends (tier 1 enrich). May hit CLI disk readers. */
export function getCachedProviderTitle(sessionId: string): string | null {
  const backend = detectSessionBackend(sessionId);
  if (backend === "none" || backend === "voice") return null;
  if (backend === "opencode") return peekInMemoryProviderTitle(sessionId);
  const layer = layerForBackend(backend);
  if (!layer) return null;
  const program = Effect.gen(function* () {
    const service = yield* SessionTitle;
    return yield* service.getTitle(sessionId);
  });
  return Effect.runSync(program.pipe(Effect.provide(layer)));
}

export type SessionListEnrichment = {
  opencodeTitle: string | null;
  organizePath: OrganizePathCrumb[];
  opencodeAgent: string | null;
  opencodeModelProvider: string | null;
  opencodeModel: string | null;
};

/**
 * Tier 0 list enrich: only use in-memory provider metadata here.
 *
 * External CLI titles are backed by synchronous filesystem reads. A session
 * list can contain many rows and is refreshed by several live clients, so
 * disk-backed title discovery belongs to explicit detail/search paths rather
 * than this hot path.
 */
export function enrichSessionForList(sessionId: string, org?: Organization): SessionListEnrichment {
  const cached = opencodeSessionInfoCache.get(sessionId);
  return {
    opencodeTitle: peekInMemoryProviderTitle(sessionId),
    organizePath: getOrganizePathForSession(sessionId, org),
    opencodeAgent: cached?.agent ?? null,
    opencodeModelProvider: cached?.modelProvider ?? null,
    opencodeModel: cached?.model ?? null,
  };
}
