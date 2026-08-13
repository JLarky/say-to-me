/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { SessionGroupPage } from "./components/page/SessionGroupPage.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("SessionGroupPage", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  const sessionsPayload = {
    sessions: [
      {
        id: "ses_6f7ff81a35dfGuQ6ZVL7cSlhhM",
        messageCount: 1,
        opencodeProjectId: "prj_iq",
        opencodeWorkspaceId: "wrk_eager",
        opencodeProjectName: "demo-project",
        opencodeWorktree: "/home/dev/Downloads/project1",
        opencodeDirectory: "/home/dev/.opencode/worktree/abc/eager-harbor",
        opencodeBranch: "opencode/eager-harbor",
      },
      {
        id: "ses_72a3bd0b1e24kkoCn9yX0fQU0i",
        messageCount: 2,
        opencodeProjectId: "prj_iq",
        opencodeWorkspaceId: "wrk_other",
        opencodeProjectName: "demo-project",
        opencodeWorktree: "/home/dev/Downloads/project1",
        opencodeDirectory: "/home/dev/.opencode/worktree/def/calm-bay",
        opencodeBranch: "opencode/calm-bay",
      },
      {
        id: "ses_02856b9ef10e6RJUTpje6WxtHa",
        messageCount: 3,
        opencodeProjectId: "prj_other",
        opencodeProjectName: "say-to-me",
      },
    ],
  };

  async function renderAt(path: string) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/project/:projectId" element={<SessionGroupPage />} />
            <Route
              path="/project/:projectId/workspace/:workspaceId"
              element={<SessionGroupPage />}
            />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("filters to one project and shows every session in it", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(sessionsPayload), {
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;

    try {
      await renderAt("/project/prj_iq");
      expect(container!.textContent).toContain("demo-project");
      expect(container!.textContent).toContain("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM");
      expect(container!.textContent).toContain("ses_72a3bd0b1e24kkoCn9yX0fQU0i");
      expect(container!.textContent).not.toContain("ses_02856b9ef10e6RJUTpje6WxtHa");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("filters to one workspace and shows the project / workspace breadcrumb", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(sessionsPayload), {
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;

    try {
      await renderAt("/project/prj_iq/workspace/wrk_eager");
      const title = container!.querySelector("h1");
      expect(title?.textContent).toBe("demo-project / eager-harbor");
      expect(container!.textContent).toContain("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM");
      expect(container!.textContent).not.toContain("ses_72a3bd0b1e24kkoCn9yX0fQU0i");
      expect(container!.textContent).not.toContain("ses_02856b9ef10e6RJUTpje6WxtHa");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  function findButton(label: string): HTMLButtonElement | undefined {
    return [...container!.querySelectorAll("button")].find((b) => b.textContent === label);
  }

  it("offers a single create-in-this-workspace action on a workspace page", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(sessionsPayload), {
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;

    try {
      await renderAt("/project/prj_iq/workspace/wrk_eager");
      expect(findButton("Create session in this workspace")?.disabled).toBe(false);
      expect(findButton("Create worktree")).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("disables the workspace create action when the workspace has no cached directory", async () => {
    const originalFetch = globalThis.fetch;
    const payload = {
      sessions: [
        {
          id: "ses_9698af782ba2hZejEu2kgvVtbP",
          messageCount: 0,
          opencodeProjectId: "prj_iq",
          opencodeWorkspaceId: "wrk_nodir",
          opencodeProjectName: "demo-project",
        },
      ],
    };
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;

    try {
      await renderAt("/project/prj_iq/workspace/wrk_nodir");
      expect(findButton("Create session in this workspace")?.disabled).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("offers a create-worktree action on a project page, enabled from the project directory", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(sessionsPayload), {
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;

    try {
      await renderAt("/project/prj_iq");
      expect(findButton("Create session in demo-project")?.disabled).toBe(false);
      expect(findButton("Create worktree")?.disabled).toBe(false);
      expect(findButton("Create session in this workspace")).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
