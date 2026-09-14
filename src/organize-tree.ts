import { resolveListDisplayName } from "./session-display.ts";
import type { OrgFolder, OrgPlacement, SessionState } from "./types.ts";

export type Backend =
  | "opencode"
  | "claude"
  | "cursor"
  | "codex"
  | "grok"
  | "t3"
  | "paseo"
  | "paseo-chat"
  | "voice"
  | "local";

/** A tree node is a folder (holds children) or a session (a leaf). Stored flat with parentId; sibling order = array order. */
export type TreeNode = {
  id: string;
  kind: "folder" | "session";
  name: string;
  parentId: string | null;
  backend?: Backend;
  alias?: string | null;
  state?: SessionState | null;
};

export type PinAttentionState = "general" | "important" | "jarvis";

export const pinAttentionOptions: Array<{
  value: PinAttentionState;
  label: string;
  hint: string;
}> = [
  { value: "general", label: "None", hint: "No pin or Jarvis mark." },
  { value: "important", label: "Pinned", hint: "Shows in Important on Home." },
  { value: "jarvis", label: "Jarvis", hint: "Included in Jarvis Managed coordination." },
];

export function pinAttentionState(state: SessionState | null | undefined): PinAttentionState {
  if (state === "important" || state === "jarvis") return state;
  return "general";
}

/** Home and session-menu Pin/Unpin: important ↔ everything else. Same `sessions.state` store. */
export function nextSessionPinState(
  state: SessionState | null | undefined,
): "important" | "general" {
  return state === "important" ? "general" : "important";
}

export function sessionPinActionLabel(state: SessionState | null | undefined): "Unpin" | "Pin" {
  return state === "important" ? "Unpin" : "Pin";
}

export type SessionRow = {
  id: string;
  alias?: string | null;
  opencodeTitle?: string | null;
  cwd?: string | null;
  state?: string | null;
};

export type DropMode = "before" | "after" | "into";
export type DropTarget = { id: string; mode: DropMode };

export const backendLabel = {
  opencode: "OpenCode",
  claude: "Claude",
  cursor: "Cursor",
  codex: "Codex",
  grok: "Grok",
  t3: "T3",
  paseo: "Paseo",
  "paseo-chat": "Paseo Chat",
  voice: "Voice",
  local: "Local",
} satisfies Record<Backend, string>;

export function backendOf(id: string): Backend {
  if (id.startsWith("ses_")) return "opencode";
  if (id.startsWith("cc_")) return "claude";
  if (id.startsWith("cur_")) return "cursor";
  if (id.startsWith("cx_")) return "codex";
  if (id.startsWith("gr_")) return "grok";
  if (id.startsWith("t3_")) return "t3";
  if (id.startsWith("pa_")) return "paseo";
  if (id.startsWith("pc_")) return "paseo-chat";
  if (id.startsWith("vo_")) return "voice";
  return "local";
}

export function titleOf(session: SessionRow): string {
  return resolveListDisplayName(session);
}

/** Archived sessions are hidden, except the one named in `keepArchivedId` so a deep-link still resolves. Unplaced sessions sort last (appended at root). */
export function buildNodes(
  folders: OrgFolder[],
  placements: OrgPlacement[],
  sessions: SessionRow[],
  keepArchivedId: string | null,
): TreeNode[] {
  const placementBySession = new Map(placements.map((p) => [p.sessionId, p]));
  const folderIds = new Set(folders.map((f) => f.id));
  // A parent that no longer exists (folder was deleted while its contents were
  // hidden) resolves to the top level, so nothing is orphaned out of view.
  const resolveParent = (parentId: string | null | undefined) =>
    parentId && folderIds.has(parentId) ? parentId : null;

  const items: Array<{ node: TreeNode; sort: number }> = [];
  for (const f of folders) {
    items.push({
      node: { id: f.id, kind: "folder", name: f.name, parentId: resolveParent(f.parentId) },
      sort: f.sortOrder,
    });
  }
  sessions.forEach((s, i) => {
    if (s.state === "archived" && s.id !== keepArchivedId) return;
    const placement = placementBySession.get(s.id);
    items.push({
      node: {
        id: s.id,
        kind: "session",
        name: titleOf(s),
        parentId: resolveParent(placement?.folderId),
        backend: backendOf(s.id),
        alias: s.alias ?? null,
        state: (s.state as SessionState | null | undefined) ?? "general",
      },
      sort: placement ? placement.sortOrder : 1_000_000 + i,
    });
  });
  items.sort((a, b) => a.sort - b.sort);
  return items.map((it) => it.node);
}
