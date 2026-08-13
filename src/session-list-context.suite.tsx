/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionList } from "./components/SessionList.tsx";
import { openCodeWorkspaceKey, sessionsHref, workspaceFilterHref } from "./utils.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const noop = () => {};

describe("SessionList OpenCode context label", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  function renderSessions(
    sessions: Parameters<typeof SessionList>[0]["sessions"],
    onOpen: Parameters<typeof SessionList>[0]["onOpen"] = noop,
  ) {
    function LocationProbe() {
      return <span data-location={useLocation().pathname} />;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <MemoryRouter initialEntries={["/"]}>
          <SessionList sessions={sessions} onOpen={onOpen} />
          <LocationProbe />
        </MemoryRouter>,
      );
    });
  }

  it("opens sessions through React Router without a document navigation", () => {
    const onOpen = vi.fn();
    renderSessions([{ id: "ses_161a212b0568jmMhcpbgKXb3HV", messageCount: 0 }], onOpen);

    const open = [...container!.querySelectorAll("a")].find((link) => link.textContent === "Open");
    expect(open?.getAttribute("href")).toBe("/ses/ses_161a212b0568jmMhcpbgKXb3HV");

    act(() => {
      open?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onOpen).toHaveBeenCalledWith("ses_161a212b0568jmMhcpbgKXb3HV");
    expect(container!.querySelector("[data-location]")?.getAttribute("data-location")).toBe(
      "/ses/ses_161a212b0568jmMhcpbgKXb3HV",
    );
  });

  it("renders a Cursor folder pill for external CLI sessions with cwd", () => {
    const cwd = "/Users/jlarky/vm/JLarky/llm-usage";
    renderSessions([
      {
        id: "cur_146c3386-b32d-4e99-b1c3-4a1bd7e87334",
        backend: "cursor",
        messageCount: 0,
        cwd,
      },
    ]);

    const badge = [...container!.querySelectorAll("span[title]")].find((span) =>
      span.textContent?.startsWith("Cursor/"),
    );
    expect(badge?.textContent).toBe("Cursor/llm-usage");
    const folderLink = [...container!.querySelectorAll("a")].find(
      (link) => link.textContent === "llm-usage",
    );
    expect(folderLink?.getAttribute("href")).toBe(sessionsHref(cwd));
  });

  it("links each segment to its stable-id filter route", () => {
    renderSessions([
      {
        id: "ses_19ef13a06c46l2yxqumzmEqyDA",
        messageCount: 0,
        opencodeProjectId: "prj_abc",
        opencodeWorkspaceId: "wrk_xyz",
        opencodeProjectName: "demo-project",
        opencodeWorktree: "/home/dev/Downloads/project1",
        opencodeDirectory: "/home/dev/.opencode/worktree/abc/eager-harbor",
        opencodeBranch: "opencode/eager-harbor",
      },
    ]);

    const links = [...container!.querySelectorAll("a")];
    const project = links.find((a) => a.textContent === "demo-project");
    const workspace = links.find((a) => a.textContent === "eager-harbor");
    expect(project?.getAttribute("href")).toBe("/project/prj_abc");
    expect(workspace?.getAttribute("href")).toBe("/project/prj_abc/workspace/wrk_xyz");
  });

  it("falls back to the directory for the workspace link when there is no workspace id", () => {
    const session = {
      id: "ses_19ef13a06c46l2yxqumzmEqyDA",
      messageCount: 0,
      opencodeProjectId: "prj_abc",
      opencodeProjectName: "demo-project",
      opencodeWorktree: "/home/dev/Downloads/project1",
      opencodeDirectory: "/home/dev/.opencode/worktree/524c/eager-harbor",
      opencodeBranch: "opencode/eager-harbor",
    };
    renderSessions([session]);

    const links = [...container!.querySelectorAll("a")];
    expect(links.find((a) => a.textContent === "demo-project")?.getAttribute("href")).toBe(
      "/project/prj_abc",
    );
    const workspace = links.find((a) => a.textContent === "eager-harbor");
    expect(workspace?.getAttribute("href")).toBe(
      workspaceFilterHref("prj_abc", openCodeWorkspaceKey(session)!),
    );
  });
});
