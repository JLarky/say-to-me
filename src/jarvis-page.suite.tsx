/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { JarvisPage } from "./components/page/JarvisPage.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("JarvisPage guidance", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  it("points users to the dashboard Create Jarvis flow instead of a local create form", async () => {
    const originalFetch = globalThis.fetch;
    const originalEventSource = globalThis.EventSource;

    class MockEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      addEventListener() {}
      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/api/sessions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ sessions: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/routines") {
        return Promise.resolve(
          new Response(JSON.stringify({ routines: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    }) as typeof fetch;

    try {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(
          <MemoryRouter initialEntries={["/jarvis"]}>
            <Routes>
              <Route path="/jarvis" element={<JarvisPage />} />
            </Routes>
          </MemoryRouter>,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(container!.textContent).toContain("Go to spaces dashboard");
      expect(container!.querySelector('input[aria-label="New Jarvis session name"]')).toBeNull();
      expect(container!.querySelector('a[href="/dashboard"]')).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.EventSource = originalEventSource;
    }
  });
});
