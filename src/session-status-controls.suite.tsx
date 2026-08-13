/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionStatusControls } from "./components/SessionStatusControls.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("SessionStatusControls", () => {
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

  it("does not render OpenCode model in session status controls", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <MemoryRouter>
          <SessionStatusControls
            session={{
              id: "ses_e946608d8f44iE5XvXLyK7tlO9",
              backend: "opencode",
              opencodeStatus: "idle",
              opencodeAgent: "build",
              opencodeModelProvider: "github-copilot",
              opencodeModel: "fast-model",
            }}
            sessionId="ses_e946608d8f44iE5XvXLyK7tlO9"
          />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("copilot/fast-model");
    expect(container.textContent).not.toContain("build /");
    expect(container.querySelector('[data-opencode-agent-model="copilot/fast-model"]')).toBeNull();
  });

  it("reserves OpenCode status space for ses sessions before status loads", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <MemoryRouter>
          <SessionStatusControls
            session={{ id: "ses_1dd864100ffes6uqv2NbJatAKt", backend: "opencode" }}
            sessionId="ses_1dd864100ffes6uqv2NbJatAKt"
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("[data-session-status-controls][data-reserved]")).not.toBeNull();
  });

  it("renders recent links after quick messages", () => {
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
            recentLinks={["https://github.com/JLarky/say-to-me/pull/61"]}
          />
        </MemoryRouter>,
      );
    });
    act(() => {
      container!.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Quick messages");
    expect(container.textContent).toContain("Recent links");
    expect(container.textContent).toContain("github.com/JLarky/say-to-me/pull/61");
    expect(
      container.querySelector('a[href="https://github.com/JLarky/say-to-me/pull/61"]'),
    ).not.toBeNull();
    expect(container.textContent!.indexOf("Quick messages")).toBeLessThan(
      container.textContent!.indexOf("Recent links"),
    );
  });

  it("renders Dashboard immediately above Organize in the Links dropdown", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <MemoryRouter initialEntries={["/ses/ses_e946608d8f44iE5XvXLyK7tlO9"]}>
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

    const text = container.textContent ?? "";
    expect(text).toContain("Dashboard");
    expect(text).toContain("Organize");
    expect(text.indexOf("Dashboard")).toBeLessThan(text.indexOf("Organize"));
  });

  it("renders recently mentioned sessions in the Links dropdown", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function LocationProbe() {
      return <span data-location={useLocation().pathname} />;
    }

    act(() => {
      root!.render(
        <MemoryRouter initialEntries={["/ses/ses_e946608d8f44iE5XvXLyK7tlO9"]}>
          <SessionStatusControls
            session={{
              id: "ses_e946608d8f44iE5XvXLyK7tlO9",
              opencodeStatus: "idle",
              backend: "opencode",
            }}
            sessionId="ses_e946608d8f44iE5XvXLyK7tlO9"
            recentSessions={[
              { id: "ses_9288ef8f414d5pZKr5IUvABEJy", alias: "Morgan" },
              { id: "ses_5dfdabafcb34FqPXa7AGCdYtjJ", title: "Checkout fix" },
              { id: "ses_17b0b19b07d3EN2qvizW22sFTH" },
            ]}
          />
          <LocationProbe />
        </MemoryRouter>,
      );
    });
    act(() => {
      container!.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Quick messages");
    expect(container.textContent).toContain("Sessions");
    expect(container.textContent).toContain("Morgan");
    expect(container.textContent).toContain("Checkout fix");
    expect(container.textContent).toContain("ses_17b0b19b07d3EN2qvizW22sFTH");
    const aliasLink = container.querySelector('a[href="/ses/ses_9288ef8f414d5pZKr5IUvABEJy"]');
    expect(aliasLink?.getAttribute("title")).toBe("ses_9288ef8f414d5pZKr5IUvABEJy");
    expect(
      container
        .querySelector('a[href="/ses/ses_5dfdabafcb34FqPXa7AGCdYtjJ"]')
        ?.getAttribute("title"),
    ).toBe("ses_5dfdabafcb34FqPXa7AGCdYtjJ");
    expect(container.textContent!.indexOf("Quick messages")).toBeLessThan(
      container.textContent!.indexOf("Sessions"),
    );
    act(() => {
      aliasLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector("[data-location]")?.getAttribute("data-location")).toBe(
      "/ses/ses_9288ef8f414d5pZKr5IUvABEJy",
    );
  });

  it("persists and marks the last-clicked OpenCode link", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalOpen = window.open;
    window.open = (() => null) as typeof window.open;

    try {
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
              capabilities={{
                opencodeLocalBase: "http://localhost:4096",
                opencodeTailscaleBase: "https://example.ts.net",
                opencodeDirB64: "ZGly",
              }}
            />
          </MemoryRouter>,
        );
      });
      act(() => {
        container!
          .querySelector("button")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const tailscaleLink = container.querySelector<HTMLAnchorElement>(
        '[data-opencode-link="tailscale"]',
      )!;
      act(() => {
        tailscaleLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(localStorage.getItem("say-to-me-last-opencode-link")).toBe("tailscale");

      act(() => {
        container!
          .querySelector("button")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const reopenedTailscale = container.querySelector<HTMLAnchorElement>(
        '[data-opencode-link="tailscale"]',
      )!;
      expect(reopenedTailscale.dataset.lastUsed).toBe("true");
      expect(reopenedTailscale.textContent).toContain("(last used)");
      const reopenedLocal = container.querySelector<HTMLAnchorElement>(
        '[data-opencode-link="local"]',
      )!;
      expect(reopenedLocal.dataset.lastUsed).toBeUndefined();
    } finally {
      window.open = originalOpen;
    }
  });

  it("shares the last-used OpenCode link preference across sessions", () => {
    localStorage.setItem("say-to-me-last-opencode-link", "local");

    const capabilities = {
      opencodeLocalBase: "http://localhost:4096",
      opencodeTailscaleBase: "https://example.ts.net",
      opencodeDirB64: "ZGly",
    };

    function renderAndOpen(sessionId: string): HTMLAnchorElement {
      const localContainer = document.createElement("div");
      document.body.append(localContainer);
      const localRoot = createRoot(localContainer);
      act(() => {
        localRoot.render(
          <MemoryRouter>
            <SessionStatusControls
              session={{ id: sessionId, opencodeStatus: "idle", backend: "opencode" }}
              sessionId={sessionId}
              capabilities={capabilities}
            />
          </MemoryRouter>,
        );
      });
      act(() => {
        localContainer
          .querySelector("button")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const anchor = localContainer.querySelector<HTMLAnchorElement>(
        '[data-opencode-link="local"]',
      )!;
      act(() => localRoot.unmount());
      localContainer.remove();
      return anchor;
    }

    expect(renderAndOpen("ses_76bfea77b8cbcufGfp4TY9VhlC").dataset.lastUsed).toBe("true");
    expect(renderAndOpen("ses_6524510e70b81o6HUdrM4nfFGa").dataset.lastUsed).toBe("true");
  });
});
