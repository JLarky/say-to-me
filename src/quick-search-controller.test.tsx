/** @vitest-environment jsdom */
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QuickSearchController } from "./components/page/QuickSearchController.tsx";
import { Topbar } from "./components/page/NewDashboardChrome.tsx";
import { isQuickSearchShortcutEvent } from "./components/page/chrome-icons.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="pathname" data-pathname={location.pathname} data-search={location.search} />
  );
}

function emptyResult(query = "") {
  return { query, sessions: [], spaces: [] };
}

function demoResult(query = "") {
  return {
    query,
    sessions: [
      {
        id: "ses_8a6e1aba4983dIrSSmkVUyda9N",
        title: "Demo",
        alias: null,
        state: "general",
        archived: false,
        ownerSpaceId: null,
        ownerSpaceName: null,
        href: "/ses/ses_8a6e1aba4983dIrSSmkVUyda9N",
        matchReason: query ? "substring-alias" : "recent",
      },
    ],
    spaces: [
      {
        id: "space-one",
        name: "One",
        context: "ctx",
        href: "/dashboard/space-one",
        matchReason: query ? "substring-name" : "recent",
      },
    ],
  };
}

describe("QuickSearchController", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    fetchMock = vi.fn(async () => Response.json(demoResult()));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.querySelectorAll("[data-quick-search-palette]").forEach((el) => el.remove());
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, 0);
    for (const child of document.body.children) {
      if (child instanceof HTMLElement) child.removeAttribute("inert");
    }
  });

  function renderAt(path: string, children?: ReactNode) {
    root = createRoot(container!);
    act(() => {
      root!.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="*"
              element={
                <QuickSearchController>
                  {children ?? <Topbar title="Search" />}
                  <LocationProbe />
                </QuickSearchController>
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  async function openFromTopbar() {
    const trigger = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Quick search"]',
    )!;
    await act(async () => {
      trigger.click();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 200));
    });
    return trigger;
  }

  it("opens from topbar and restores focus on Escape", async () => {
    renderAt("/search");
    const trigger = await openFromTopbar();
    expect(document.querySelector("[data-quick-search-palette]")).toBeTruthy();
    expect(document.querySelector("[data-quick-search-close]")).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[data-quick-search-palette]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes via visible Close button and restores focus", async () => {
    renderAt("/search");
    const trigger = await openFromTopbar();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-quick-search-close]")!.click();
    });
    expect(document.querySelector("[data-quick-search-palette]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("locks html and body scroll and restores exact prior styles and position", async () => {
    let scrollY = 0;
    let scrollX = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    Object.defineProperty(window, "scrollX", {
      configurable: true,
      get: () => scrollX,
    });
    window.scrollTo = ((...args: unknown[]) => {
      if (args.length === 1 && args[0] && typeof args[0] === "object") {
        const opts = args[0] as ScrollToOptions;
        if (typeof opts.left === "number") scrollX = opts.left;
        if (typeof opts.top === "number") scrollY = opts.top;
        return;
      }
      if (typeof args[0] === "number") scrollX = args[0];
      if (typeof args[1] === "number") scrollY = args[1];
    }) as typeof window.scrollTo;

    scrollY = 120;
    document.documentElement.style.overflow = "visible";
    document.body.style.overflow = "";

    renderAt("/search");
    await openFromTopbar();

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-120px");
    expect(container!.hasAttribute("inert")).toBe(true);

    // While locked, attempts to change window scroll must not stick past unlock.
    window.scrollTo(0, 60);
    expect(document.body.style.top).toBe("-120px");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.documentElement.style.overflow).toBe("visible");
    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.position).toBe("");
    expect(document.body.style.top).toBe("");
    expect(window.scrollY).toBe(120);
    expect(container!.hasAttribute("inert")).toBe(false);
  });

  it("wraps Tab focus inside the dialog", async () => {
    renderAt("/search");
    await openFromTopbar();
    const dialog = document.querySelector<HTMLElement>(
      '[data-quick-search-palette] [role="dialog"]',
    )!;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.tabIndex !== -1);
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
    first.focus();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(last);
  });

  it("second shortcut refocuses the input while open", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    renderAt("/search");
    await openFromTopbar();
    const input = document.querySelector<HTMLInputElement>("[data-quick-search-input]")!;
    input.blur();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(input);
  });

  it("closes when the route changes", async () => {
    root = createRoot(container!);
    let path = "/search";
    function Harness() {
      return (
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="*"
              element={
                <QuickSearchController>
                  <Topbar title="Search" />
                </QuickSearchController>
              }
            />
          </Routes>
        </MemoryRouter>
      );
    }
    act(() => {
      root!.render(<Harness />);
    });
    await openFromTopbar();
    expect(document.querySelector("[data-quick-search-palette]")).toBeTruthy();
    path = "/settings";
    act(() => {
      root!.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <Routes>
            <Route
              path="*"
              element={
                <QuickSearchController>
                  <Topbar title="Settings" />
                </QuickSearchController>
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    expect(document.querySelector("[data-quick-search-palette]")).toBeNull();
  });

  it("does not open on settings via hotkey", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    renderAt("/settings", <div>settings</div>);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
    });
    expect(document.querySelector("[data-quick-search-palette]")).toBeNull();
  });

  it("suppresses shortcut while another modal is open", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    const other = document.createElement("div");
    other.setAttribute("aria-modal", "true");
    document.body.append(other);
    renderAt("/search");
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
    });
    expect(document.querySelector("[data-quick-search-palette]")).toBeNull();
    other.remove();
  });

  it("ignores Ctrl+K on macOS and Meta+K on Linux", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    renderAt("/search");
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
    expect(document.querySelector("[data-quick-search-palette]")).toBeNull();

    Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
    });
    expect(document.querySelector("[data-quick-search-palette]")).toBeNull();
    expect(
      isQuickSearchShortcutEvent(
        { key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        "Linux x86_64",
      ),
    ).toBe(true);
  });

  it("does not steal focus from the message-search page input via shortcut when typing", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    renderAt(
      "/search",
      <>
        <Topbar title="Search" />
        <input data-testid="page-search" defaultValue="" />
      </>,
    );
    const pageInput = container!.querySelector<HTMLInputElement>('[data-testid="page-search"]')!;
    pageInput.focus();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 200));
    });
    // Shortcut still opens on /search (allowed path); page input is return focus target.
    expect(document.querySelector("[data-quick-search-palette]")).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.activeElement).toBe(pageInput);
  });

  it("ignores Enter while a new query is loading (stale selection guard)", async () => {
    vi.useFakeTimers();
    let resolveSearch: ((value: Response) => void) | null = null;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveSearch = resolve;
        }),
    );

    renderAt("/search");
    const trigger = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Quick search"]',
    )!;
    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      vi.advanceTimersByTime(160);
    });
    resolveSearch!(Response.json(demoResult()));
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('[data-quick-search-kind="session"]')).toBeTruthy();

    const input = document.querySelector<HTMLInputElement>("[data-quick-search-input]")!;
    let nextResolve: ((value: Response) => void) | null = null;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          nextResolve = resolve;
        }),
    );

    await act(async () => {
      // jsdom + React controlled input: set prototype value then fire input.
      // eslint-disable-next-line typescript/unbound-method -- call() rebinds `this` to the input
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      valueSetter.call(input, "zzzz-no-result-two");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-quick-search-kind="session"]')).toBeNull();

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(
      container!.querySelector('[data-testid="pathname"]')?.getAttribute("data-pathname"),
    ).toBe("/search");

    await act(async () => {
      vi.advanceTimersByTime(160);
    });
    nextResolve!(Response.json(emptyResult("zzzz-no-result-two")));
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector("[data-quick-search-palette]")).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="pathname"]')?.getAttribute("data-pathname"),
    ).toBe("/search");
  });

  it("navigates to session and space hrefs from keyboard and mouse", async () => {
    renderAt("/search");
    await openFromTopbar();
    const input = document.querySelector<HTMLInputElement>("[data-quick-search-input]")!;

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(
      container!.querySelector('[data-testid="pathname"]')?.getAttribute("data-pathname"),
    ).toBe("/ses/ses_8a6e1aba4983dIrSSmkVUyda9N");

    act(() => root?.unmount());
    document.body.querySelectorAll("[data-quick-search-palette]").forEach((el) => el.remove());
    renderAt("/dashboard");
    await openFromTopbar();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-quick-search-kind="space"]')!.click();
    });
    expect(
      container!.querySelector('[data-testid="pathname"]')?.getAttribute("data-pathname"),
    ).toBe("/dashboard/space-one");
  });

  it("moves active option with arrows and Home/End", async () => {
    renderAt("/search");
    await openFromTopbar();
    const input = document.querySelector<HTMLInputElement>("[data-quick-search-input]")!;
    const options = () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].map((el) =>
        el.getAttribute("aria-selected"),
      );

    expect(options()).toEqual(["true", "false"]);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(options()).toEqual(["false", "true"]);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(options()).toEqual(["true", "false"]);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(options()).toEqual(["false", "true"]);
  });

  it("distinguishes same-named session and space with entity icons and clean meta", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        query: "default",
        sessions: [
          {
            id: "default",
            title: "default",
            alias: null,
            state: "general",
            archived: false,
            ownerSpaceId: "space-notes",
            ownerSpaceName: "Notes",
            href: "/default",
            matchReason: "exact-id",
          },
        ],
        spaces: [
          {
            id: "space-default",
            name: "default",
            context: "Top-level workspace context",
            href: "/dashboard/space-default",
            matchReason: "exact-name",
          },
        ],
      }),
    );

    renderAt("/dashboard");
    await openFromTopbar();

    const sessionRow = document.querySelector<HTMLElement>('[data-quick-search-kind="session"]')!;
    const spaceRow = document.querySelector<HTMLElement>('[data-quick-search-kind="space"]')!;
    expect(sessionRow.querySelector('[data-entity-icon="session"]')).toBeTruthy();
    expect(spaceRow.querySelector('[data-entity-icon="space"]')).toBeTruthy();
    expect(sessionRow.textContent).toContain("default · Notes");
    expect(sessionRow.textContent).toContain("ID match");
    expect(spaceRow.textContent).toContain("Top-level workspace context");
    expect(sessionRow.textContent).not.toContain("exact-id");

    const listbox = document.querySelector('[role="listbox"]')!;
    const sessionGroup = listbox.querySelector('[role="group"][aria-labelledby]')!;
    expect(sessionGroup).toBeTruthy();
    expect(sessionGroup.querySelector('[data-quick-search-kind="session"]')).toBeTruthy();
    expect(sessionGroup.contains(sessionRow)).toBe(true);
    const groups = listbox.querySelectorAll('[role="group"]');
    expect(groups).toHaveLength(2);
    expect(groups[0]!.contains(sessionRow)).toBe(true);
    expect(groups[1]!.contains(spaceRow)).toBe(true);
    expect(
      groups[0]!.querySelector("#" + groups[0]!.getAttribute("aria-labelledby"))?.textContent,
    ).toBe("Sessions");
    expect(
      groups[1]!.querySelector("#" + groups[1]!.getAttribute("aria-labelledby"))?.textContent,
    ).toBe("Spaces");
  });

  async function openPaletteWithFakeTimers() {
    const trigger = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Quick search"]',
    )!;
    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });
    return trigger;
  }

  async function typeQuery(value: string) {
    const input = document.querySelector<HTMLInputElement>("[data-quick-search-input]")!;
    await act(async () => {
      // eslint-disable-next-line typescript/unbound-method -- call() rebinds `this` to the input
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      valueSetter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });
  }

  it("shows Search messages action and jumps to /search with q prefilled", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => Response.json(emptyResult("refund timeout")));
    renderAt("/dashboard");
    await openPaletteWithFakeTimers();
    await typeQuery("refund timeout");

    const action = document.querySelector<HTMLButtonElement>(
      '[data-quick-search-action="search-messages"]',
    )!;
    expect(action.textContent).toContain("Search messages for “refund timeout”");
    await act(async () => {
      action.click();
    });
    const probe = container!.querySelector('[data-testid="pathname"]')!;
    expect(probe.getAttribute("data-pathname")).toBe("/search");
    expect(probe.getAttribute("data-search")).toBe("?q=refund+timeout");
  });

  it("shows Import session for unknown ses_ ids and POSTs the sessions import API", async () => {
    vi.useFakeTimers();
    const sessionId = "ses_1dd864100ffes6uqv2NbJatAKt";
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/quick-search")) {
        return Response.json(emptyResult(sessionId));
      }
      if (
        url.includes(`/api/sessions/${encodeURIComponent(sessionId)}/import`) &&
        init?.method === "POST"
      ) {
        return Response.json({ ok: true });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    renderAt("/dashboard");
    await openPaletteWithFakeTimers();
    await typeQuery(sessionId);

    const importAction = document.querySelector<HTMLButtonElement>(
      '[data-quick-search-action="import-session"]',
    )!;
    expect(importAction.textContent).toContain("Import session");
    expect(importAction.textContent).toContain(sessionId);

    await act(async () => {
      importAction.click();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        return (
          String(url).includes(`/api/sessions/${encodeURIComponent(sessionId)}/import`) &&
          (init as RequestInit | undefined)?.method === "POST"
        );
      }),
    ).toBe(true);
    expect(
      container!.querySelector('[data-testid="pathname"]')?.getAttribute("data-pathname"),
    ).toBe(`/ses/${sessionId}`);
  });

  it("prefers local session navigation and hides Import when the id already exists", async () => {
    vi.useFakeTimers();
    const sessionId = "ses_1dd864100ffes6uqv2NbJatAKt";
    fetchMock.mockImplementation(async () =>
      Response.json({
        query: sessionId,
        sessions: [
          {
            id: sessionId,
            title: "Local",
            alias: null,
            state: "general",
            archived: false,
            ownerSpaceId: null,
            ownerSpaceName: null,
            href: `/ses/${sessionId}`,
            matchReason: "exact-id",
          },
        ],
        spaces: [],
      }),
    );

    renderAt("/dashboard");
    await openPaletteWithFakeTimers();
    await typeQuery(sessionId);

    expect(document.querySelector('[data-quick-search-action="import-session"]')).toBeNull();
    expect(document.querySelector('[data-quick-search-kind="session"]')).toBeTruthy();
    expect(document.querySelector('[data-quick-search-action="search-messages"]')).toBeTruthy();
  });

  it("shows Import sessions from folder and navigates to the sessions import route", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => Response.json(emptyResult("/tmp/demo-folder")));
    renderAt("/dashboard");
    await openPaletteWithFakeTimers();
    await typeQuery("/tmp/demo-folder");

    const folderAction = document.querySelector<HTMLButtonElement>(
      '[data-quick-search-action="import-folder"]',
    )!;
    expect(folderAction.textContent).toContain("Import sessions from folder");
    await act(async () => {
      folderAction.click();
    });
    expect(
      container!.querySelector('[data-testid="pathname"]')?.getAttribute("data-pathname"),
    ).toMatch(/^\/sessions\//);
  });
});
