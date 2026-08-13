import { safeResponseJson } from "@say-to-me/runtime-validation";
import {
  ErrorPayload,
  MessagesPayload,
  OrganizeFoldersResponse,
  type OrgFolder,
  type OrgPlacement,
} from "../../types.ts";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { PageShell } from "../PageShell.tsx";
import { SessionListItem } from "../SessionList.tsx";
import {
  backendLabel,
  buildNodes,
  pinAttentionOptions,
  pinAttentionState,
  type DropMode,
  type DropTarget,
  type PinAttentionState,
  type TreeNode,
} from "../../organize-tree.ts";
import { thread } from "../../styles/feed.stylex.ts";
import { text as textStyles } from "../../styles/chrome.stylex.ts";
import type { Session, SessionState } from "../../types.ts";

// The /organize session tree. Folders + placements persist via
// /api/session-folders; an org row survives session deletion (hidden, not shown).

function OrganizeSessionHomePreview({
  onOpen,
  onStateChange,
  session,
}: {
  onOpen: (id: string) => void;
  onStateChange: (session: Session, state: SessionState) => void;
  session: Session;
}) {
  return (
    <ol {...stylex.props(thread.list, styles.homePreview)}>
      <SessionListItem session={session} onOpen={onOpen} onStateChange={onStateChange} />
    </ol>
  );
}

