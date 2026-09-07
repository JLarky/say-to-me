/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { browserPlaybackStore } from "./browser-playback-store.ts";
import { SafeHtml } from "./components/SafeHtml.tsx";
import { MessageList } from "./components/MessageList.tsx";
import { createPendingMessage } from "./utils.ts";
import type { Message } from "./types.ts";
import { renderExtraMarkdownHtml } from "../server/markdown/extra-markdown-html.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const noop = () => {};

function message(overrides: Partial<Message>): Message {
  const extraMarkdown = overrides.extraMarkdown ?? null;
  const base: Message = {
    id: 1,
    text: "Long agent message",
    status: "speaking",
    author: "agent",
    sessionId: "default",
    ...overrides,
  };
  const shouldRenderHtml =
    typeof extraMarkdown === "string" &&
    extraMarkdown.trim() &&
    overrides.extraMarkdownHtml == null;
  return shouldRenderHtml
    ? { ...base, extraMarkdownHtml: renderExtraMarkdownHtml(extraMarkdown) }
    : base;
}

function renderMessages(
  root: Root,
  messages: Message[],
  options: { onInsertSessionMention?: (token: string) => void } = {},
) {
  act(() => {
    root!.render(
      <MemoryRouter>
        <MessageList
          messages={messages}
          onDelete={noop}
          onInsertSessionMention={options.onInsertSessionMention}
          onPlay={noop}
          onRetryDelivery={noop}
          onStop={noop}
          speakingId={null}
        />
      </MemoryRouter>,
    );
  });
}

