/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { OpenCodeActivityPreview } from "./components/OpenCodeActivityPreview.tsx";
import { renderExtraMarkdownHtml } from "../server/markdown/extra-markdown-html.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("OpenCodeActivityPreview", () => {
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

  it("refreshes OpenCode activity when the stream errors", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const originalEventSource = globalThis.EventSource;
    let latestOnError: (() => void) | null = null;
    let fetchCount = 0;
    class MockEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
      set onerror(handler: (() => void) | null) {
        latestOnError = handler;
      }
      get onerror() {
        return latestOnError;
      }
      addEventListener() {}
      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/debug/opencode-activity/ses_af261eb974e5Tz4bVO2cbTzOz1?limit=8") {
        fetchCount += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "idle",
              latestOutputSnippet: fetchCount === 1 ? "first preview" : "refreshed preview",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    };

    try {
      await act(async () => {
        root!.render(<OpenCodeActivityPreview sessionId="ses_af261eb974e5Tz4bVO2cbTzOz1" />);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        container!.querySelector("button")!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.textContent).toContain("first preview");

      await act(async () => {
        latestOnError?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(fetchCount).toBe(2);
      expect(container.textContent).toContain("refreshed preview");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.EventSource = originalEventSource;
    }
  });

  it("reports activity stream status changes to the session header", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalEventSource = globalThis.EventSource;
    const statuses: string[] = [];
    let snapshotHandler: ((event: MessageEvent) => void) | null = null;
    class MockEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        if (type === "snapshot") snapshotHandler = handler;
      }
      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    try {
      await act(async () => {
        root!.render(
          <OpenCodeActivityPreview
            onActivityStatusChange={(status) => statuses.push(status)}
            sessionId="ses_af261eb974e5Tz4bVO2cbTzOz1"
          />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        snapshotHandler?.(
          new MessageEvent("snapshot", { data: JSON.stringify({ status: "busy" }) }),
        );
        snapshotHandler?.(
          new MessageEvent("snapshot", { data: JSON.stringify({ status: "idle" }) }),
        );
      });

      expect(statuses).toEqual(["pending", "idle"]);
    } finally {
      globalThis.EventSource = originalEventSource;
    }
  });

  it("lets the activity Refresh button refresh the full session page when provided", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalEventSource = globalThis.EventSource;
    let refreshCount = 0;
    class MockEventSource {
      onerror: (() => void) | null = null;
      addEventListener() {}
      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    try {
      await act(async () => {
        root!.render(
          <OpenCodeActivityPreview
            onRefreshSessionPage={async () => {
              refreshCount += 1;
              return { status: "idle", latestOutputSnippet: "full page refreshed" };
            }}
            sessionId="ses_af261eb974e5Tz4bVO2cbTzOz1"
          />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        container!.querySelector("button")!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(refreshCount).toBe(1);
      expect(container.textContent).toContain("full page refreshed");
    } finally {
      globalThis.EventSource = originalEventSource;
    }
  });

  it("confirms before requesting OpenCode compaction from the token pill", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const originalConfirm = globalThis.confirm;
    const originalEventSource = globalThis.EventSource;
    const onRequestCompact = vi.fn();
    class MockEventSource {
      onerror: (() => void) | null = null;
      addEventListener() {}
      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/debug/opencode-activity/ses_9dd0e37709acUEbZH4UglxV3ko?limit=8") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "idle",
              latestOutputSnippet: "preview with latest message tokens",
              contextUsage: {
                usedTokens: 119_119,
                limitTokens: 1_050_000,
                percent: 11.3,
                source: "latestMessageTokens",
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    };

    try {
      await act(async () => {
        root!.render(
          <OpenCodeActivityPreview
            onRequestCompact={onRequestCompact}
            sessionId="ses_9dd0e37709acUEbZH4UglxV3ko"
          />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        container!.querySelector("button")!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const compactButton = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("119.1K / 1.1M"),
      )!;

      globalThis.confirm = vi.fn(() => false) as typeof confirm;
      compactButton.click();
      expect(globalThis.confirm).toHaveBeenCalledWith("Compact this OpenCode session?");
      expect(onRequestCompact).not.toHaveBeenCalled();

      globalThis.confirm = vi.fn(() => true) as typeof confirm;
      compactButton.click();
      expect(onRequestCompact).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.confirm = originalConfirm;
      globalThis.EventSource = originalEventSource;
    }
  });

  it("renders OpenCode activity snippets as sanitized markdown", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const originalEventSource = globalThis.EventSource;
    class MockEventSource {
      onerror: (() => void) | null = null;
      addEventListener() {}
      close() {}
    }

    const snippet =
      "**done**\n\n- item\n\n| Library | Role |\n|---|---|\n| marked | parser |\n\n<shell_metadata>User aborted the command</shell_metadata>\n\n<script>alert('xss')</script>\n\n[docs](https://example.com)\n\n[bad](javascript:alert('xss'))\n\n![image](https://example.com/image.png)";

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/debug/opencode-activity/ses_af261eb974e5Tz4bVO2cbTzOz1?limit=8") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "idle",
              latestOutputSnippet: snippet,
              recentItems: [
                {
                  kind: "message",
                  snippet,
                  snippetHtml: renderExtraMarkdownHtml(snippet),
                  source: "legacy",
                },
              ],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    };

    try {
      await act(async () => {
        root!.render(<OpenCodeActivityPreview sessionId="ses_af261eb974e5Tz4bVO2cbTzOz1" />);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        container!.querySelector("button")!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(container.querySelector("strong")?.textContent).toBe("done");
      expect(container.querySelector("li")?.textContent).toBe("item");
      expect(container.querySelector("table")).not.toBeNull();
      expect(container.querySelector("th")?.textContent).toBe("Library");
      expect(container.querySelector("td")?.textContent).toBe("marked");
      expect(container.textContent).toContain("User aborted the command");
      expect(container.textContent).not.toContain("shell_metadata");
      const link = container.querySelector<HTMLAnchorElement>("a")!;
      expect(link.href).toBe("https://example.com/");
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
      expect(container.querySelectorAll("a[href]")).toHaveLength(1);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("script")).toBeNull();
      expect(container.textContent).not.toContain("alert");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.EventSource = originalEventSource;
    }
  });

  it("renders recent OpenCode activity as a horizontal card list", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const originalEventSource = globalThis.EventSource;
    class MockEventSource {
      onerror: (() => void) | null = null;
      addEventListener() {}
      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/debug/opencode-activity/ses_af261eb974e5Tz4bVO2cbTzOz1?limit=8") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "idle",
              latestOutputSnippet: "latest preview",
              recentItems: [
                { kind: "message", snippet: "Newest answer", timestamp: 1000, source: "legacy" },
                { kind: "tool", snippet: "Tests passed", timestamp: 900, source: "legacy" },
                {
                  kind: "tool",
                  snippet:
                    "(no output)\n\n<shell_metadata>User aborted the command</shell_metadata>",
                  source: "legacy",
                },
                { kind: "thinking", snippet: "Thinking: checking logs", source: "sse" },
              ],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    };

    try {
      await act(async () => {
        root!.render(<OpenCodeActivityPreview sessionId="ses_af261eb974e5Tz4bVO2cbTzOz1" />);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        container!.querySelector("button")!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(container.querySelector('[aria-label="Recent OpenCode activity"]')).not.toBeNull();
      expect(container.querySelectorAll("article")).toHaveLength(4);
      expect(container.textContent).toContain("Newest answer");
      expect(container.textContent).toContain("User aborted the command");
      expect(container.textContent).toContain("Thinking: checking logs");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.EventSource = originalEventSource;
    }
  });

  it("keeps local recent activity cards while the carousel is scrolled away", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalEventSource = globalThis.EventSource;
    let snapshotHandler: ((event: MessageEvent) => void) | undefined;
    class MockEventSource {
      onerror: (() => void) | null = null;
      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        if (type === "snapshot") snapshotHandler = handler;
      }
      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    try {
      await act(async () => {
        root!.render(<OpenCodeActivityPreview sessionId="ses_af261eb974e5Tz4bVO2cbTzOz1" />);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        snapshotHandler?.(
          new MessageEvent("snapshot", {
            data: JSON.stringify({
              status: "busy",
              latestOutputSnippet: "**first** preview",
              recentItems: [
                {
                  kind: "message",
                  snippet: "**First** card",
                  snippetHtml: renderExtraMarkdownHtml("**First** card"),
                  timestamp: 1000,
                },
              ],
            }),
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const carousel = container.querySelector<HTMLDivElement>(
        '[aria-label="Recent OpenCode activity"]',
      )!;
      expect(container.querySelector("strong")?.textContent).toBe("First");
      expect(container.textContent).toContain("First card");
      const firstArticleClassName = carousel.querySelector("article")?.className;
      const firstCarouselClassName = carousel.className;

      Object.defineProperty(carousel, "scrollLeft", { configurable: true, value: 48 });
      await act(async () => {
        carousel.dispatchEvent(new Event("scroll", { bubbles: true }));
        snapshotHandler?.(
          new MessageEvent("snapshot", {
            data: JSON.stringify({
              status: "busy",
              latestOutputSnippet: "**second** preview",
              recentItems: [
                {
                  kind: "thinking",
                  partial: true,
                  snippet: "**Second** card",
                  snippetHtml: renderExtraMarkdownHtml("**Second** card"),
                  timestamp: 2000,
                },
              ],
            }),
          }),
        );
      });

      expect(container.textContent).toContain("First card");
      expect(container.textContent).not.toContain("Second card");
      expect(carousel.className).not.toBe(firstCarouselClassName);

      Object.defineProperty(carousel, "scrollLeft", { configurable: true, value: 0 });
      await act(async () => {
        carousel.dispatchEvent(new Event("scroll", { bubbles: true }));
      });

      expect(container.textContent).toContain("Second card");
      expect(container.textContent).not.toContain("First card");
      expect(carousel.querySelector("article")?.className).not.toBe(firstArticleClassName);
    } finally {
      globalThis.EventSource = originalEventSource;
    }
  });
});
