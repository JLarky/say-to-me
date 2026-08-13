import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";

import { isQuickSearchPath } from "../../quick-search-path.ts";
import { isQuickSearchShortcutEvent } from "./chrome-icons.tsx";
import { QuickSearchPalette } from "./QuickSearchPalette.tsx";

type QuickSearchContextValue = {
  openQuickSearch: (trigger?: HTMLElement | null) => void;
  closeQuickSearch: () => void;
  isOpen: boolean;
};

const QuickSearchContext = createContext<QuickSearchContextValue | null>(null);

export function useQuickSearch(): QuickSearchContextValue {
  const value = useContext(QuickSearchContext);
  if (!value) {
    throw new Error("useQuickSearch must be used within QuickSearchController.");
  }
  return value;
}

export function useOptionalQuickSearch(): QuickSearchContextValue | null {
  return useContext(QuickSearchContext);
}

function anotherModalOpen(): boolean {
  for (const el of document.querySelectorAll('[aria-modal="true"]')) {
    if (el.closest("[data-quick-search-palette]")) continue;
    return true;
  }
  return false;
}

export function QuickSearchController({ children }: { children: ReactNode }) {
  const location = useLocation();
  const scoped = isQuickSearchPath(location.pathname);
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closeQuickSearch = useCallback(() => {
    setOpen(false);
  }, []);

  const openQuickSearch = useCallback(
    (trigger?: HTMLElement | null) => {
      if (!isQuickSearchPath(location.pathname)) return;
      if (anotherModalOpen() && !open) return;
      if (open) {
        const input = document.querySelector<HTMLInputElement>("[data-quick-search-input]");
        input?.focus();
        input?.select();
        return;
      }
      returnFocusRef.current =
        trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setOpen(true);
    },
    [location.pathname, open],
  );

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!scoped) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!isQuickSearchShortcutEvent(event)) return;
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (anotherModalOpen() && !open) return;
      event.preventDefault();
      openQuickSearch(
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
      );
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openQuickSearch, scoped]);

  const value = useMemo(
    () => ({ openQuickSearch, closeQuickSearch, isOpen: open }),
    [closeQuickSearch, open, openQuickSearch],
  );

  return (
    <QuickSearchContext.Provider value={value}>
      {children}
      {open && scoped ? (
        <QuickSearchPalette onClose={closeQuickSearch} returnFocusTo={returnFocusRef.current} />
      ) : null}
    </QuickSearchContext.Provider>
  );
}
