/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SpaceActivityHistory } from "./components/page/SpaceActivityHistory.tsx";
import type { SpaceActivityPayload } from "./types.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const payload: SpaceActivityPayload = {
  spaceId: "space-1",
  spaceName: "e2e sessions",
  messageLimit: 200,
  timerFreshnessNote: "Routine remaining/next-fire values come from the live routines row.",
  retention: {
    messageScanLimit: 200,
    messageScanTruncated: false,
    notificationRetentionLimit: 30,
    maxRangeHours: 720,
    appliedRangeHours: 168,
    rangeClamped: false,
    timerFreshnessNote: "Routine remaining/next-fire values come from the live routines row.",
    scopeNote: "Events cover sessions currently attached to this space.",
  },
  events: [
    {
      id: "message:1",
      type: "message",
      sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
      sessionTitle: "E2E testing session",
      title: "Agent message",
      detail: "ROSTER-LIVE-2026",
      createdAt: "2026-07-18 03:00:00",
      url: "/ses/ses_82c41693cb14xpTRmGfTDe4Qs6",
      dismissedAt: null,
    },
    {
      id: "notification:2",
      type: "notification",
      sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
      sessionTitle: "E2E testing session",
      title: "say-to-me",
      detail: "Real notification event",
      createdAt: "2026-07-18 02:00:00",
      url: "/ses/ses_82c41693cb14xpTRmGfTDe4Qs6",
      dismissedAt: null,
    },
    {
      id: "attachment:ses_82c41693cb14xpTRmGfTDe4Qs6",
      type: "attachment",
      sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
      sessionTitle: "E2E testing session",
      title: "Attached to space",
      detail: "Attached",
      createdAt: "2026-07-10 01:00:00",
      url: "/ses/ses_82c41693cb14xpTRmGfTDe4Qs6",
      dismissedAt: null,
    },
  ],
};

describe("SpaceActivityHistory", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.querySelectorAll("[data-space-activity-history]").forEach((el) => el.remove());
    for (const child of document.body.children) {
      if (child instanceof HTMLElement) child.removeAttribute("inert");
    }
  });

  function render(node: React.ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<MemoryRouter>{node}</MemoryRouter>);
    });
  }

  function portalText() {
    return document.body.querySelector("[data-space-activity-history]")?.textContent ?? "";
  }

  it("loads real events, finds ROSTER-LIVE-2026, and filters by type", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toContain("hours=168");
      return Response.json(payload);
    });

    await act(async () => {
      render(
        <SpaceActivityHistory
          open
          spaceId="space-1"
          spaceName="e2e sessions"
          onClose={() => undefined}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(portalText()).toContain("ROSTER-LIVE-2026");
    expect(portalText()).toContain("Real notification event");
    expect(portalText()).toContain("from messages table");
    expect(portalText()).toContain("from notifications table");
    expect(portalText()).toContain("currently attached");
    expect(portalText()).not.toContain("1 year");

    const messageChip = Array.from(
      document.body.querySelectorAll("[data-space-activity-history] button"),
    ).find((node) => node.textContent === "message") as HTMLButtonElement;
    await act(async () => {
      messageChip.click();
    });
    expect(portalText()).toContain("ROSTER-LIVE-2026");
    expect(portalText()).not.toContain("Real notification event");
  });

  it("focuses the search field, traps Tab, restores focus on close", async () => {
    globalThis.fetch = vi.fn(async () => Response.json(payload));
    const trigger = document.createElement("button");
    trigger.textContent = "View full history →";
    document.body.appendChild(trigger);
    trigger.focus();

    let open = true;
    function Harness() {
      return (
        <SpaceActivityHistory
          open={open}
          spaceId="space-1"
          spaceName="e2e sessions"
          onClose={() => {
            open = false;
          }}
          returnFocusTo={trigger}
        />
      );
    }

    await act(async () => {
      render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

    const search = document.body.querySelector(
      'input[aria-label="Search space history"]',
    ) as HTMLInputElement;
    expect(document.activeElement).toBe(search);

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled])",
      ),
    ];
    focusable.at(-1)?.focus();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    // Escape calls onClose; remount closed
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceActivityHistory
            open={false}
            spaceId="space-1"
            spaceName="e2e sessions"
            onClose={() => undefined}
            returnFocusTo={trigger}
          />
        </MemoryRouter>,
      );
    });
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
