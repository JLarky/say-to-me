/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sortPrototypeRosterSessions, type PrototypeSession } from "./new-space-prototype.ts";
import { SpaceSessionRoster } from "./components/page/SpaceSessionRoster.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function baseSession(overrides: Partial<PrototypeSession> = {}): PrototypeSession {
  return {
    id: "ses_8a6e1aba4983dIrSSmkVUyda9N",
    title: "Demo session",
    agent: "OpenCode",
    provider: "OpenCode",
    model: "gpt-4.1",
    status: "Attached",
    tone: "blue",
    rosterStatus: "idle",
    rosterStatusLabel: "IDLE",
    workspacePath: "/tmp/demo",
    workspaceLabel: "demo",
    latestSayMessage: "Hello from Say",
    latestActivityText: "Hello from Say",
    activityAt: "2026-07-18 00:00:00",
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe("SpaceSessionRoster", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function render(node: React.ReactElement, initialPath = "/") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  {node}
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  it("opens the session from a real href with SPA left-click and expands only via details", () => {
    render(
      <SpaceSessionRoster
        spaceName="Test space"
        sessions={[baseSession({ id: "ses_3dbf40ed5909aMeCoezIWV8hSp_expand" })]}
      />,
    );

    const open = container.querySelector(
      'a[aria-label="Open session Demo session"]',
    ) as HTMLAnchorElement;
    const expand = container.querySelector(
      'button[aria-label="Show details for Demo session"]',
    ) as HTMLButtonElement;
    expect(open).toBeTruthy();
    expect(open.getAttribute("href")).toBe("/ses/ses_3dbf40ed5909aMeCoezIWV8hSp_expand");
    expect(open.tagName).toBe("A");
    expect(open.hasAttribute("data-session-link")).toBe(true);
    expect(expand).toBeTruthy();
    expect(
      container.querySelector("#session-details-ses_3dbf40ed5909aMeCoezIWV8hSp_expand"),
    ).toBeNull();

    act(() => {
      expand.click();
    });
    expect(
      container.querySelector("#session-details-ses_3dbf40ed5909aMeCoezIWV8hSp_expand"),
    ).toBeTruthy();
    expect(container.textContent).toContain("Hello from Say");
    expect(container.textContent).toContain("ses_3dbf40ed5909aMeCoezIWV8hSp_expand");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/");

    const idLink = container.querySelector(
      'a[data-session-link][href="/ses/ses_3dbf40ed5909aMeCoezIWV8hSp_expand"]',
    ) as HTMLAnchorElement;
    expect(idLink).toBeTruthy();

    act(() => {
      open.click();
    });
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      "/ses/ses_3dbf40ed5909aMeCoezIWV8hSp_expand",
    );
  });

  it("splits browser and custom context menus between the anchor and the row body", () => {
    const onSessionContextMenu = vi.fn();
    render(
      <SpaceSessionRoster
        spaceName="Test space"
        sessions={[baseSession({ id: "ses_c9811c25b276oSFxILLxuuqMMs" })]}
        onSessionContextMenu={onSessionContextMenu}
      />,
    );

    const open = container.querySelector(
      'a[aria-label="Open session Demo session"]',
    ) as HTMLAnchorElement;
    const row = container.querySelector("li") as HTMLLIElement;

    act(() => {
      const linkEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      const linkPrevented = !open.dispatchEvent(linkEvent);
      expect(linkPrevented).toBe(false);
    });
    expect(onSessionContextMenu).not.toHaveBeenCalled();

    act(() => {
      const body = container.querySelector("[data-session-item] time") as HTMLElement;
      const bodyEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      const bodyPrevented = !body.dispatchEvent(bodyEvent);
      expect(bodyPrevented).toBe(true);
    });
    expect(onSessionContextMenu).toHaveBeenCalledWith(
      "ses_c9811c25b276oSFxILLxuuqMMs",
      expect.any(Object),
    );
    expect(row.hasAttribute("data-session-item")).toBe(true);
  });
  it("keeps actionable sessions ahead of idle after roster sort", () => {
    const sessions = sortPrototypeRosterSessions([
      baseSession({
        id: "ses_09a0fc08523fctVzW8czyW9yAN",
        title: "Idle one",
        rosterStatus: "idle",
        rosterStatusLabel: "IDLE",
      }),
      baseSession({
        id: "ses_2102513b0b21o22EuhpphVgARu",
        title: "Broken one",
        rosterStatus: "error",
        rosterStatusLabel: "ERROR",
        latestActivityText: "Delivery failed",
      }),
    ]);
    render(<SpaceSessionRoster spaceName="Test space" sessions={sessions} />);
    const titles = Array.from(container.querySelectorAll("ol strong")).map(
      (node) => node.textContent,
    );
    expect(titles[0]).toBe("Broken one");
    expect(titles[1]).toBe("Idle one");
  });

  it("omits optional expanded fields when absent", () => {
    render(
      <SpaceSessionRoster
        spaceName="Test space"
        sessions={[
          baseSession({
            id: "ses_0a04e344f990jD0QwuunJrMd42",
            workspacePath: null,
            workspaceLabel: null,
            latestSayMessage: null,
            latestActivityText: null,
            timerSummary: null,
            importedAt: null,
            latestDeliveryError: null,
          }),
        ]}
      />,
    );
    act(() => {
      (
        container.querySelector(
          'button[aria-label="Show details for Demo session"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(container.textContent).toContain("No Say messages yet");
    expect(container.textContent).not.toContain("WORKSPACE");
    expect(container.textContent).not.toContain("TIMER");
    expect(container.textContent).not.toContain("DELIVERY ERROR");
  });

  it("opens full history from the roster footer control", () => {
    const onViewHistory = vi.fn();
    render(
      <SpaceSessionRoster
        spaceName="Test space"
        sessions={[baseSession()]}
        onViewHistory={onViewHistory}
      />,
    );
    const button = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("View full history"),
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    act(() => {
      button.click();
    });
    expect(onViewHistory).toHaveBeenCalled();
  });

  it("exposes archive and delete in expanded actions and opens a context menu", () => {
    const onArchiveSession = vi.fn();
    const onDeleteSession = vi.fn();
    const onSessionContextMenu = vi.fn();
    render(
      <SpaceSessionRoster
        spaceName="Test space"
        sessions={[baseSession({ id: "ses_6555f9226a48u0KRJiQU2ZQKtw" })]}
        onArchiveSession={onArchiveSession}
        onDeleteSession={onDeleteSession}
        onSessionContextMenu={onSessionContextMenu}
      />,
    );

    act(() => {
      (
        container.querySelector(
          'button[aria-label="Show details for Demo session"]',
        ) as HTMLButtonElement
      ).click();
    });
    const archive = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent === "Archive",
    ) as HTMLButtonElement;
    const remove = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent === "Delete",
    ) as HTMLButtonElement;
    expect(archive).toBeTruthy();
    expect(remove).toBeTruthy();
    act(() => {
      archive.click();
      remove.click();
    });
    expect(onArchiveSession).toHaveBeenCalledWith("ses_6555f9226a48u0KRJiQU2ZQKtw");
    expect(onDeleteSession).toHaveBeenCalledWith("ses_6555f9226a48u0KRJiQU2ZQKtw");

    const row = container.querySelector("li") as HTMLLIElement;
    expect(row.hasAttribute("data-session-item")).toBe(true);
    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 80 }));
    });
    expect(onSessionContextMenu).toHaveBeenCalledWith(
      "ses_6555f9226a48u0KRJiQU2ZQKtw",
      expect.any(Object),
    );
  });
});
