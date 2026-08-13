/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { SessionsPage } from "./components/page/SessionsPage.tsx";
import { importSessionsHref } from "./utils.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("SessionsPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  function mockFetch(context: {
    resolvedPath: string;
    opencodeProject?: { id: string; sessionCount: number } | null;
    sessionsHere?: { id: string; provider: string; title: string | null }[];
  }) {
    return ((input: RequestInfo | URL) => {
      const raw = input instanceof Request ? input.url : input.toString();
      const url = raw.includes("://") ? new URL(raw).pathname + new URL(raw).search : raw;
      if (url.startsWith("/api/workspace-path")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              path: context.resolvedPath,
              exists: true,
              isDirectory: true,
              writable: true,
              creatable: false,
              parentPath: null,
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.startsWith("/api/sessions/context")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              path: context.resolvedPath,
              pathStatus: {
                exists: true,
                isDirectory: true,
                writable: true,
                creatable: false,
                parentPath: null,
              },
              providers: {
                claude: { importableCount: 0, inAppCount: 0 },
                codex: { importableCount: 0, inAppCount: 0 },
                cursor: { importableCount: 0, inAppCount: 0 },
                grok: { importableCount: 0, inAppCount: 0 },
              },
              sessionsHere: context.sessionsHere ?? [],
              opencodeProject: context.opencodeProject ?? null,
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.startsWith("/api/providers/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ models: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.startsWith("/api/notifications")) {
        return Promise.resolve(
          new Response(JSON.stringify({ notifications: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    }) as typeof fetch;
  }

  function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location">{location.pathname}</div>;
  }

  async function renderSessionsAt(entry: string) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/:pathKey" element={<SessionsPage />} />
            <Route path="/project/:projectId" element={<LocationProbe />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const started = Date.now();
    while (Date.now() - started < 2000) {
      if (container.textContent?.includes("Resolves to:")) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  }

  async function waitForButton(label: string, timeoutMs = 2000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const match = button(label);
      if (match) return match;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    return undefined;
  }

  const button = (label: string) =>
    [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (el) => el.textContent === label,
    );

  it("shows the resolved path and an OpenCode project link when context matches", async () => {
    const originalFetch = globalThis.fetch;
    const resolvedPath = "/home/dev/Downloads/project1";
    globalThis.fetch = mockFetch({
      resolvedPath,
      opencodeProject: { id: "prj_demo", sessionCount: 2 },
    });
    try {
      await renderSessionsAt(importSessionsHref(resolvedPath));

      expect(container!.textContent).toContain(`Resolves to: ${resolvedPath}`);
      expect(await waitForButton("Open project")).toBeDefined();

      await act(async () => {
        button("Open project")!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container!.querySelector('[data-testid="location"]')?.textContent).toBe(
        "/project/prj_demo",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("shows create session when no project matches the resolved path", async () => {
    const originalFetch = globalThis.fetch;
    const resolvedPath = "/home/dev/work/brand-new";
    globalThis.fetch = mockFetch({
      resolvedPath,
      opencodeProject: null,
    });
    try {
      await renderSessionsAt(importSessionsHref(resolvedPath));

      expect(container!.textContent).toContain(`Resolves to: ${resolvedPath}`);
      expect(button("Open project")).toBeUndefined();
      expect(button("Create session")).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
