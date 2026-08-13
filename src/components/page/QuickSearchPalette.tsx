import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { safeResponseJson } from "@say-to-me/runtime-validation";
import { fetchQuickSearch, type QuickSearchResult } from "../../quick-search-api.ts";
import { buildQuickSearchActions, type QuickSearchAction } from "../../quick-search-actions.ts";
import {
  highlightMatch,
  isIdMatchReason,
  sessionSecondaryLine,
  spaceSecondaryLine,
} from "../../quick-search-display.ts";
import { importSessionById, sessionHrefForId } from "../../session-import-api.ts";
import { CliSessionPayload } from "../../types.ts";
import { Icon } from "./chrome-icons.tsx";
import { quickSearch } from "./QuickSearchPalette.stylex.ts";

function getFocusable(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.tabIndex !== -1 && el.getAttribute("aria-hidden") !== "true");
}

type FlatItem =
  | { kind: "session"; id: string; href: string; index: number }
  | { kind: "space"; id: string; href: string; index: number }
  | { kind: "action"; action: QuickSearchAction; index: number };

function EntityIcon({ kind }: { kind: "session" | "space" | "action" }) {
  return (
    <span
      {...stylex.props(
        quickSearch.entityIcon,
        kind === "session"
          ? quickSearch.entityIconSession
          : kind === "space"
            ? quickSearch.entityIconSpace
            : quickSearch.entityIconAction,
      )}
      aria-hidden="true"
      data-entity-icon={kind}
    >
      <svg {...stylex.props(quickSearch.entityIconSvg)} viewBox="0 0 20 20">
        {kind === "session" ? (
          <path d="M4 5h12v9H9l-4 3v-3H4Z" />
        ) : kind === "space" ? (
          <path d="M3 6h5l2 2h7v8H3Z" />
        ) : (
          <path d="M10 4v12M4 10h12" />
        )}
      </svg>
    </span>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const parts = highlightMatch(text, query);
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{part}</span>
        ) : (
          <mark key={index} {...stylex.props(quickSearch.matchMark)}>
            {part.match}
          </mark>
        ),
      )}
    </>
  );
}

function lockDocumentScroll(): () => void {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const html = document.documentElement;
  const body = document.body;
  const previous = {
    htmlOverflow: html.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
  };

  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";

  return () => {
    html.style.overflow = previous.htmlOverflow;
    body.style.overflow = previous.bodyOverflow;
    body.style.position = previous.bodyPosition;
    body.style.top = previous.bodyTop;
    body.style.left = previous.bodyLeft;
    body.style.right = previous.bodyRight;
    body.style.width = previous.bodyWidth;
    window.scrollTo(scrollX, scrollY);
  };
}

