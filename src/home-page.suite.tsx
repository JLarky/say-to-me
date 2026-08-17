/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionStatusControls } from "./components/SessionStatusControls.tsx";
import { SessionList } from "./components/SessionList.tsx";
import { HomePage } from "./components/page/HomePage.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const noop = () => {};

describe("HomePage", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    localStorage.clear();
    vi.useRealTimers();
    container = undefined;
    root = undefined;
  });

  it("groups pinned and archived sessions", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const stateChanges: string[] = [];

    act(() => {
      root!.render(
        <MemoryRouter>
          <SessionList
            sessions={[
              { id: "ses_037f019d5fdeTOl1pmAqQJO3kq", state: "general", messageCount: 1 },
              { id: "ses_626c9b6a64b3QYHDvshtbYb4Kf", state: "archived", messageCount: 2 },
              { id: "ses_8e21cde18916PZ4GxXHvbaJZfD", state: "important", messageCount: 3 },
            ]}
            onOpen={noop}
            onStateChange={(session, state) => stateChanges.push(`${session.id}:${state}`)}
          />
        </MemoryRouter>,
      );
    });

    const text = container.textContent || "";
    expect(container.textContent).toContain("Important");
    expect(container.textContent).toContain("General");
    expect(container.textContent).toContain("Archived (1)");
    expect(text.indexOf("ses_8e21cde18916PZ4GxXHvbaJZfD")).toBeLessThan(
      text.indexOf("ses_037f019d5fdeTOl1pmAqQJO3kq"),
    );

    act(() => {
      [...container!.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Unpin")!
        .click();
    });
    act(() => {
      [...container!.querySelectorAll<HTMLButtonElement>("button")]
        .filter((button) => button.textContent === "Archive")[1]
        .click();
    });

    expect(stateChanges).toEqual([
      "ses_8e21cde18916PZ4GxXHvbaJZfD:general",
      "ses_037f019d5fdeTOl1pmAqQJO3kq:archived",
    ]);
  });

  it("groups Jarvis-managed sessions above pinned sessions", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const stateChanges: string[] = [];

    act(() => {
      root!.render(
        <MemoryRouter>
          <SessionList
            sessions={[
              { id: "ses_037f019d5fdeTOl1pmAqQJO3kq", state: "general", messageCount: 1 },
              { id: "ses_ecfdb3e7b200m6PPH9VygtWJdl", state: "jarvis", messageCount: 2 },
              { id: "ses_8e21cde18916PZ4GxXHvbaJZfD", state: "important", messageCount: 3 },
            ]}
            onOpen={noop}
            onStateChange={(session, state) => stateChanges.push(`${session.id}:${state}`)}
          />
        </MemoryRouter>,
      );
    });

    const text = container.textContent || "";
    expect(text).toContain("Jarvis");
    expect(text.indexOf("ses_ecfdb3e7b200m6PPH9VygtWJdl")).toBeLessThan(
      text.indexOf("ses_8e21cde18916PZ4GxXHvbaJZfD"),
    );

    act(() => {
      [...container!.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Unmark Jarvis")!
        .click();
    });
    act(() => {
      [...container!.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Mark as Jarvis")!
        .click();
    });

    expect(stateChanges).toEqual([
      "ses_ecfdb3e7b200m6PPH9VygtWJdl:general",
      "ses_8e21cde18916PZ4GxXHvbaJZfD:jarvis",
    ]);
  });

  it("does not render OpenCode model on session rows", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <MemoryRouter>
          <SessionList
            sessions={[
              {
                id: "ses_8abf9673993cRWNohPy1VY4OUK",
                messageCount: 1,
                opencodeAgent: "review",
                opencodeModelProvider: "local",
                opencodeModel: "accurate-model",
              },
            ]}
            onOpen={noop}
          />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("local/accurate-model");
    expect(container.textContent).not.toContain("review /");
    expect(
      container.querySelector('[data-opencode-agent-model="local/accurate-model"]'),
    ).toBeNull();
  });

  it("asks before deleting a session from the homepage", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const originalConfirm = window.confirm;
    const originalEventSource = globalThis.EventSource;
    const deleted: string[] = [];
    const confirmations: string[] = [];

    // Stub EventSource so PageShell's notifications SSE does not throw.
    globalThis.EventSource = class {
      constructor(_url: string) {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
      onmessage = null;
      onerror = null;
      onopen = null;
      readyState = 0;
      url = "";
      withCredentials = false;
      CONNECTING = 0 as const;
      OPEN = 1 as const;
      CLOSED = 2 as const;
      dispatchEvent() {
        return false;
      }
    } as unknown as typeof EventSource;

    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.startsWith("/api/sessions") && !url.includes("/ses_cdca0b2fd4dbxbccXiDaa9dNQe")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessions: [
                { id: "default", messageCount: 0 },
                { id: "ses_cdca0b2fd4dbxbccXiDaa9dNQe", messageCount: 1, opencodeTitle: "scratch" },
              ],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url === "/api/sessions/ses_cdca0b2fd4dbxbccXiDaa9dNQe" && init?.method === "DELETE") {
        deleted.push(url);
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }
      if (url.startsWith("/api/notifications")) {
        return Promise.resolve(
          new Response(JSON.stringify({ notifications: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    };

    try {
      window.confirm = (message?: string) => {
        confirmations.push(message || "");
        return false;
      };
      await act(async () => {
        root!.render(
          <MemoryRouter>
            <HomePage />
          </MemoryRouter>,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const deleteButton = () =>
        [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Delete",
        )!;

      await act(async () => {
        deleteButton().click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(deleted).toEqual([]);
      expect(confirmations[0]).toBe(
        "Delete session scratch? This won't delete OpenCode session, so you can open it later, but all Say to Me messages will be gone.",
      );

      window.confirm = () => true;
      await act(async () => {
        deleteButton().click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(deleted).toEqual(["/api/sessions/ses_cdca0b2fd4dbxbccXiDaa9dNQe"]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.EventSource = originalEventSource;
      window.confirm = originalConfirm;
    }
  });

  it("does not render recent links section when empty", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <MemoryRouter>
          <SessionStatusControls
            session={{
              id: "ses_e946608d8f44iE5XvXLyK7tlO9",
              opencodeStatus: "idle",
              backend: "opencode",
            }}
            sessionId="ses_e946608d8f44iE5XvXLyK7tlO9"
          />
        </MemoryRouter>,
      );
    });
    act(() => {
      container!.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Recent links");
  });
});
