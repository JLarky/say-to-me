import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import * as stylex from "@stylexjs/stylex";

import {
  fetchDashboardPlacement,
  fetchSpaceState,
  placeSession,
  type DashboardPlacement,
} from "../spaces-api.ts";
import type { PrototypeSpace } from "../new-space-prototype.ts";
import { dialogs } from "./page/NewDashboardDialogs.stylex.ts";
import { Icon } from "./page/NewDashboardChrome.tsx";

function spacePath(spaces: PrototypeSpace[], spaceId: string): string {
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const parts: string[] = [];
  let current = byId.get(spaceId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" / ") || "All spaces";
}

function childrenOf(spaces: PrototypeSpace[], parentId: string | null): PrototypeSpace[] {
  return spaces
    .filter((space) => !space.archived && space.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function crumbsTo(spaces: PrototypeSpace[], spaceId: string | null): PrototypeSpace[] {
  if (!spaceId) return [];
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const crumbs: PrototypeSpace[] = [];
  let current = byId.get(spaceId);
  while (current) {
    crumbs.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return crumbs;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.tabIndex !== -1 && el.getAttribute("aria-hidden") !== "true");
}

const warningStyles = stylex.create({
  warn: {
    marginTop: "12px",
    marginBottom: "12px",
    paddingBlock: "10px",
    paddingInline: "12px",
    borderRadius: "10px",
    backgroundColor: "#2a2416",
    color: "#f5d48a",
    fontSize: "13px",
    lineHeight: 1.4,
  },
  error: {
    marginTop: "12px",
    marginBottom: "12px",
    paddingBlock: "10px",
    paddingInline: "12px",
    borderRadius: "10px",
    backgroundColor: "#2a1716",
    color: "#f5a89a",
    fontSize: "13px",
    lineHeight: 1.4,
  },
  info: {
    marginTop: "12px",
    marginBottom: "12px",
    paddingBlock: "10px",
    paddingInline: "12px",
    borderRadius: "10px",
    backgroundColor: "#1a2420",
    color: "#b7e0c8",
    fontSize: "13px",
    lineHeight: 1.4,
  },
});

export function AttachSessionDialog({
  sessionId,
  initialPlacement,
  onClose,
  returnFocusTo,
}: {
  sessionId: string;
  initialPlacement: DashboardPlacement;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const navigate = useNavigate();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [spaces, setSpaces] = useState<PrototypeSpace[]>([]);
  const [browseSpaceId, setBrowseSpaceId] = useState<string | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [placement, setPlacement] = useState(initialPlacement);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [takenOver, setTakenOver] = useState<{
    spaceName: string;
    path: string;
  } | null>(null);

  const mode = placement.chooserMode ?? "claim";
  const activeSpaces = spaces.filter((space) => !space.archived);
  const selectedSpace = selectedSpaceId
    ? activeSpaces.find((space) => space.id === selectedSpaceId)
    : undefined;
  const moveChildren = childrenOf(activeSpaces, browseSpaceId);
  const moveCrumbs = crumbsTo(activeSpaces, browseSpaceId);
  const normalizedSearch = search.trim().toLowerCase();
  const searchResults = normalizedSearch
    ? activeSpaces
        .map((space) => ({ space, path: spacePath(activeSpaces, space.id) }))
        .filter(
          ({ space, path }) =>
            space.name.toLowerCase().includes(normalizedSearch) ||
            path.toLowerCase().includes(normalizedSearch),
        )
    : [];

  useEffect(() => {
    let cancelled = false;
    void fetchSpaceState()
      .then((state) => {
        if (cancelled) return;
        setSpaces(state.spaces);
        setLoadingSpaces(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load spaces.");
        setLoadingSpaces(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const inertTargets: HTMLElement[] = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.hasAttribute("data-attach-session-dialog")) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inertTargets.push(child);
    }
    const frame = requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      for (const el of inertTargets) el.removeAttribute("inert");
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) {
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
  }, [onClose, submitting]);

  const previewRequestRef = useRef(0);

  useEffect(() => {
    const target = selectedSpaceId ?? browseSpaceId;
    if (!target) return;
    const requestId = ++previewRequestRef.current;
    let cancelled = false;
    void fetchDashboardPlacement(sessionId, target)
      .then((next) => {
        if (cancelled || requestId !== previewRequestRef.current) return;
        setPlacement(next);
      })
      .catch(() => {
        // Keep previous placement; preview is informational.
      });
    return () => {
      cancelled = true;
    };
  }, [browseSpaceId, selectedSpaceId, sessionId]);

  function chooseSearchResult(spaceId: string) {
    setBrowseSpaceId(spaceId);
    setSelectedSpaceId(spaceId);
    setSearch("");
    setSearchIndex(0);
  }

  async function confirm() {
    if (!selectedSpaceId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await placeSession(
        selectedSpaceId,
        sessionId,
        mode,
        mode === "move" ? (placement.ownerSpaceId ?? undefined) : undefined,
      );
      onClose();
      void navigate(result.placement?.canonicalDashboardPath ?? `/dashboard/${selectedSpaceId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to attach session.";
      try {
        const fresh = await fetchDashboardPlacement(sessionId);
        setPlacement(fresh);
        if (
          fresh.ownerSpaceId &&
          fresh.canonicalDashboardPath &&
          !fresh.needsChooser &&
          !fresh.ownerArchived
        ) {
          setTakenOver({
            spaceName: fresh.ownerSpaceName || "another space",
            path: fresh.canonicalDashboardPath,
          });
          setSelectedSpaceId(null);
          setBrowseSpaceId(null);
          setError(null);
          setSubmitting(false);
          return;
        }
        // Owned but still needs a chooser (e.g. archived owner) — refresh into move mode.
        if (fresh.chooserMode === "move") {
          setTakenOver(null);
          setSelectedSpaceId(null);
        }
      } catch {
        // Keep the original error if refresh fails.
      }
      setError(message);
      setSubmitting(false);
    }
  }

  function goToTakenOverDashboard() {
    if (!takenOver) return;
    onClose();
    void navigate(takenOver.path);
  }

  const alreadyHere =
    Boolean(selectedSpaceId) &&
    ((mode === "claim" && placement.ownerSpaceId === selectedSpaceId) ||
      (mode === "move" && placement.ownerSpaceId === selectedSpaceId));

  const node = (
    <div {...stylex.props(dialogs.layer)} data-attach-session-dialog>
      <button
        {...stylex.props(dialogs.backdrop)}
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={submitting}
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <section
        ref={dialogRef}
        {...stylex.props(dialogs.moveModal)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-attach-modal
      >
        <div {...stylex.props(dialogs.moveModalBody)}>
          <header {...stylex.props(dialogs.header)}>
            <div>
              <small {...stylex.props(dialogs.eyebrow)}>
                {mode === "move" ? "MOVE SESSION" : "ATTACH SESSION"}
              </small>
              <h2 {...stylex.props(dialogs.title)} id={titleId}>
                {mode === "move" ? "Move" : "Attach"} “{placement.title}”
              </h2>
            </div>
            <button
              {...stylex.props(dialogs.close)}
              type="button"
              aria-label="Close"
              disabled={submitting}
              onClick={() => {
                if (!submitting) onClose();
              }}
            >
              ×
            </button>
          </header>
          <p {...stylex.props(dialogs.description)}>
            {takenOver
              ? "Another client attached this session while this dialog was open."
              : "Choose a space. Files and working directory are not moved — only space ownership and attachments change."}
          </p>
          <div {...stylex.props(dialogs.cwdBlock)}>
            <span {...stylex.props(dialogs.cwdLabel)}>WORKING DIRECTORY</span>
            <code {...stylex.props(dialogs.cwdPath)}>{placement.cwd || "None"}</code>
          </div>
          {takenOver ? (
            <p {...stylex.props(warningStyles.info)} data-attach-taken-over>
              This session is now attached to {takenOver.spaceName}.
            </p>
          ) : (
            <>
              {placement.preview.warnings.map((warning) => (
                <p key={warning} {...stylex.props(warningStyles.warn)} data-attach-warning>
                  {warning}
                </p>
              ))}
              {error ? (
                <p {...stylex.props(warningStyles.error)} data-attach-error>
                  {error}
                </p>
              ) : null}
            </>
          )}
          {!takenOver ? (
            <>
              <div {...stylex.props(dialogs.searchWrap)} data-move-search>
                <div {...stylex.props(dialogs.searchField)} data-attach-search-field>
                  <span {...stylex.props(dialogs.searchIcon)}>
                    <Icon name="search" />
                  </span>
                  <input
                    ref={searchRef}
                    {...stylex.props(dialogs.searchInput)}
                    data-attach-search-input
                    role="combobox"
                    aria-label="Search destination spaces"
                    aria-autocomplete="list"
                    aria-expanded={Boolean(normalizedSearch)}
                    placeholder="Search spaces…"
                    value={search}
                    disabled={submitting || loadingSpaces}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setSearchIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (search) {
                          setSearch("");
                          setSearchIndex(0);
                        } else if (!submitting) {
                          onClose();
                        }
                        return;
                      }
                      if (!searchResults.length) return;
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSearchIndex((index) => (index + 1) % searchResults.length);
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSearchIndex(
                          (index) => (index - 1 + searchResults.length) % searchResults.length,
                        );
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        chooseSearchResult(searchResults[searchIndex].space.id);
                      }
                    }}
                  />
                  {search ? (
                    <button
                      {...stylex.props(dialogs.clearSearch)}
                      type="button"
                      aria-label="Clear search"
                      onClick={() => {
                        setSearch("");
                        setSearchIndex(0);
                        searchRef.current?.focus();
                      }}
                    >
                      ×
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                {normalizedSearch ? (
                  <div {...stylex.props(dialogs.results)} role="listbox">
                    {searchResults.length ? (
                      searchResults.map(({ space, path }, index) => (
                        <button
                          {...stylex.props(
                            dialogs.result,
                            index === searchIndex && dialogs.resultActive,
                          )}
                          type="button"
                          role="option"
                          aria-selected={index === searchIndex}
                          key={space.id}
                          onMouseEnter={() => setSearchIndex(index)}
                          onClick={() => chooseSearchResult(space.id)}
                        >
                          <span {...stylex.props(dialogs.resultIcon)}>
                            <Icon name="folder" />
                          </span>
                          <span>
                            <strong {...stylex.props(dialogs.resultTitle)}>{space.name}</strong>
                            {path !== space.name ? (
                              <small {...stylex.props(dialogs.resultPath)}>{path}</small>
                            ) : null}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div {...stylex.props(dialogs.noResults)}>No matching spaces</div>
                    )}
                  </div>
                ) : null}
              </div>
              <nav {...stylex.props(dialogs.breadcrumb)} aria-label="Attach destination">
                <button
                  {...stylex.props(
                    dialogs.breadcrumbButton,
                    browseSpaceId === null && dialogs.breadcrumbCurrent,
                  )}
                  type="button"
                  disabled={submitting}
                  onClick={() => setBrowseSpaceId(null)}
                >
                  All spaces
                </button>
                {moveCrumbs.map((space) => (
                  <span {...stylex.props(dialogs.breadcrumbPart)} key={space.id}>
                    <i {...stylex.props(dialogs.breadcrumbSeparator)}>/</i>
                    <button
                      {...stylex.props(
                        dialogs.breadcrumbButton,
                        space.id === browseSpaceId && dialogs.breadcrumbCurrent,
                      )}
                      type="button"
                      disabled={submitting}
                      onClick={() => setBrowseSpaceId(space.id)}
                    >
                      {space.name}
                    </button>
                  </span>
                ))}
              </nav>
              {loadingSpaces || moveChildren.length > 0 ? (
                <ul
                  {...stylex.props(dialogs.moveList)}
                  role="radiogroup"
                  aria-label="Destination spaces"
                >
                  {loadingSpaces ? (
                    <li {...stylex.props(dialogs.emptyMoveList)}>Loading spaces…</li>
                  ) : (
                    moveChildren.map((space) => {
                      const childCount = childrenOf(activeSpaces, space.id).length;
                      const selected = selectedSpaceId === space.id;
                      return (
                        <li key={space.id}>
                          <div {...stylex.props(dialogs.moveItemRow)}>
                            <button
                              {...stylex.props(
                                dialogs.moveItem,
                                dialogs.moveItemSelect,
                                selected && dialogs.moveItemSelected,
                              )}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              data-selected={selected ? "true" : undefined}
                              disabled={submitting}
                              onClick={() => setSelectedSpaceId(space.id)}
                            >
                              <span {...stylex.props(dialogs.moveItemName)}>{space.name}</span>
                              {selected ? <span aria-hidden="true">✓</span> : null}
                            </button>
                            {childCount > 0 ? (
                              <button
                                {...stylex.props(dialogs.moveItemDrill)}
                                type="button"
                                aria-label={`Browse inside ${space.name}`}
                                disabled={submitting}
                                onClick={() => setBrowseSpaceId(space.id)}
                              >
                                ›
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
        <footer {...stylex.props(dialogs.footer, dialogs.moveModalFooterSticky)}>
          <button
            {...stylex.props(dialogs.button)}
            type="button"
            disabled={submitting}
            onClick={() => {
              if (!submitting) onClose();
            }}
          >
            {takenOver ? "Close" : "Cancel"}
          </button>
          {takenOver ? (
            <button
              {...stylex.props(dialogs.button, dialogs.primaryButton)}
              type="button"
              data-attach-go-dashboard
              onClick={goToTakenOverDashboard}
            >
              Go to dashboard
            </button>
          ) : (
            <button
              {...stylex.props(
                dialogs.button,
                dialogs.primaryButton,
                (!selectedSpaceId || alreadyHere || submitting) && dialogs.disabledButton,
              )}
              type="button"
              data-attach-confirm
              disabled={!selectedSpaceId || alreadyHere || submitting}
              onClick={() => void confirm()}
            >
              {submitting
                ? "Attaching…"
                : selectedSpace
                  ? `Attach to ${selectedSpace.name}`
                  : "Choose a space"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );

  return createPortal(node, document.body);
}