export function OrganizePage() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusId = params.folderId ?? null;
  // The archived session to keep visible (captured once — the deep-link effect
  // strips `?session=` from the URL, but a deep-linked archived session should
  // stay shown for the life of the page).
  const keepArchivedIdRef = useRef(searchParams.get("session"));

  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [baseline, setBaseline] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [moveSessionId, setMoveSessionId] = useState<string | null>(null);
  const [moveBrowseParentId, setMoveBrowseParentId] = useState<string | null>(null);
  const [pinSessionId, setPinSessionId] = useState<string | null>(null);
  const [pinDraftState, setPinDraftState] = useState<PinAttentionState>("general");
  const [pinSaving, setPinSaving] = useState(false);
  const [apiSessions, setApiSessions] = useState<Session[]>([]);
  const [expandDetails, setExpandDetails] = useState(false);

  const apiSessionsById = useMemo(
    () => new Map(apiSessions.map((session) => [session.id, session])),
    [apiSessions],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sessionsRes, orgRes] = await Promise.all([
        fetch("/api/sessions?includeCachedStatus=1"),
        fetch("/api/session-folders"),
      ]);
      if (!sessionsRes.ok || !orgRes.ok) throw new Error("Failed to load organization data.");
      const sessionsPayload = await safeResponseJson(sessionsRes, MessagesPayload);
      const org = await safeResponseJson(orgRes, OrganizeFoldersResponse);
      setApiSessions(sessionsPayload.sessions ?? []);
      const built = buildNodes(
        org.folders ?? [],
        org.placements ?? [],
        sessionsPayload.sessions ?? [],
        keepArchivedIdRef.current,
      );
      setNodes(built);
      setBaseline(built);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const childrenOf = useCallback(
    (parentId: string | null) => nodes.filter((n) => n.parentId === parentId),
    [nodes],
  );

  // Deep-link `/organize?session=<id>` (from a session's Links menu): highlight
  // the session and canonicalize the URL to its folder. Uses `replace` so the
  // transient `?session=` URL doesn't linger in history and trap the back button
  // (a push here would re-fire on Back and bounce forward).
  const sessionParam = searchParams.get("session");
  useEffect(() => {
    if (loading || !sessionParam) return;
    const node = nodes.find((n) => n.id === sessionParam);
    if (!node) return;
    setHighlightId(node.id);
    void navigate(node.parentId ? `/organize/${node.parentId}` : "/organize", { replace: true });
    // Only react to the first resolve after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sessionParam]);

  function isDescendant(ancestorId: string, maybeDescendantId: string | null): boolean {
    const seen = new Set<string>();
    let cursor = nodes.find((n) => n.id === maybeDescendantId);
    // `seen` guards against cyclic data (the API rejects cycles, but be defensive).
    while (cursor?.parentId && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.parentId === ancestorId) return true;
      cursor = nodes.find((n) => n.id === cursor?.parentId);
    }
    return false;
  }

  function moveNode(draggedId: string, newParentId: string | null, beforeId: string | null) {
    setNodes((prev) => {
      const dragged = prev.find((n) => n.id === draggedId);
      if (!dragged) return prev;
      if (newParentId === draggedId) return prev;
      if (newParentId && isDescendant(draggedId, newParentId)) return prev;

      const rest = prev.filter((n) => n.id !== draggedId);
      const moved: TreeNode = { ...dragged, parentId: newParentId };
      if (beforeId && beforeId !== draggedId) {
        const idx = rest.findIndex((n) => n.id === beforeId);
        if (idx !== -1) return [...rest.slice(0, idx), moved, ...rest.slice(idx)];
      }
      let lastIdx = -1;
      rest.forEach((n, i) => {
        if (n.parentId === newParentId) lastIdx = i;
      });
      return [...rest.slice(0, lastIdx + 1), moved, ...rest.slice(lastIdx + 1)];
    });
  }

  function resolveDrop(
    ref: TreeNode,
    mode: DropMode,
  ): { parentId: string | null; beforeId: string | null } {
    if (mode === "into") return { parentId: ref.id, beforeId: null };
    if (mode === "before") return { parentId: ref.parentId, beforeId: ref.id };
    const siblings = childrenOf(ref.parentId);
    const idx = siblings.findIndex((s) => s.id === ref.id);
    return { parentId: ref.parentId, beforeId: siblings[idx + 1]?.id ?? null };
  }

  function modeFromEvent(e: React.DragEvent, kind: TreeNode["kind"]): DropMode {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    if (kind === "folder") {
      if (ratio < 0.3) return "before";
      if (ratio > 0.7) return "after";
      return "into";
    }
    return ratio < 0.5 ? "before" : "after";
  }

  function handleDrop(e: React.DragEvent, ref: TreeNode) {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain");
    if (id) {
      const { parentId, beforeId } = resolveDrop(ref, modeFromEvent(e, ref.kind));
      moveNode(id, parentId, beforeId);
    }
    endDrag();
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addFolderHere() {
    const name = newFolderName.trim();
    if (!name) return;
    setNodes((prev) => [
      ...prev,
      { id: `fold_${crypto.randomUUID()}`, kind: "folder", name, parentId: focusId },
    ]);
    setNewFolderName("");
    if (focusId) setCollapsed((prev) => new Set([...prev].filter((c) => c !== focusId)));
  }

  function addSubfolder(parentId: string) {
    const name = (window.prompt("New subfolder name") ?? "").trim();
    if (!name) return;
    setNodes((prev) => [
      ...prev,
      { id: `fold_${crypto.randomUUID()}`, kind: "folder", name, parentId },
    ]);
    setCollapsed((prev) => new Set([...prev].filter((c) => c !== parentId)));
  }

  function renameNode(id: string) {
    const current = nodes.find((n) => n.id === id);
    const next = window.prompt("Rename folder", current?.name ?? "");
    if (next == null) return;
    const name = next.trim();
    if (!name) return;
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, name } : n)));
  }

  async function renameSessionAlias(sessionId: string) {
    const current = nodes.find((n) => n.id === sessionId && n.kind === "session");
    const next = window.prompt("Session alias", current?.alias ?? "");
    if (next == null) return;
    const alias = next.trim();
    setError("");
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: alias || null }),
      });
      const payload = await safeResponseJson(res, ErrorPayload);
      if (!res.ok) throw new Error(payload.error || "Could not rename the session alias.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openPinDialog(sessionId: string) {
    const current = nodes.find((n) => n.id === sessionId && n.kind === "session");
    setPinDraftState(pinAttentionState(current?.state));
    setPinSessionId(sessionId);
  }

  function closePinDialog() {
    setPinSessionId(null);
    setPinSaving(false);
  }

  async function applyPinState() {
    if (!pinSessionId) return;
    setPinSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(pinSessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: pinDraftState }),
      });
      const payload = await safeResponseJson(res, ErrorPayload);
      if (!res.ok) throw new Error(payload.error || "Could not update session pin state.");
      closePinDialog();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPinSaving(false);
    }
  }

  async function updateSessionStateFromPreview(session: Session, state: SessionState) {
    setError("");
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const payload = await safeResponseJson(res, ErrorPayload);
      if (!res.ok) throw new Error(payload.error || "Could not update session state.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Deleting a folder promotes its direct children to the folder's parent.
  function deleteFolder(id: string) {
    setNodes((prev) => {
      const folder = prev.find((n) => n.id === id);
      if (!folder) return prev;
      return prev
        .filter((n) => n.id !== id)
        .map((n) => (n.parentId === id ? { ...n, parentId: folder.parentId } : n));
    });
    if (focusId === id) void navigate("/organize");
  }

  function resetChanges() {
    setNodes(baseline);
  }

  async function applyChanges() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/session-folders", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serialize(nodes)),
      });
      if (!res.ok) throw new Error("Could not save the organization.");
      setBaseline(nodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Working copy → API payload. sortOrder = position among siblings (folders and
  // sessions share one order space under each parent).
  function serialize(list: TreeNode[]): { folders: OrgFolder[]; placements: OrgPlacement[] } {
    const orderIn = (parentId: string | null) => list.filter((n) => n.parentId === parentId);
    const folders: OrgFolder[] = [];
    const placements: OrgPlacement[] = [];
    for (const node of list) {
      const sortOrder = orderIn(node.parentId).findIndex((n) => n.id === node.id);
      if (node.kind === "folder") {
        folders.push({ id: node.id, name: node.name, parentId: node.parentId, sortOrder });
      } else {
        placements.push({ sessionId: node.id, folderId: node.parentId, sortOrder });
      }
    }
    return { folders, placements };
  }

  function endDrag() {
    setDraggingId(null);
    setDropTarget(null);
  }

  function openMoveDialog(sessionId: string) {
    const session = nodes.find((n) => n.id === sessionId);
    setMoveSessionId(sessionId);
    setMoveBrowseParentId(session?.parentId ?? null);
  }

  function closeMoveDialog() {
    setMoveSessionId(null);
    setMoveBrowseParentId(null);
  }

  function confirmMove() {
    if (!moveSessionId) return;
    moveNode(moveSessionId, moveBrowseParentId, null);
    closeMoveDialog();
  }

  function dragProps(id: string) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
        setDraggingId(id);
      },
      onDragEnd: endDrag,
    };
  }

  const baseById = new Map(baseline.map((n) => [n.id, n]));
  function isChanged(node: TreeNode): boolean {
    const base = baseById.get(node.id);
    if (!base) return true;
    if (base.name !== node.name || base.parentId !== node.parentId) return true;
    const curOrder = nodes
      .filter((n) => n.parentId === node.parentId && baseById.has(n.id))
      .map((n) => n.id);
    const baseOrder = baseline.filter((n) => n.parentId === base.parentId).map((n) => n.id);
    return curOrder.indexOf(node.id) !== baseOrder.indexOf(node.id);
  }
  const currentIds = new Set(nodes.map((n) => n.id));
  const changeCount =
    nodes.filter(isChanged).length + baseline.filter((b) => !currentIds.has(b.id)).length;
  const hasChanges = changeCount > 0;

  const moveSession = moveSessionId ? (nodes.find((n) => n.id === moveSessionId) ?? null) : null;
  const pinSession = pinSessionId ? (nodes.find((n) => n.id === pinSessionId) ?? null) : null;
  const moveFolders = moveSessionId
    ? nodes.filter((n) => n.kind === "folder" && n.parentId === moveBrowseParentId)
    : [];
  const moveCrumbs: TreeNode[] = [];
  if (moveSessionId) {
    const seen = new Set<string>();
    let cursor = moveBrowseParentId ? nodes.find((n) => n.id === moveBrowseParentId) : undefined;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      moveCrumbs.unshift(cursor);
      cursor = cursor.parentId ? nodes.find((n) => n.id === cursor?.parentId) : undefined;
    }
  }
  const moveTargetLabel = moveBrowseParentId
    ? (nodes.find((n) => n.id === moveBrowseParentId)?.name ?? "Folder")
    : "Home";
  const moveAlreadyHere = moveSession ? moveSession.parentId === moveBrowseParentId : true;

  useEffect(() => {
    if (!moveSessionId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMoveDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSessionId]);

  useEffect(() => {
    if (!pinSessionId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closePinDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pinSessionId]);

  function renderMoveDialog(): ReactNode {
    if (!moveSession) return null;
    return (
      <div {...stylex.props(styles.moveOverlay)} role="presentation" onClick={closeMoveDialog}>
        <div
          {...stylex.props(styles.moveDialog)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="move-dialog-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 {...stylex.props(styles.moveTitle)} id="move-dialog-title">
            Move &ldquo;{moveSession.name}&rdquo;
          </h2>
          <p {...stylex.props(styles.moveHint)}>Choose a folder, then move the session there.</p>

          <nav {...stylex.props(styles.moveBreadcrumb)} aria-label="Move destination">
            <button
              {...stylex.props(
                styles.moveCrumb,
                moveBrowseParentId === null && styles.moveCrumbCurrent,
              )}
              type="button"
              onClick={() => setMoveBrowseParentId(null)}
            >
              Home
            </button>
            {moveCrumbs.map((crumb, i) => (
              <span key={crumb.id} {...stylex.props(styles.moveCrumbGroup)}>
                <span {...stylex.props(styles.crumbSep)} aria-hidden="true">
                  /
                </span>
                <button
                  {...stylex.props(
                    styles.moveCrumb,
                    i === moveCrumbs.length - 1 && styles.moveCrumbCurrent,
                  )}
                  type="button"
                  onClick={() => setMoveBrowseParentId(crumb.id)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>

          <ul {...stylex.props(styles.moveList)}>
            {moveFolders.length > 0 ? (
              moveFolders.map((folder) => (
                <li key={folder.id}>
                  <button
                    {...stylex.props(styles.moveFolderRow)}
                    type="button"
                    onClick={() => setMoveBrowseParentId(folder.id)}
                  >
                    <span {...stylex.props(styles.moveFolderName)}>{folder.name}</span>
                    <span {...stylex.props(styles.moveFolderChevron)} aria-hidden="true">
                      ▸
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li {...stylex.props(styles.moveListEmpty)}>No subfolders here</li>
            )}
          </ul>

          <div {...stylex.props(styles.moveActions)}>
            <button
              {...stylex.props(styles.button, styles.buttonGhost)}
              type="button"
              onClick={closeMoveDialog}
            >
              Cancel
            </button>
            <button
              {...stylex.props(styles.button, moveAlreadyHere && styles.buttonDisabled)}
              type="button"
              disabled={moveAlreadyHere}
              onClick={confirmMove}
            >
              Move to {moveTargetLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderPinDialog(): ReactNode {
    if (!pinSession) return null;
    const currentPin = pinAttentionState(pinSession.state);
    return (
      <div {...stylex.props(styles.moveOverlay)} role="presentation" onClick={closePinDialog}>
        <div
          {...stylex.props(styles.moveDialog)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pin-dialog-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 {...stylex.props(styles.moveTitle)} id="pin-dialog-title">
            Pin &ldquo;{pinSession.name}&rdquo;
          </h2>
          <p {...stylex.props(styles.moveHint)}>
            Attention status — same as Pin and Mark Jarvis on Home.
          </p>
          <fieldset {...stylex.props(styles.pinFieldset)}>
            <legend {...stylex.props(styles.pinLegend)}>Status</legend>
            {pinAttentionOptions.map((option) => (
              <label key={option.value} {...stylex.props(styles.pinOption)}>
                <input
                  type="radio"
                  name="pin-attention"
                  checked={pinDraftState === option.value}
                  onChange={() => setPinDraftState(option.value)}
                />
                <span {...stylex.props(styles.pinOptionText)}>
                  <span {...stylex.props(styles.pinOptionLabel)}>{option.label}</span>
                  <span {...stylex.props(styles.pinOptionHint)}>{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div {...stylex.props(styles.moveActions)}>
            <button
              {...stylex.props(styles.button, styles.buttonGhost)}
              type="button"
              onClick={closePinDialog}
            >
              Cancel
            </button>
            <button
              {...stylex.props(
                styles.button,
                (pinSaving || pinDraftState === currentPin) && styles.buttonDisabled,
              )}
              type="button"
              disabled={pinSaving || pinDraftState === currentPin}
              onClick={() => void applyPinState()}
            >
              {pinSaving ? "Saving…" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderChildren(parentId: string | null): ReactNode {
    return childrenOf(parentId).map((node) => {
      const isDragging = draggingId === node.id;
      const changed = isChanged(node);
      const target = dropTarget?.id === node.id ? dropTarget.mode : null;

      if (node.kind === "folder") {
        const isCollapsed = collapsed.has(node.id);
        const kids = childrenOf(node.id);
        return (
          <section key={node.id} {...stylex.props(styles.panel, isDragging && styles.dragging)}>
            <header
              {...stylex.props(
                styles.panelHeader,
                changed && styles.changed,
                target === "into" && styles.headerInto,
                target === "before" && styles.insertBefore,
                target === "after" && styles.insertAfter,
              )}
              {...dragProps(node.id)}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropTarget({ id: node.id, mode: modeFromEvent(e, "folder") });
              }}
              onDrop={(e) => handleDrop(e, node)}
            >
              <button
                {...stylex.props(styles.twisty)}
                type="button"
                aria-label={isCollapsed ? "Expand" : "Collapse"}
                onClick={() => toggleCollapse(node.id)}
              >
                {kids.length === 0 ? "•" : isCollapsed ? "▸" : "▾"}
              </button>
              <Link
                {...stylex.props(styles.panelTitle)}
                to={`/organize/${node.id}`}
                draggable={false}
              >
                {node.name}
              </Link>
              <span {...stylex.props(styles.count)}>{kids.length}</span>
              <span {...stylex.props(styles.panelActions)}>
                <button
                  {...stylex.props(styles.miniButton)}
                  type="button"
                  onClick={() => addSubfolder(node.id)}
                >
                  + Sub
                </button>
                <button
                  {...stylex.props(styles.miniButton)}
                  type="button"
                  onClick={() => renameNode(node.id)}
                >
                  Rename
                </button>
                <button
                  {...stylex.props(styles.miniButton)}
                  type="button"
                  onClick={() => deleteFolder(node.id)}
                >
                  Delete
                </button>
              </span>
            </header>
            {!isCollapsed ? (
              <div {...stylex.props(styles.panelBody)}>
                {kids.length > 0 ? (
                  renderChildren(node.id)
                ) : (
                  <p
                    {...stylex.props(styles.empty, target === "into" && styles.emptyInto)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropTarget({ id: node.id, mode: "into" });
                    }}
                    onDrop={(e) => handleDrop(e, node)}
                  >
                    Drop sessions or folders here
                  </p>
                )}
              </div>
            ) : null}
          </section>
        );
      }

      return (
        <article
          key={node.id}
          {...stylex.props(
            styles.card,
            isDragging && styles.dragging,
            changed && styles.changed,
            highlightId === node.id && styles.cardHighlight,
            target === "before" && styles.insertBefore,
            target === "after" && styles.insertAfter,
          )}
          {...dragProps(node.id)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropTarget({ id: node.id, mode: modeFromEvent(e, "session") });
          }}
          onDrop={(e) => handleDrop(e, node)}
        >
          <header {...stylex.props(styles.panelHeader)}>
            <span {...stylex.props(styles.cardTitle)}>{node.name}</span>
            {node.backend ? (
              <span {...stylex.props(styles.badge)}>{backendLabel[node.backend]}</span>
            ) : null}
            {node.state === "important" ? (
              <span {...stylex.props(styles.badge, styles.pinnedBadge)}>Pinned</span>
            ) : null}
            {node.state === "jarvis" ? (
              <span {...stylex.props(styles.badge, styles.jarvisBadge)}>Jarvis</span>
            ) : null}
            {node.state === "archived" ? (
              <span {...stylex.props(styles.badge, styles.archivedBadge)}>Archived</span>
            ) : null}
            <span {...stylex.props(styles.panelActions)}>
              <button
                {...stylex.props(styles.miniButton)}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void renameSessionAlias(node.id);
                }}
              >
                Rename
              </button>
              <button
                {...stylex.props(styles.miniButton)}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openMoveDialog(node.id);
                }}
              >
                Move
              </button>
              <button
                {...stylex.props(styles.miniButton)}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openPinDialog(node.id);
                }}
              >
                Pin
              </button>
              <Link
                {...stylex.props(styles.miniButton, styles.miniLink)}
                to={`/ses/${node.id}`}
                draggable={false}
              >
                Open
              </Link>
            </span>
          </header>
          {expandDetails && apiSessionsById.get(node.id) ? null : (
            <code {...stylex.props(styles.cardId)}>{node.id}</code>
          )}
          {expandDetails && apiSessionsById.get(node.id) ? (
            <OrganizeSessionHomePreview
              session={apiSessionsById.get(node.id)!}
              onOpen={(id) => navigate(id === "default" ? "/default" : `/ses/${id}`)}
              onStateChange={(session, state) => void updateSessionStateFromPreview(session, state)}
            />
          ) : null}
        </article>
      );
    });
  }

  const crumbs: TreeNode[] = [];
  {
    const seen = new Set<string>();
    let cursor = focusId ? nodes.find((n) => n.id === focusId) : undefined;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      crumbs.unshift(cursor);
      cursor = cursor.parentId ? nodes.find((n) => n.id === cursor?.parentId) : undefined;
    }
  }
  const focusFolder = focusId ? (nodes.find((n) => n.id === focusId) ?? null) : null;
  const viewParentId = focusFolder ? focusFolder.id : null;
  const isRootDrop = dropTarget?.id === "__root__";
  const dropZoneLabel = focusFolder
    ? `Drop here to add to ${focusFolder.name}`
    : "Drop here for top level";

  return (
    <PageShell
      eyebrow="Organize"
      backTo="/"
      backLabel="Back to sessions"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title)}>Organize</h1>
          <p {...stylex.props(textStyles.lede)}>
            Group your sessions into folders. Drag to arrange, open a folder to focus, then Apply to
            save.
          </p>
        </>
      }
    >
      <div {...stylex.props(styles.toolbar)}>
        <input
          {...stylex.props(styles.input)}
          type="text"
          value={newFolderName}
          placeholder={focusFolder ? `New folder in ${focusFolder.name}` : "New top-level folder"}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addFolderHere();
          }}
        />
        <button {...stylex.props(styles.button)} type="button" onClick={addFolderHere}>
          Add folder
        </button>
        <span {...stylex.props(styles.toolbarSpacer)} />
        {hasChanges ? (
          <span {...stylex.props(styles.changeCount)}>
            {changeCount} unsaved {changeCount === 1 ? "change" : "changes"}
          </span>
        ) : null}
        <button
          {...stylex.props(styles.button, styles.buttonGhost, expandDetails && styles.buttonActive)}
          type="button"
          onClick={() => setExpandDetails((current) => !current)}
        >
          {expandDetails ? "Collapse" : "Expand"}
        </button>
        <button
          {...stylex.props(styles.button, styles.buttonGhost, !hasChanges && styles.buttonDisabled)}
          type="button"
          disabled={!hasChanges || saving}
          onClick={resetChanges}
        >
          Reset
        </button>
        <button
          {...stylex.props(styles.button, (!hasChanges || saving) && styles.buttonDisabled)}
          type="button"
          disabled={!hasChanges || saving}
          onClick={() => void applyChanges()}
        >
          {saving ? "Saving..." : "Apply"}
        </button>
      </div>

      <nav {...stylex.props(styles.breadcrumb)} aria-label="Breadcrumb">
        <Link {...stylex.props(styles.crumb, !focusFolder && styles.crumbCurrent)} to="/organize">
          Home
        </Link>
        {crumbs.map((crumb, i) => (
          <span key={crumb.id} {...stylex.props(styles.crumbGroup)}>
            <span {...stylex.props(styles.crumbSep)} aria-hidden="true">
              /
            </span>
            <Link
              {...stylex.props(styles.crumb, i === crumbs.length - 1 && styles.crumbCurrent)}
              to={`/organize/${crumb.id}`}
            >
              {crumb.name}
            </Link>
          </span>
        ))}
      </nav>

      {error ? <p {...stylex.props(styles.error)}>{error}</p> : null}

      {loading ? (
        <p {...stylex.props(styles.empty)}>Loading…</p>
      ) : (
        <div {...stylex.props(styles.tree)}>
          {childrenOf(viewParentId).length > 0 ? (
            renderChildren(viewParentId)
          ) : (
            <p {...stylex.props(styles.empty)}>This folder is empty.</p>
          )}

          <div
            {...stylex.props(styles.rootDrop, isRootDrop && styles.rootDropActive)}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget({ id: "__root__", mode: "into" });
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id) moveNode(id, viewParentId, null);
              endDrag();
            }}
          >
            {dropZoneLabel}
          </div>
        </div>
      )}
      {renderMoveDialog()}
      {renderPinDialog()}
    </PageShell>
  );
}

