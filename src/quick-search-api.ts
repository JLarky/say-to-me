import { type as arktype } from "arktype";
import { safeResponseJson } from "@say-to-me/runtime-validation";

const MatchReason = arktype(
  "'exact-id' | 'exact-alias' | 'exact-title' | 'exact-name' | 'id-prefix' | 'name-prefix' | 'alias-prefix' | 'title-prefix' | 'token-prefix' | 'substring-id' | 'substring-alias' | 'substring-title' | 'substring-cwd' | 'substring-name' | 'substring-context' | 'recent'",
);

const QuickSearchSessionHit = arktype({
  id: "string",
  title: "string",
  alias: "string | null",
  state: "string",
  archived: "boolean",
  ownerSpaceId: "string | null",
  ownerSpaceName: "string | null",
  href: "string",
  matchReason: MatchReason,
});

const QuickSearchSpaceHit = arktype({
  id: "string",
  name: "string",
  context: "string",
  href: "string",
  matchReason: MatchReason,
});

const QuickSearchResponse = arktype({
  query: "string",
  sessions: QuickSearchSessionHit.array(),
  spaces: QuickSearchSpaceHit.array(),
});

const QuickSearchError = arktype({ error: "string" });

export type QuickSearchResult = typeof QuickSearchResponse.infer;

export async function fetchQuickSearch(
  q: string,
  options?: {
    currentSpaceId?: string | null;
    signal?: AbortSignal;
  },
): Promise<QuickSearchResult> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (options?.currentSpaceId) params.set("currentSpaceId", options.currentSpaceId);
  const suffix = params.size ? `?${params}` : "";
  const response = await fetch(`/api/quick-search${suffix}`, { signal: options?.signal });
  if (!response.ok) {
    let message = `Quick search failed (${response.status}).`;
    try {
      message = (await safeResponseJson(response, QuickSearchError)).error;
    } catch {
      // keep status message
    }
    throw new Error(message);
  }
  return safeResponseJson(response, QuickSearchResponse);
}
