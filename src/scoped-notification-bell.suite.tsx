/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ScopedNotificationBell } from "./components/page/ScopedNotificationBell.tsx";
import type { AppNotification } from "./types.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function note(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 1,
    sessionId: "ses_ede594d11ac4HSUt0fviu5foXL",
    sessionTitle: "E2E testing session",
    title: "say-to-me",
    body: "Fixture notification body",
    url: "/ses/ses_ede594d11ac4HSUt0fviu5foXL",
    dismissedAt: null,
    createdAt: "2026-07-18 02:00:00",
    ...overrides,
  };
}

describe("ScopedNotificationBell", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function render(node: React.ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<MemoryRouter>{node}</MemoryRouter>);
    });
  }

  it("scopes This space versus All and dismisses via the provided handler", async () => {
    const onDismiss = vi.fn(async () => undefined);
    const notifications = [
      note({ id: 11, sessionId: "ses_ede594d11ac4HSUt0fviu5foXL", body: "In this space" }),
      note({
        id: 12,
        sessionId: "ses_639753befdf6wDbqip9t5rYV7Z",
        sessionTitle: "Other session",
        body: "Outside space",
      }),
    ];

    render(
      <ScopedNotificationBell
        spaceId="space-1"
        spaceName="e2e sessions"
        spaceSessionIds={["ses_ede594d11ac4HSUt0fviu5foXL"]}
        notifications={notifications}
        notificationsLoaded
        onDismiss={onDismiss}
      />,
    );

    const trigger = container.querySelector(
      'button[aria-label="Notifications, 1 active"]',
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();

    act(() => {
      trigger.click();
    });
    expect(container.textContent).toContain("In this space");
    expect(container.textContent).not.toContain("Outside space");

    const allTab = Array.from(container.querySelectorAll('[role="tab"]')).find((node) =>
      node.textContent?.includes("All Say To Me"),
    ) as HTMLButtonElement;
    act(() => {
      allTab.click();
    });
    expect(container.textContent).toContain("Outside space");

    const dismiss = container.querySelector(
      'button[aria-label="Dismiss notification from Other session"]',
    ) as HTMLButtonElement;
    await act(async () => {
      dismiss.click();
    });
    expect(onDismiss).toHaveBeenCalledWith(12);
  });

  it("falls back to All when no space is selected", () => {
    render(
      <ScopedNotificationBell
        notifications={[note({ id: 3, body: "Global only" })]}
        notificationsLoaded
      />,
    );
    const trigger = container.querySelector(
      'button[aria-label="Notifications, 1 active"]',
    ) as HTMLButtonElement;
    act(() => {
      trigger.click();
    });
    const spaceTab = Array.from(container.querySelectorAll('[role="tab"]')).find((node) =>
      node.textContent?.includes("This space"),
    ) as HTMLButtonElement;
    expect(spaceTab.disabled).toBe(true);
    expect(container.textContent).toContain("Global only");
  });
});