const styles = stylex.create({
  toolbar: {
    display: "flex",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    flexWrap: "wrap",
    marginBottom: "1rem",
  },
  input: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "240px",
    paddingTop: "0.5rem",
    paddingRight: "0.75rem",
    paddingBottom: "0.5rem",
    paddingLeft: "0.75rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.18)",
    borderRadius: "10px",
    backgroundColor: "#fffdf8",
    color: "#17202a",
    fontSize: "0.9rem",
  },
  button: {
    paddingTop: "0.5rem",
    paddingRight: "0.9rem",
    paddingBottom: "0.5rem",
    paddingLeft: "0.9rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.18)",
    borderRadius: "10px",
    backgroundColor: "#17202a",
    color: "#fffdf8",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  buttonGhost: {
    backgroundColor: "transparent",
    color: "#17202a",
  },
  buttonActive: {
    backgroundColor: "rgba(210, 228, 255, 0.75)",
    borderColor: "rgba(23, 100, 200, 0.55)",
  },
  buttonDisabled: {
    opacity: 0.4,
    cursor: "default",
  },
  toolbarSpacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
  },
  changeCount: {
    alignSelf: "center",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "#b45309",
  },
  changed: {
    backgroundColor: "rgba(251, 191, 36, 0.16)",
    boxShadow: "inset 3px 0 0 0 rgba(217, 119, 6, 0.9)",
  },
  error: {
    marginTop: "0",
    marginRight: "0",
    marginBottom: "0.75rem",
    marginLeft: "0",
    paddingTop: "0.6rem",
    paddingRight: "0.75rem",
    paddingBottom: "0.6rem",
    paddingLeft: "0.75rem",
    borderRadius: "10px",
    backgroundColor: "rgba(220, 38, 38, 0.1)",
    color: "#b91c1c",
    fontSize: "0.85rem",
  },
  tree: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.6rem",
    columnGap: "0.6rem",
    padding: "0.9rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "18px",
    backgroundColor: "rgba(255, 255, 255, 0.6)",
    cursor: "grab",
    transition: "border-color 120ms ease, background-color 120ms ease",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    paddingTop: "0.15rem",
    paddingRight: "0.25rem",
    paddingBottom: "0.15rem",
    paddingLeft: "0.25rem",
    borderRadius: "8px",
    cursor: "grab",
  },
  headerInto: {
    backgroundColor: "rgba(210, 228, 255, 0.75)",
    outlineWidth: "1px",
    outlineStyle: "solid",
    outlineColor: "rgba(23, 100, 200, 0.55)",
  },
  insertBefore: {
    boxShadow: "0 -2px 0 0 rgba(23, 100, 200, 0.85)",
  },
  insertAfter: {
    boxShadow: "0 2px 0 0 rgba(23, 100, 200, 0.85)",
  },
  panelTitle: {
    margin: 0,
    padding: 0,
    fontSize: "1rem",
    fontWeight: 700,
    color: "#17202a",
    textDecoration: { default: "none", ":hover": "underline" },
    cursor: "pointer",
  },
  panelBody: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    paddingLeft: "1rem",
  },
  count: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#667085",
    backgroundColor: "rgba(23, 32, 42, 0.06)",
    borderRadius: "999px",
    paddingTop: "0.1rem",
    paddingRight: "0.5rem",
    paddingBottom: "0.1rem",
    paddingLeft: "0.5rem",
  },
  panelActions: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
    marginLeft: "auto",
    maxWidth: "100%",
  },
  twisty: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.25rem",
    minWidth: "1.25rem",
    height: "1.25rem",
    padding: 0,
    borderWidth: 0,
    borderRadius: "6px",
    backgroundColor: "transparent",
    color: "#667085",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  miniButton: {
    paddingTop: "0.2rem",
    paddingRight: "0.5rem",
    paddingBottom: "0.2rem",
    paddingLeft: "0.5rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.18)",
    borderRadius: "8px",
    backgroundColor: "transparent",
    color: "#667085",
    fontSize: "0.72rem",
    cursor: "pointer",
  },
  miniLink: {
    display: "inline-block",
    boxSizing: "border-box",
    textDecoration: "none",
    fontFamily: "inherit",
    lineHeight: "normal",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
    paddingTop: "0.65rem",
    paddingRight: "0.75rem",
    paddingBottom: "0.65rem",
    paddingLeft: "0.75rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "12px",
    backgroundColor: "#fffdf8",
    boxShadow: "0 4px 14px rgba(23, 32, 42, 0.06)",
    cursor: "grab",
  },
  cardHighlight: {
    borderColor: "rgba(23, 100, 200, 0.7)",
    backgroundColor: "rgba(210, 228, 255, 0.55)",
    boxShadow: "0 0 0 2px rgba(23, 100, 200, 0.35)",
  },
  dragging: {
    opacity: 0.4,
    cursor: "grabbing",
  },
  cardTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#17202a",
  },
  cardId: {
    fontSize: "0.72rem",
    color: "#98a2b3",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  homePreview: {
    marginTop: "0.5rem",
    padding: "0",
  },
  badge: {
    fontSize: "0.68rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: "#667085",
    backgroundColor: "rgba(23, 32, 42, 0.06)",
    borderRadius: "6px",
    paddingTop: "0.1rem",
    paddingRight: "0.4rem",
    paddingBottom: "0.1rem",
    paddingLeft: "0.4rem",
  },
  pinnedBadge: {
    color: "#93370d",
    backgroundColor: "#fef0c7",
  },
  jarvisBadge: {
    color: "#6941c6",
    backgroundColor: "#f4ebff",
  },
  archivedBadge: {
    color: "#667085",
    backgroundColor: "rgba(23, 32, 42, 0.06)",
  },
  pinFieldset: {
    margin: 0,
    padding: 0,
    borderWidth: 0,
    display: "flex",
    flexDirection: "column",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
  },
  pinLegend: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  pinOption: {
    display: "flex",
    alignItems: "flex-start",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    paddingTop: "0.55rem",
    paddingRight: "0.65rem",
    paddingBottom: "0.55rem",
    paddingLeft: "0.65rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "10px",
    cursor: "pointer",
  },
  pinOptionText: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.15rem",
    columnGap: "0.15rem",
  },
  pinOptionLabel: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#17202a",
  },
  pinOptionHint: {
    fontSize: "0.78rem",
    color: "#667085",
  },
  empty: {
    margin: 0,
    padding: "0.6rem",
    textAlign: "center",
    fontSize: "0.78rem",
    color: "#98a2b3",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: "rgba(23, 32, 42, 0.16)",
    borderRadius: "10px",
  },
  emptyInto: {
    borderColor: "rgba(23, 100, 200, 0.6)",
    color: "#17202a",
    backgroundColor: "rgba(210, 228, 255, 0.5)",
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.15rem",
    columnGap: "0.15rem",
    marginBottom: "0.75rem",
  },
  crumbGroup: {
    display: "inline-flex",
    alignItems: "center",
    rowGap: "0.15rem",
    columnGap: "0.15rem",
  },
  crumb: {
    paddingTop: "0.15rem",
    paddingRight: "0.4rem",
    paddingBottom: "0.15rem",
    paddingLeft: "0.4rem",
    borderRadius: "6px",
    color: "#667085",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: { default: "none", ":hover": "underline" },
  },
  crumbCurrent: {
    color: "#17202a",
    cursor: "default",
    textDecoration: "none",
  },
  crumbSep: {
    color: "#98a2b3",
    fontSize: "0.8rem",
  },
  rootDrop: {
    marginTop: "0.25rem",
    padding: "0.6rem",
    textAlign: "center",
    fontSize: "0.78rem",
    color: "#98a2b3",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: "rgba(23, 32, 42, 0.16)",
    borderRadius: "10px",
  },
  rootDropActive: {
    borderColor: "rgba(23, 100, 200, 0.6)",
    color: "#17202a",
    backgroundColor: "rgba(210, 228, 255, 0.5)",
  },
  moveOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    backgroundColor: "rgba(23, 32, 42, 0.45)",
  },
  moveDialog: {
    width: "min(100%, 28rem)",
    maxHeight: "min(85vh, 32rem)",
    display: "flex",
    flexDirection: "column",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    padding: "1rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "18px",
    backgroundColor: "#fffdf8",
    boxShadow: "0 18px 48px rgba(23, 32, 42, 0.18)",
  },
  moveTitle: {
    margin: 0,
    fontSize: "1rem",
    fontWeight: 700,
    color: "#17202a",
  },
  moveHint: {
    margin: 0,
    fontSize: "0.82rem",
    color: "#667085",
  },
  moveBreadcrumb: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.15rem",
    columnGap: "0.15rem",
  },
  moveCrumbGroup: {
    display: "inline-flex",
    alignItems: "center",
    rowGap: "0.15rem",
    columnGap: "0.15rem",
  },
  moveCrumb: {
    paddingTop: "0.15rem",
    paddingRight: "0.4rem",
    paddingBottom: "0.15rem",
    paddingLeft: "0.4rem",
    borderWidth: 0,
    borderRadius: "6px",
    backgroundColor: "transparent",
    color: "#667085",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  moveCrumbCurrent: {
    color: "#17202a",
    cursor: "default",
  },
  moveList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "12px",
    backgroundColor: "rgba(255, 255, 255, 0.6)",
    paddingBlock: "0.35rem",
    paddingInline: "0.35rem",
  },
  moveFolderRow: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    width: "100%",
    paddingTop: "0.55rem",
    paddingRight: "0.65rem",
    paddingBottom: "0.55rem",
    paddingLeft: "0.65rem",
    borderWidth: 0,
    borderRadius: "8px",
    backgroundColor: {
      default: "transparent",
      ":hover": "rgba(23, 32, 42, 0.06)",
    },
    color: "#17202a",
    fontSize: "0.88rem",
    fontWeight: 600,
    textAlign: "left",
    cursor: "pointer",
  },
  moveFolderName: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  moveFolderChevron: {
    color: "#98a2b3",
    fontSize: "0.8rem",
  },
  moveListEmpty: {
    padding: "0.75rem",
    textAlign: "center",
    fontSize: "0.78rem",
    color: "#98a2b3",
  },
  moveActions: {
    display: "flex",
    justifyContent: "flex-end",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
  },
});
