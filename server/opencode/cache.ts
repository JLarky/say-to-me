import type { OpenCodeStatus } from "../../src/types.ts";

export type OpenCodeStatusCacheEntry = {
  status: OpenCodeStatus;
  /** Raw OpenCode retry message when status is retrying (e.g. free-tier limit). */
  reason?: string | null;
  time: number;
};

export const opencodeStatusCache = new Map<string, OpenCodeStatusCacheEntry>();

export function getCachedOpenCodeStatus(sessionId: string): OpenCodeStatus | null {
  return getCachedOpenCodeStatusEntry(sessionId)?.status ?? null;
}

export function getCachedOpenCodeStatusReason(sessionId: string): string | null {
  const reason = getCachedOpenCodeStatusEntry(sessionId)?.reason;
  return reason?.trim() || null;
}

function getCachedOpenCodeStatusEntry(sessionId: string): OpenCodeStatusCacheEntry | null {
  let latest: OpenCodeStatusCacheEntry | null = null;
  for (const [key, cached] of opencodeStatusCache.entries()) {
    if (!key.endsWith(`\n${sessionId}`)) continue;
    if (!latest || cached.time > latest.time) latest = cached;
  }
  return latest;
}

/** Cache of fine-grained activity status (e.g. "awaiting-input") keyed by sessionId. */
export const opencodeActivityStatusCache = new Map<string, { status: string; time: number }>();

export function getCachedOpenCodeActivityStatus(sessionId: string): string | null {
  const cached = opencodeActivityStatusCache.get(sessionId);
  return cached?.status ?? null;
}

export type OpenCodeSessionInfoCacheEntry = {
  title: string | null;
  directory: string | null;
  // Common OpenCode agents are "build" and "plan", but users can define custom agents.
  agent: string | null;
  modelProvider: string | null;
  model: string | null;
  time: number;
};

export const opencodeSessionInfoCache = new Map<string, OpenCodeSessionInfoCacheEntry>();