export function QuickSearchPalette({
  onClose,
  returnFocusTo,
  initialQuery = "",
}: {
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  initialQuery?: string;
}) {
  const navigate = useNavigate();
  const params = useParams();
  const currentSpaceId = params.spaceId ?? null;
  const titleId = useId();
  const listId = useId();
  const statusId = useId();
  const sessionsGroupLabelId = useId();
  const spacesGroupLabelId = useId();
  const actionsGroupLabelId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QuickSearchResult | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const actions = useMemo(
    () =>
      buildQuickSearchActions({
        query,
        localSessionIds: result?.sessions.map((session) => session.id) ?? [],
      }),
    [query, result],
  );

  const flatItems = useMemo<FlatItem[]>(() => {
    if (loading) return [];
    const items: FlatItem[] = [];
    let index = 0;
    for (const session of result?.sessions ?? []) {
      items.push({ kind: "session", id: session.id, href: session.href, index: index++ });
    }
    for (const space of result?.spaces ?? []) {
      items.push({ kind: "space", id: space.id, href: space.href, index: index++ });
    }
    for (const action of actions) {
      items.push({ kind: "action", action, index: index++ });
    }
    return items;
  }, [actions, loading, result]);

  useEffect(() => {
    const el = optionRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, flatItems]);

  useEffect(() => {
    if (flatItems.length === 0) return;
    if (activeIndex >= flatItems.length) setActiveIndex(flatItems.length - 1);
  }, [activeIndex, flatItems.length]);

  useEffect(() => {
    const unlockScroll = lockDocumentScroll();
    const inertTargets: HTMLElement[] = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.hasAttribute("data-quick-search-palette")) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inertTargets.push(child);
    }
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      cancelAnimationFrame(frame);
      unlockScroll();
      for (const el of inertTargets) el.removeAttribute("inert");
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = getFocusable(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  useEffect(() => {
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Invalidate selectable results immediately so Enter cannot navigate stale hits.
    setResult(null);
    setActiveIndex(0);
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      void fetchQuickSearch(query, {
        currentSpaceId,
        signal: controller.signal,
      })
        .then((data) => {
          if (generation !== generationRef.current) return;
          setResult(data);
          setActiveIndex(0);
          setLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted || generation !== generationRef.current) return;
          setError(err instanceof Error ? err.message : "Quick search failed.");
          setResult(null);
          setActiveIndex(0);
          setLoading(false);
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentSpaceId, query]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  function selectHref(href: string) {
    onClose();
    void navigate(href);
  }

  async function runAction(action: QuickSearchAction) {
    if (actionBusy) return;
    if (action.kind === "import-session" && action.sessionId) {
      setActionBusy(true);
      setError("");
      try {
        await importSessionById(action.sessionId);
        selectHref(sessionHrefForId(action.sessionId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to import session.");
        setActionBusy(false);
      }
      return;
    }
    if (action.kind === "create-voice-session" && action.sessionId) {
      setActionBusy(true);
      setError("");
      try {
        const name = action.sessionId.startsWith("vo_")
          ? action.sessionId.slice(3)
          : action.sessionId;
        const response = await fetch("/api/cli-sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "voice", name }),
        });
        if (!response.ok) {
          throw new Error("Unable to create voice-only session.");
        }
        const payload = await safeResponseJson(response, CliSessionPayload);
        const createdId = payload.session.id;
        selectHref(sessionHrefForId(createdId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to create voice-only session.");
        setActionBusy(false);
      }
      return;
    }
    if (action.href) selectHref(action.href);
  }

  function activateItem(item: FlatItem | undefined) {
    if (!item || actionBusy) return;
    if (item.kind === "action") {
      void runAction(item.action);
      return;
    }
    selectHref(item.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatItems.length === 0) return;
      setActiveIndex((index) => (index + 1) % flatItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatItems.length === 0) return;
      setActiveIndex((index) => (index - 1 + flatItems.length) % flatItems.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      if (flatItems.length > 0) setActiveIndex(flatItems.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (loading || actionBusy) return;
      activateItem(flatItems[activeIndex]);
    }
  }

  const activeOptionId =
    flatItems[activeIndex] != null ? `${listId}-option-${flatItems[activeIndex].index}` : undefined;
  const sessionCount = result?.sessions.length ?? 0;
  const spaceCount = result?.spaces.length ?? 0;
  const actionCount = actions.length;
  const statusText = error
    ? error
    : loading
      ? "Searching…"
      : actionBusy
        ? "Importing…"
        : `${sessionCount} session${sessionCount === 1 ? "" : "s"}, ${spaceCount} space${spaceCount === 1 ? "" : "s"}${actionCount ? `, ${actionCount} action${actionCount === 1 ? "" : "s"}` : ""}`;

  const firstActionIndex = sessionCount + spaceCount;

  return createPortal(
    <div
      {...stylex.props(quickSearch.backdrop)}
      data-quick-search-palette
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        {...stylex.props(quickSearch.dialog)}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} {...stylex.props(quickSearch.visuallyHidden)}>
          Quick search
        </h2>
        <div {...stylex.props(quickSearch.inputRow)}>
          <Icon name="search" />
          <input
            {...stylex.props(quickSearch.input)}
            ref={inputRef}
            data-quick-search-input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-describedby={statusId}
            aria-busy={loading}
            placeholder="Search sessions and spaces…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
          <button
            {...stylex.props(quickSearch.closeButton)}
            type="button"
            data-quick-search-close
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div
          {...stylex.props(quickSearch.status, error ? quickSearch.error : null)}
          id={statusId}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </div>
        <div
          {...stylex.props(quickSearch.list)}
          id={listId}
          role="listbox"
          aria-label="Results"
          aria-busy={loading}
        >
          {!loading && flatItems.length === 0 ? (
            <div {...stylex.props(quickSearch.empty)}>No matching sessions or spaces</div>
          ) : null}
          {result && result.sessions.length > 0 ? (
            <div role="group" aria-labelledby={sessionsGroupLabelId}>
              <div {...stylex.props(quickSearch.groupLabel)} id={sessionsGroupLabelId}>
                Sessions
              </div>
              {result.sessions.map((session, sessionIndex) => {
                const flatIndex = sessionIndex;
                const active = flatIndex === activeIndex;
                const showIdBadge = isIdMatchReason(session.matchReason);
                return (
                  <button
                    {...stylex.props(quickSearch.option, active && quickSearch.optionActive)}
                    key={`session:${session.id}`}
                    id={`${listId}-option-${flatIndex}`}
                    ref={(el) => {
                      optionRefs.current[flatIndex] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-quick-search-kind="session"
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    onClick={() =>
                      activateItem({
                        kind: "session",
                        id: session.id,
                        href: session.href,
                        index: flatIndex,
                      })
                    }
                  >
                    <EntityIcon kind="session" />
                    <span {...stylex.props(quickSearch.optionBody)}>
                      <span {...stylex.props(quickSearch.optionTitle)}>
                        <HighlightedText text={session.title} query={query} />
                      </span>
                      <div {...stylex.props(quickSearch.optionMeta)}>
                        {sessionSecondaryLine({
                          id: session.id,
                          ownerSpaceName: session.ownerSpaceName,
                        })}
                      </div>
                    </span>
                    <span {...stylex.props(quickSearch.badges)}>
                      {session.archived ? (
                        <span {...stylex.props(quickSearch.badge)}>Archived</span>
                      ) : null}
                      {showIdBadge ? (
                        <span {...stylex.props(quickSearch.badge, quickSearch.idBadge)}>
                          ID match
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {result && result.spaces.length > 0 ? (
            <div role="group" aria-labelledby={spacesGroupLabelId}>
              <div {...stylex.props(quickSearch.groupLabel)} id={spacesGroupLabelId}>
                Spaces
              </div>
              {result.spaces.map((space, spaceIndex) => {
                const flatIndex = sessionCount + spaceIndex;
                const active = flatIndex === activeIndex;
                return (
                  <button
                    {...stylex.props(quickSearch.option, active && quickSearch.optionActive)}
                    key={`space:${space.id}`}
                    id={`${listId}-option-${flatIndex}`}
                    ref={(el) => {
                      optionRefs.current[flatIndex] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-quick-search-kind="space"
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    onClick={() =>
                      activateItem({
                        kind: "space",
                        id: space.id,
                        href: space.href,
                        index: flatIndex,
                      })
                    }
                  >
                    <EntityIcon kind="space" />
                    <span {...stylex.props(quickSearch.optionBody)}>
                      <span {...stylex.props(quickSearch.optionTitle)}>
                        <HighlightedText text={space.name} query={query} />
                      </span>
                      <div {...stylex.props(quickSearch.optionMeta)}>
                        {spaceSecondaryLine({ context: space.context, id: space.id })}
                      </div>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {!loading && actions.length > 0 ? (
            <div role="group" aria-labelledby={actionsGroupLabelId}>
              <div {...stylex.props(quickSearch.groupLabel)} id={actionsGroupLabelId}>
                Actions
              </div>
              {actions.map((action, actionIndex) => {
                const flatIndex = firstActionIndex + actionIndex;
                const active = flatIndex === activeIndex;
                return (
                  <button
                    {...stylex.props(quickSearch.option, active && quickSearch.optionActive)}
                    key={action.id}
                    id={`${listId}-option-${flatIndex}`}
                    ref={(el) => {
                      optionRefs.current[flatIndex] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-quick-search-kind="action"
                    data-quick-search-action={action.kind}
                    disabled={actionBusy}
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    onClick={() => activateItem({ kind: "action", action, index: flatIndex })}
                  >
                    <EntityIcon kind="action" />
                    <span {...stylex.props(quickSearch.optionBody)}>
                      <span {...stylex.props(quickSearch.optionTitle)}>{action.title}</span>
                      <div {...stylex.props(quickSearch.optionMeta)}>{action.meta}</div>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
