import { importSessionsHref } from "./utils.ts";
import {
  canonicalizeImportableSessionId,
  matchCreatableVoiceSessionName,
  matchImportableSessionId,
  voiceSessionIdFromName,
} from "./session-id-patterns.ts";

export type QuickSearchActionKind =
  | "import-session"
  | "import-folder"
  | "search-messages"
  | "create-voice-session";

export type QuickSearchAction = {
  kind: QuickSearchActionKind;
  id: string;
  title: string;
  meta: string;
  /** Navigate target when the action is a pure jump (folder / message search). */
  href?: string;
  /** Session id to POST-import or create when kind is import/create-voice. */
  sessionId?: string;
};

/**
 * Folder-shaped queries the /sessions import flow accepts via path input.
 * Absolute, home (~), or relative paths with a slash — not session ids.
 */
export function matchImportFolderPath(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (matchImportableSessionId(trimmed)) return null;
  if (trimmed.startsWith("/") || trimmed === "~" || trimmed.startsWith("~/")) return trimmed;
  if (trimmed.includes("/") && !/\s/.test(trimmed) && !/^https?:/i.test(trimmed)) return trimmed;
  return null;
}

export function messageSearchHref(query: string): string {
  const trimmed = query.trim();
  const params = new URLSearchParams();
  if (trimmed) params.set("q", trimmed);
  const suffix = params.toString();
  return suffix ? `/search?${suffix}` : "/search";
}

/** Local ids keyed by the same canonicalizer used for the query. */
function localSessionIdSet(
  localSessionIds: ReadonlySet<string> | readonly string[] | undefined,
): Set<string> {
  const ids = localSessionIds instanceof Set ? localSessionIds : (localSessionIds ?? []);
  return new Set([...ids].map((id) => canonicalizeImportableSessionId(id)));
}

export function buildQuickSearchActions(input: {
  query: string;
  /** Local session ids already returned by quick-search (prefer open over import). */
  localSessionIds?: ReadonlySet<string> | readonly string[];
}): QuickSearchAction[] {
  const trimmed = input.query.trim();
  const actions: QuickSearchAction[] = [];
  if (!trimmed) return actions;

  const local = localSessionIdSet(input.localSessionIds);

  const sessionId = matchImportableSessionId(trimmed);
  if (sessionId && !local.has(sessionId)) {
    actions.push({
      kind: "import-session",
      id: `import-session:${sessionId}`,
      title: "Import session",
      meta: sessionId,
      sessionId,
    });
  }

  const folderPath = matchImportFolderPath(trimmed);
  if (folderPath) {
    actions.push({
      kind: "import-folder",
      id: `import-folder:${folderPath}`,
      title: "Import sessions from folder",
      meta: folderPath,
      href: importSessionsHref(folderPath),
    });
  }

  const voiceName = matchCreatableVoiceSessionName(trimmed);
  if (voiceName) {
    const voiceId = voiceSessionIdFromName(voiceName);
    if (!local.has(voiceId) && !local.has(voiceName)) {
      actions.push({
        kind: "create-voice-session",
        id: `create-voice-session:${voiceId}`,
        title: "Create voice-only session",
        meta: voiceId,
        sessionId: voiceId,
      });
    }
  }

  actions.push({
    kind: "search-messages",
    id: `search-messages:${trimmed}`,
    title: `Search messages for “${trimmed}”`,
    meta: "Open message search",
    href: messageSearchHref(trimmed),
  });

  return actions;
}
