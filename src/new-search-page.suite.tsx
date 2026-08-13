/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Sidebar, Topbar } from "./components/page/NewDashboardChrome.tsx";
import { NewSearchPage } from "./components/page/NewSearchPage.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function LocationProbe({ onPath }: { onPath: (path: string) => void }) {
  const location = useLocation();
  onPath(`${location.pathname}${location.search}`);
  return null;
}

describe("NewSearchPage", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    container = undefined;
    root = undefined;
  });

  function renderAt(entry: string) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const paths: string[] = [];
    act(() => {
      root!.render(
        <MemoryRouter initialEntries={[entry]}>
          <LocationProbe onPath={(path) => paths.push(path)} />
          <Routes>
            <Route path="/search" element={<NewSearchPage />} />
            <Route path="/ses/:sessionId" element={<div>session page</div>} />
            <Route path="/dashboard" element={<div>dashboard page</div>} />
          </Routes>
        </MemoryRouter>,
      );
    });
    return paths;
  }

  function setReactInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function sessionLinkTitle(root: HTMLElement, sessionId: string): string | null {
    return (
      root.querySelector(`[data-search-result="session:${sessionId}"]`)?.querySelector("span")
        ?.textContent ?? null
    );
  }

  function messageLinkTitle(
    root: HTMLElement,
    sessionId: string,
    messageId: number,
  ): string | null {
    return (
      root
        .querySelector(`[data-search-result="message:${sessionId}:${messageId}"]`)
        ?.querySelector("span")?.textContent ?? null
    );
  }

  it("searches via API and opens session results at the returned href", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toContain("/api/search?q=alpha");
      return new Response(
        JSON.stringify({
          query: "alpha",
          sessions: [
            {
              id: "ses_9265d9238061Z2W0cSspYHSYhV",
              alias: "alpha",
              title: "Alpha session",
              state: "general",
              href: "/ses/ses_9265d9238061Z2W0cSspYHSYhV",
            },
          ],
          messages: [
            {
              id: 42,
              sessionId: "ses_99a8e25e3edea1eukCkJpRHRxK",
              text: "alpha message body",
              extraMarkdown: null,
              links: null,
              author: "agent",
              createdAt: "2026-07-17 12:00:00",
              sessionAlias: "beta",
              sessionTitle: "Beta",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/search");

    const input = container!.querySelector<HTMLInputElement>("[data-app-search-input]")!;
    expect(input).toBeTruthy();

    await act(async () => {
      setReactInputValue(input, "alpha");
    });

    await act(async () => {
      container!.querySelector<HTMLFormElement>("form[role='search']")!.requestSubmit();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(sessionLinkTitle(container!, "ses_9265d9238061Z2W0cSspYHSYhV")).toBe("alpha");
    expect(container!.textContent).toContain("ses_9265d9238061Z2W0cSspYHSYhV");
    expect(messageLinkTitle(container!, "ses_99a8e25e3edea1eukCkJpRHRxK", 42)).toBe("beta");
    expect(container!.textContent).toContain("alpha message body");

    const sessionLink = container!.querySelector<HTMLAnchorElement>(
      '[data-search-result="session:ses_9265d9238061Z2W0cSspYHSYhV"]',
    )!;
    const messageLink = container!.querySelector<HTMLAnchorElement>(
      '[data-search-result="message:ses_99a8e25e3edea1eukCkJpRHRxK:42"]',
    )!;
    expect(sessionLink.getAttribute("href")).toBe("/ses/ses_9265d9238061Z2W0cSspYHSYhV");
    expect(messageLink.getAttribute("href")).toBe("/ses/ses_99a8e25e3edea1eukCkJpRHRxK");

    await act(async () => {
      sessionLink.click();
    });
    expect(container!.textContent).toContain("session page");
  });

  it("loads an initial query from the URL", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          query: "from-url",
          sessions: [
            {
              id: "ses_5f02b1f5e95fTbZs6XGJWl10rO",
              alias: null,
              title: null,
              state: "general",
              href: "/ses/ses_5f02b1f5e95fTbZs6XGJWl10rO",
            },
          ],
          messages: [],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/search?q=from-url");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(container!.querySelector<HTMLInputElement>("[data-app-search-input]")!.value).toBe(
      "from-url",
    );
    expect(sessionLinkTitle(container!, "ses_5f02b1f5e95fTbZs6XGJWl10rO")).toBe(
      "ses_5f02b1f5e95fTbZs6XGJWl10rO",
    );
  });

  it("prefers alias, then provider title, then cwd basename for session names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            query: "names",
            sessions: [
              {
                id: "ses_aliasrow",
                alias: "Friendly",
                title: "Provider title",
                cwd: "/tmp/ignored",
                state: "general",
                href: "/ses/ses_aliasrow",
              },
              {
                id: "ses_titlerow",
                alias: null,
                title: "Just the title",
                cwd: "/tmp/cloudfront",
                state: "general",
                href: "/ses/ses_titlerow",
              },
              {
                id: "cur_3b71e41c-f618-44a5-ad03-83f64f3163a5",
                alias: null,
                title: null,
                cwd: "/home/jlarky.guest/work/cloudfront",
                state: "general",
                href: "/ses/cur_3b71e41c-f618-44a5-ad03-83f64f3163a5",
              },
            ],
            messages: [
              {
                id: 7,
                sessionId: "ses_msgtitle",
                text: "hello",
                extraMarkdown: null,
                links: null,
                author: "agent",
                createdAt: "2026-07-17 12:00:00",
                sessionAlias: null,
                sessionTitle: null,
                sessionCwd: "/home/jlarky.guest/work/cloudfront",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    renderAt("/search");
    const input = container!.querySelector<HTMLInputElement>("[data-app-search-input]")!;

    await act(async () => {
      setReactInputValue(input, "names");
      container!.querySelector<HTMLFormElement>("form[role='search']")!.requestSubmit();
      await Promise.resolve();
    });

    expect(sessionLinkTitle(container!, "ses_aliasrow")).toBe("Friendly");
    expect(sessionLinkTitle(container!, "ses_titlerow")).toBe("Just the title");
    expect(sessionLinkTitle(container!, "cur_3b71e41c-f618-44a5-ad03-83f64f3163a5")).toBe(
      "cloudfront",
    );
    expect(messageLinkTitle(container!, "ses_msgtitle", 7)).toBe("cloudfront");
    expect(
      container!.querySelector('[data-search-result="session:ses_aliasrow"]')!.textContent,
    ).toContain("Provider title");
  });

  it("moves highlight with arrow keys and opens the active result on Enter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            query: "nav",
            sessions: [
              {
                id: "ses_76bfea77b8cbcufGfp4TY9VhlC",
                alias: null,
                title: "One",
                state: "general",
                href: "/ses/ses_76bfea77b8cbcufGfp4TY9VhlC",
              },
              {
                id: "ses_6524510e70b81o6HUdrM4nfFGa",
                alias: null,
                title: "Two",
                state: "general",
                href: "/ses/ses_6524510e70b81o6HUdrM4nfFGa",
              },
            ],
            messages: [],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    renderAt("/search");
    const input = container!.querySelector<HTMLInputElement>("[data-app-search-input]")!;

    await act(async () => {
      setReactInputValue(input, "nav");
      container!.querySelector<HTMLFormElement>("form[role='search']")!.requestSubmit();
      await Promise.resolve();
    });

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(
      container!
        .querySelector('[data-search-result="session:ses_76bfea77b8cbcufGfp4TY9VhlC"]')!
        .getAttribute("aria-current"),
    ).toBe("true");

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(
      container!
        .querySelector('[data-search-result="session:ses_6524510e70b81o6HUdrM4nfFGa"]')!
        .getAttribute("aria-current"),
    ).toBe("true");

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(container!.textContent).toContain("session page");
  });
});

describe("New dashboard Search chrome", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  it("wires sidebar and topbar Search controls to /search", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const paths: string[] = [];

    act(() => {
      root!.render(
        <MemoryRouter initialEntries={["/dashboard"]}>
          <LocationProbe onPath={(path) => paths.push(path)} />
          <Routes>
            <Route
              path="/dashboard"
              element={
                <>
                  <Sidebar active="spaces" />
                  <Topbar title="Spaces" />
                </>
              }
            />
            <Route path="/search" element={<div>search page</div>} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const sidebarSearch = container.querySelector<HTMLAnchorElement>('a[aria-label="Search"]')!;
    const topbarSearch = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Quick search"]',
    )!;
    expect(sidebarSearch.getAttribute("href")).toBe("/search");
    expect(topbarSearch).toBeTruthy();
    expect(topbarSearch.getAttribute("href")).toBeNull();

    await act(async () => {
      sidebarSearch.click();
    });
    expect(container.textContent).toContain("search page");
  });
});