describe("MessageList", () => {
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

  it("keeps newest messages first across status updates", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [message({ id: 3, text: "new" }), message({ id: 2 }), message({ id: 1 })]);
    renderMessages(root, [
      message({ id: 3, text: "new", status: "played" }),
      message({ id: 2, status: "played" }),
      message({ id: 1, status: "queued" }),
    ]);

    expect(
      [...container.querySelectorAll("[data-thread-id]")].map(
        (node) => (node as HTMLElement).dataset.threadId,
      ),
    ).toEqual(["3", "2", "1"]);
  });

  it("fades merged messages and leaves the delivered message normal", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({ id: 9, author: "user", status: "received", text: "one\n\ntwo" }),
      message({ id: 1, author: "user", status: "received", mergedIntoMessageId: 9 }),
      message({ id: 2, author: "user", status: "received", mergedIntoMessageId: 9 }),
    ]);

    const merged = (id: number) =>
      container!.querySelector(`[data-thread-id="${id}"]`)?.getAttribute("data-merged");
    expect(merged(1)).toBe("true");
    expect(merged(2)).toBe("true");
    expect(merged(9)).toBeNull();
  });

  it("renders flat agent and user messages with distinct labels", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({ id: 2, author: "user", status: "received", text: "reply history" }),
      message({ id: 1, author: "agent", status: "played", text: "agent history" }),
    ]);

    expect(container.textContent).toContain("user");
    expect(container.textContent).toContain("reply history");
    expect(container.textContent).toContain("agent");
    expect(container.textContent).toContain("agent history");
  });

  it("renders Say To Me system messages compactly", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 10,
        author: "user",
        forwardRole: "source",
        forwardTargetSessionId: "ses_6cd0c26c5a6ffCEvwKoLI2Z5kM",
        forwardStatus: "completed",
        opencodeDeliveryStatus: "failed",
        opencodeDeliveryError: "temporary failure",
        status: "received",
        text: "<say-to-me-system>ses_6cd0c26c5a6ffCEvwKoLI2Z5kM is idle now</say-to-me-system>",
      }),
    ]);

    expect(container.textContent).toContain("ses_6cd0c26c5a6ffCEvwKoLI2Z5kM is now idle");
    expect(container.textContent).toContain("OpenCode failed");
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("say-to-me-system");
  });

  it("renders session reference cards and inserts stable mentions", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const inserted: string[] = [];

    renderMessages(
      root,
      [
        message({
          text: "Use this session",
          sessions: [
            {
              id: "ses_0c86bae7a382nqSq8a8aiVoQcZ",
              alias: "Morgan",
              title: "Checkout fix",
              summary: "Needs you: Pick a direction?",
              summaryUpdatedAt: "2026-06-14T12:00:00Z",
              waitingState: "needs_answer",
              latestMessageAuthor: "agent",
              latestMessageText: "Pick a direction?",
              state: "general",
              projectName: "demo-project",
              workspaceId: null,
              latestActivity: "2026-06-14T12:00:00Z",
              messageCount: 4,
            },
          ],
        }),
      ],
      { onInsertSessionMention: (token) => inserted.push(token) },
    );

    expect(container.textContent).toContain("Morgan");
    expect(container.textContent).not.toContain("Checkout fix");
    expect(container.textContent).toContain("Needs you");
    expect(container.textContent).toContain("Needs you: Pick a direction?");
    expect(container.textContent).toContain("Last agent: Pick a direction?");
    expect(container.textContent).toContain("ses_0c86bae7a382nqSq8a8aiVoQcZ");
    expect(
      container.querySelector('a[href="/ses/ses_0c86bae7a382nqSq8a8aiVoQcZ"]')?.textContent,
    ).toBe("Open");

    const insertButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Insert mention",
    ) as HTMLButtonElement;
    act(() => {
      insertButton.click();
    });

    expect(inserted).toEqual(["say-to-me(ses_0c86bae7a382nqSq8a8aiVoQcZ, Morgan)"]);
  });

  it("hides the open action when a card references the current session", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        sessionId: "ses_3da7ff80a20aG6fc19jxelYDKq",
        text: "This session",
        sessions: [
          {
            id: "ses_3da7ff80a20aG6fc19jxelYDKq",
            alias: "Morgan",
            title: "JLarky say to me",
            summary: "Last update: Done.",
            summaryUpdatedAt: null,
            waitingState: "can_continue",
            latestMessageAuthor: "agent",
            latestMessageText: "Done.",
            state: "general",
            projectName: null,
            workspaceId: null,
            latestActivity: null,
            messageCount: 4,
          },
        ],
      }),
    ]);

    expect(container.textContent).toContain("Morgan");
    expect(container.textContent).not.toContain("JLarky say to me");
    expect(container.querySelector('a[href="/ses/ses_3da7ff80a20aG6fc19jxelYDKq"]')).toBeNull();
    expect(container.textContent).toContain("Insert mention");
  });

  it("renders forwarding provenance", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        text: "please check this",
        forwardRole: "source",
        forwardTargetSessionId: "ses_76df45e4b138exNzpW0u2nXj8h",
        forwardStatus: "watching",
      }),
    ]);

    expect(container.textContent).toContain("Forwarded out");
    expect(container.textContent).toContain(
      "Waiting for ses_76df45e4b138exNzpW0u2nXj8h to finish since",
    );
  });

  it("renders completed forward notifications with the source notification id", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 30,
        text: "please check this",
        forwardRole: "source",
        forwardTargetMessageId: 31,
        forwardTargetSessionId: "ses_76df45e4b138exNzpW0u2nXj8h",
        forwardStatus: "notified",
        createdAt: "2026-06-16 04:00:00",
      }),
      message({
        id: 31,
        text: "<say-to-me-system>ses_76df45e4b138exNzpW0u2nXj8h is idle now</say-to-me-system>",
        createdAt: "2026-06-16 04:05:00",
      }),
    ]);

    expect(container.textContent).toContain("Marked as idle in #31 after 5m");
    expect(container.querySelector('a[href="#message-31"]')).not.toBeNull();
  });

  it("renders completed forwarded notifications with local and source ids", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 30,
        text: "please check this",
        forwardRole: "source",
        forwardTargetMessageId: 33,
        forwardTargetSessionId: "ses_76df45e4b138exNzpW0u2nXj8h",
        forwardStatus: "notified",
        createdAt: "2026-06-16 04:00:00",
      }),
      message({
        id: 33,
        text: "<say-to-me-system>ses_76df45e4b138exNzpW0u2nXj8h is idle now</say-to-me-system>",
        forwardRole: "target",
        forwardSourceMessageId: 32,
        createdAt: "2026-06-16 04:05:00",
      }),
    ]);

    expect(container.textContent).toContain("Marked as idle in #33, forwarded from #32 after 5m");
    expect(container.querySelector('a[href="#message-33"]')).not.toBeNull();
  });

  it("renders idle notification messages as compact cards", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 31,
        author: "user",
        sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
        status: "received",
        text: "<say-to-me-system>ses_76df45e4b138exNzpW0u2nXj8h is idle now</say-to-me-system>",
        opencodeDeliveryStatus: "queued",
        forwardRole: "target",
        forwardSourceSessionId: "ses_76df45e4b138exNzpW0u2nXj8h",
        forwardSourceMessageId: 30,
        forwardStatus: "notified",
        sessions: [
          {
            id: "ses_76df45e4b138exNzpW0u2nXj8h",
            alias: "Morgan",
            title: "JLarky say to me",
            summary:
              "User asked: <say-to-me-system>ses_76df45e4b138exNzpW0u2nXj8h is idle now</say-to-me-system>",
            summaryUpdatedAt: "2026-06-16 04:05:00",
            waitingState: "can_continue",
            latestMessageAuthor: "user",
            latestMessageText:
              "<say-to-me-system>ses_76df45e4b138exNzpW0u2nXj8h is idle now</say-to-me-system>",
            state: "general",
            projectName: null,
            workspaceId: null,
            latestActivity: "2026-06-16 04:05:00",
            messageCount: 4,
          },
        ],
      }),
    ]);

    expect(container.textContent).toContain("Morgan is now idle");
    expect(container.textContent).toContain("Forwarded from #30");
    expect(container.textContent).not.toContain("<say-to-me-system>");
    expect(container.textContent).not.toContain("Forwarded in");
    expect(container.textContent).toContain("Waiting for OpenCode to be idle");
    expect(container.textContent).toContain("Force send");
    expect(container.textContent).not.toContain("Insert mention");
    expect(container.textContent).not.toContain("Latest:");
    expect(container.textContent).toContain("Play");
  });

  it("renders retry controls for failed compact idle notifications", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 31,
        author: "user",
        sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
        status: "received",
        text: "<say-to-me-system>ses_76df45e4b138exNzpW0u2nXj8h is idle now</say-to-me-system>",
        opencodeDeliveryStatus: "failed",
        forwardRole: "target",
        forwardSourceSessionId: "ses_76df45e4b138exNzpW0u2nXj8h",
        forwardSourceMessageId: 30,
        forwardStatus: "notified",
      }),
    ]);

    expect(container.textContent).toContain("ses_76df45e4b138exNzpW0u2nXj8h is now idle");
    expect(container.textContent).toContain("OpenCode failed");
    expect(container.textContent).toContain("Retry");
  });

  it("renders coalesced idle notifications with all source message ids", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 30,
        text: "first watched task",
        forwardRole: "source",
        forwardTargetMessageId: 33,
        forwardTargetSessionId: "ses_76df45e4b138exNzpW0u2nXj8h",
        forwardStatus: "notified",
      }),
      message({
        id: 31,
        text: "second watched task",
        forwardRole: "source",
        forwardTargetMessageId: 33,
        forwardTargetSessionId: "ses_76df45e4b138exNzpW0u2nXj8h",
        forwardStatus: "notified",
      }),
      message({
        id: 33,
        author: "user",
        sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
        status: "received",
        text: "<say-to-me-system>ses_76df45e4b138exNzpW0u2nXj8h is idle now</say-to-me-system>",
        opencodeDeliveryStatus: "queued",
        forwardRole: "target",
        forwardSourceSessionId: "ses_76df45e4b138exNzpW0u2nXj8h",
        forwardSourceMessageId: 32,
        forwardStatus: "notified",
      }),
    ]);

    expect(container.textContent).toContain("ses_76df45e4b138exNzpW0u2nXj8h is now idle");
    expect(container.textContent).toContain("Forwarded from #30, #31");
    expect(container.textContent).toContain("Waiting for OpenCode to be idle");
  });

  it("preserves line breaks when rendering message text", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [message({ text: "line 1\nline 2\nline 3" })]);

    expect(container.querySelector("p")?.textContent).toBe("line 1\nline 2\nline 3");
  });

  it("renders spoken text and optional message markdown", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        text: "Voice note markdown fallback.",
        extraMarkdown:
          "**voice note**\n\n| A | B |\n|---|---|\n| true | false |\n\n[docs](https://example.com)\n\n<script>alert('xss')</script>[bad](javascript:alert('xss'))",
      }),
    ]);

    expect(container.querySelector("p")?.textContent).toBe("Voice note markdown fallback.");
    expect(container.querySelector("strong")?.textContent).toBe("voice note");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("th")?.textContent).toBe("A");
    expect(container.querySelector("td")?.textContent).toBe("true");
    expect(container.querySelector("script")).toBeNull();
    const link = container.querySelector<HTMLAnchorElement>("a[href]")!;
    expect(link.href).toBe("https://example.com/");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(container.querySelectorAll("a[href]")).toHaveLength(1);
  });

  it("keeps safe HTML DOM stable across equivalent style prop updates", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    const html = renderExtraMarkdownHtml(
      "**voice note**\n\n| A | B |\n|---|---|\n| true | false |",
    );
    const renderHtml = () => {
      act(() => {
        root!.render(
          <SafeHtml
            className="voice-note-markdown"
            html={html}
            styleProps={{ className: "stable", style: { color: "red" } }}
          />,
        );
      });
    };

    renderHtml();
    const table = container.querySelector("table");
    renderHtml();

    expect(container.querySelector("table")).toBe(table);
  });

  it("copies optional message markdown source", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const markdown = "**voice note**\n\n| A | B |\n|---|---|\n| true | false |";
    let copied = "";
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          copied = value;
          return Promise.resolve();
        },
      },
    });

    try {
      renderMessages(root, [message({ extraMarkdown: markdown, text: "Visual details." })]);

      await act(async () => {
        container!.querySelector<HTMLButtonElement>('button[aria-label="Copy markdown"]')!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(copied).toBe(markdown);
      expect(
        container.querySelector<HTMLButtonElement>('button[aria-label="Copied markdown"]'),
      ).not.toBeNull();
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it("does not render plain message text as markdown", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [message({ text: "| A | B |\n|---|---|\n| true | false |" })]);

    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe(
      "| A | B |\n|---|---|\n| true | false |",
    );
  });

  it("links attachment thumbnails to the full-quality image when a url exists", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 1,
        attachments: [
          {
            id: 7,
            filePath: "/tmp/shot.png",
            originalName: "shot.png",
            mimeType: "image/png",
            url: "/api/message-attachments/7",
            thumbnailDataUrl: "data:image/webp;base64,AAAA",
          },
        ],
      }),
    ]);

    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="/api/message-attachments/7"]',
    )!;
    expect(link).not.toBeNull();
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.querySelector("img")?.getAttribute("src")).toBe("data:image/webp;base64,AAAA");
  });

  it("keeps url-less attachments non-clickable", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 1,
        attachments: [
          {
            id: 8,
            filePath: "/tmp/local.png",
            originalName: "local.png",
            mimeType: "image/png",
            thumbnailDataUrl: "data:image/webp;base64,BBBB",
          },
        ],
      }),
    ]);

    expect(container.querySelector("a[href^='/api/message-attachments/']")).toBeNull();
    expect(container.textContent).toContain("local.png");
  });

  it("renders mp3 attachments with audio controls", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 1,
        attachments: [
          {
            id: 9,
            filePath: "/tmp/elevator.mp3",
            originalName: "elevator.mp3",
            mimeType: "audio/mpeg",
            url: "/api/message-attachments/9",
            thumbnailDataUrl: "",
          },
        ],
      }),
    ]);

    const audio = container.querySelector<HTMLAudioElement>("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("/api/message-attachments/9");
    expect(container.textContent).toContain("elevator.mp3");
  });

  it("shows retry affordance for failed OpenCode delivery", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 1,
        author: "user",
        sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
        status: "received",
        opencodeDeliveryStatus: "failed",
        opencodeDeliveryError: "OpenCode returned HTTP 500",
      }),
    ]);

    expect(container.textContent).toContain("OpenCode failed");
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(container.querySelector("summary")?.textContent).toBe("Details");
    expect(container.textContent).toContain("OpenCode returned HTTP 500");
    expect(container.textContent).toContain("Retry");
  });

  it("shows Cursor delivery failures with the real CLI error visible", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 1,
        author: "user",
        sessionId: "cur_9c7c8c5b-5666-42e9-b6a0-99d3a33a4431",
        status: "received",
        opencodeDeliveryStatus: "failed",
        opencodeDeliveryError: "Error: You've hit your usage limit",
      }),
    ]);

    expect(container.textContent).toContain("Cursor failed");
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(container.textContent).toContain("You've hit your usage limit");
    // Retry is available for every delivery-backed provider, not just OpenCode.
    expect(container.textContent).toContain("Retry");
  });

  it("offers Force send on a queued CLI row that is waiting for the provider to be idle", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 1,
        author: "user",
        sessionId: "cur_9c7c8c5b-5666-42e9-b6a0-99d3a33a4431",
        status: "received",
        opencodeDeliveryStatus: "queued",
      }),
    ]);

    expect(container.textContent).toContain("Waiting for Cursor to be idle");
    // The queued hold is real (CLI delivery waits out an open turn), so the
    // same Force send escape hatch OpenCode rows have applies here.
    expect(container.textContent).toContain("Force send");
    expect(container.textContent).not.toContain("Retry");
  });

  it("shows a dispatched-but-unconfirmed CLI delivery as a retryable failure", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 1,
        author: "user",
        sessionId: "cc_9c7c8c5b-5666-42e9-b6a0-99d3a33a4431",
        status: "received",
        opencodeDeliveryStatus: "failed",
        opencodeDeliveryError:
          "Couldn't confirm this reached Claude — check the session before retrying",
      }),
    ]);

    // One actionable state with the uncertainty in the detail text, rather than
    // a separate status the user could not do anything about.
    expect(container.textContent).toContain("Claude failed");
    expect(container.textContent).toContain("check the session before retrying");
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("Force send");
  });

  it("shows CLI timeout delivery without retry", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      message({
        id: 1,
        author: "user",
        sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
        status: "received",
        opencodeDeliveryStatus: "cli_timed_out",
        opencodeDeliveryError:
          "opencode CLI timed out after 15000ms; OpenCode may still be working.",
      }),
    ]);

    expect(container.textContent).toContain("OpenCode CLI timed out");
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(container.querySelector("summary")?.textContent).toBe("Details");
    expect(container.textContent).toContain("OpenCode may still be working");
    expect(container.textContent).not.toContain("Retry");
  });

  it("shows retry affordance for failed optimistic sends", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [
      createPendingMessage({
        id: "pending-test",
        author: "user",
        sessionId: "default",
        text: "optimistic message",
      }),
    ]);
    renderMessages(root, [
      {
        ...createPendingMessage({
          id: "pending-test",
          author: "user",
          sessionId: "default",
          text: "optimistic message",
        }),
        status: "failed",
        error: "Unable to submit message.",
      },
    ]);

    expect(container.textContent).toContain("failed");
    expect(container.textContent).toContain("Unable to submit message.");
    expect(container.textContent).toContain("Retry");
  });

  it("does not treat server speaking status as local playback", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    renderMessages(root, [message({ id: 1, status: "speaking" })]);

    expect(container.textContent).toContain("Play");
    const stopButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Stop",
    );
    expect(stopButton?.disabled).toBe(false);
  });

  it("keeps browser playback state in a singleton store", () => {
    browserPlaybackStore.cancelActive();
    const cancel = vi.fn();
    const listener = vi.fn();
    const unsubscribe = browserPlaybackStore.subscribe(listener);

    try {
      const token = browserPlaybackStore.begin({
        messageId: 42,
        sessionId: "ses_e946608d8f44iE5XvXLyK7tlO9",
      });
      browserPlaybackStore.setCancel(token, cancel);

      expect(browserPlaybackStore.getSnapshot()).toMatchObject({
        messageId: 42,
        sessionId: "ses_e946608d8f44iE5XvXLyK7tlO9",
        token,
      });
      expect(browserPlaybackStore.isActive(token, 42)).toBe(true);
      browserPlaybackStore.setShowEnableSound(true);
      browserPlaybackStore.setSoundEnabled(true);
      expect(browserPlaybackStore.getSnapshot()).toMatchObject({
        showEnableSound: false,
        soundEnabled: true,
      });

      const active = browserPlaybackStore.cancelActive();

      expect(active?.messageId).toBe(42);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(browserPlaybackStore.getSnapshot()).toMatchObject({
        messageId: null,
        sessionId: null,
        token: null,
      });
      expect(listener).toHaveBeenCalled();
    } finally {
      unsubscribe();
      browserPlaybackStore.cancelActive();
    }
  });
});
