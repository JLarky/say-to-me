/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("./spaces-api.ts", () => ({
  fetchSpaceState: vi.fn(),
  archiveSession: vi.fn(),
  archiveSpace: vi.fn(),
  attachRepositoryToSpace: vi.fn(),
  claimWorktree: vi.fn(),
  claimSession: vi.fn(),
  createSpace: vi.fn(),
  createWorktree: vi.fn(),
  deleteSession: vi.fn(),
  deleteSpace: vi.fn(),
  discoverWorktrees: vi.fn(),
  moveSpace: vi.fn(),
  moveSession: vi.fn(),
  releaseRepository: vi.fn(),
  releaseAllWorktrees: vi.fn(),
  releaseSession: vi.fn(),
  releaseWorktree: vi.fn(),
  restoreSpace: vi.fn(),
  updateRepository: vi.fn(),
  updateSpace: vi.fn(),
}));

vi.mock("./settings-api.ts", () => ({
  DEFAULT_WORKTREE_PARENT_PATH: "~/worktrees",
  displayLocationPath: (value: string | null | undefined, fallback: string) => value || fallback,
  fetchSettings: vi.fn(async () => ({
    preferredWorktreeParentPath: null,
    preferredJarvisParentPath: null,
    t3ServerInstances: [],
  })),
}));

const { fetchSpaceState, attachRepositoryToSpace } = await import("./spaces-api.ts");
const { NewDashboardPage } = await import("./components/page/NewDashboardPage.tsx");

const defaultSpace = {
  id: "space-default",
  name: "Default",
  parentId: null,
  archived: false,
  context: "Your first space for repositories, worktrees, and agent sessions.",
  repos: [],
  sessions: [],
};

describe("NewDashboardPage empty and route states", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    vi.mocked(fetchSpaceState).mockReset();
    vi.mocked(attachRepositoryToSpace).mockReset();
  });

  async function renderDashboard(initialPath = "/dashboard") {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/dashboard" element={<NewDashboardPage />} />
            <Route path="/dashboard/:spaceId" element={<NewDashboardPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("shows pending load status before spaces resolve", async () => {
    let resolveSpaces!: (value: {
      selectedSpaceId: string;
      spaces: (typeof defaultSpace)[];
    }) => void;
    vi.mocked(fetchSpaceState).mockReturnValue(
      new Promise((resolve) => {
        resolveSpaces = resolve;
      }),
    );

    await renderDashboard();
    expect(container!.textContent).toContain("Loading spaces…");
    expect(container!.textContent).not.toContain("No spaces yet");
    expect(container!.textContent).not.toContain("Create a space");

    await act(async () => {
      resolveSpaces({ selectedSpaceId: defaultSpace.id, spaces: [defaultSpace] });
      await Promise.resolve();
    });
  });

  it("shows only the request error when loading spaces fails", async () => {
    vi.mocked(fetchSpaceState).mockRejectedValue(new Error("spaces unavailable"));
    await renderDashboard();
    expect(container!.textContent).toContain("spaces unavailable");
    expect(container!.textContent).not.toContain("No spaces yet");
    expect(container!.textContent).not.toContain("Create a space");
  });

  it("shows the seeded Default space instead of Loading spaces", async () => {
    vi.mocked(fetchSpaceState).mockResolvedValue({
      selectedSpaceId: defaultSpace.id,
      spaces: [defaultSpace],
    });
    await renderDashboard();
    expect(container!.textContent).toContain("Default");
    expect(container!.textContent).not.toContain("Loading spaces");
    expect(container!.textContent).not.toContain("No spaces yet");
  });

  it("shows an empty state after the last space is deleted", async () => {
    vi.mocked(fetchSpaceState).mockResolvedValue({
      selectedSpaceId: "",
      spaces: [],
    });
    await renderDashboard();
    expect(container!.textContent).toContain("No spaces yet");
    expect(container!.textContent).toContain("Create a space");
    expect(container!.textContent).not.toContain("Loading spaces");
  });

  it("redirects invalid space routes back to /dashboard", async () => {
    vi.mocked(fetchSpaceState).mockResolvedValue({
      selectedSpaceId: defaultSpace.id,
      spaces: [defaultSpace],
    });
    await renderDashboard("/dashboard/missing-space");
    expect(container!.textContent).toContain("Default");
    expect(container!.textContent).not.toContain("Loading spaces");
  });

  it("redirects archived space routes away from the archived deep link", async () => {
    const archived = {
      ...defaultSpace,
      id: "space-archived",
      name: "Archived",
      archived: true,
    };
    const active = {
      ...defaultSpace,
      id: "space-active",
      name: "Active",
    };
    vi.mocked(fetchSpaceState).mockResolvedValue({
      selectedSpaceId: active.id,
      spaces: [active, archived],
    });
    await renderDashboard("/dashboard/space-archived");
    expect(container!.textContent).toContain("Active");
    expect(container!.textContent).not.toContain("Loading spaces");
  });

  it("offers known repos from other spaces in the New worktree picker", async () => {
    const fresh = {
      ...defaultSpace,
      id: "space-fresh",
      name: "Fresh",
      repos: [],
    };
    const home = {
      ...defaultSpace,
      id: "space-home",
      name: "Home",
      repos: [
        {
          id: "repo-say",
          name: "say-to-me",
          path: "/home/dev/say-to-me",
          primaryBranch: "main",
          worktrees: [],
        },
      ],
    };
    vi.mocked(fetchSpaceState).mockResolvedValue({
      selectedSpaceId: fresh.id,
      spaces: [fresh, home],
    });
    await renderDashboard(`/dashboard/${fresh.id}`);
    const button = Array.from(container!.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Choose repository for new worktree"),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain("Choose repository");
    expect(container!.textContent).toContain("say-to-me");
    expect(container!.textContent).toContain("Attach repository");
  });

  it("offers New agent as the primary action and opens the agent picker when no repo is selected", async () => {
    vi.mocked(fetchSpaceState).mockResolvedValue({
      selectedSpaceId: defaultSpace.id,
      spaces: [defaultSpace],
    });
    await renderDashboard(`/dashboard/${defaultSpace.id}`);
    const button = Array.from(container!.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Choose context for new agent"),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain("NEW AGENT");
    expect(container!.textContent).toContain("Choose Git context");
  });

  it("shows an attach empty state when the app knows zero repositories", async () => {
    vi.mocked(fetchSpaceState).mockResolvedValue({
      selectedSpaceId: defaultSpace.id,
      spaces: [defaultSpace],
    });
    await renderDashboard(`/dashboard/${defaultSpace.id}`);
    const button = Array.from(container!.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Choose repository for new worktree"),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain(
      "No repositories known yet. Attach a local Git repository to continue.",
    );
    expect(container!.textContent).toContain("Attach repository");
  });

  it("keeps the full base branch when attaching from a cross-space worktree pick", async () => {
    const sourceRepo = {
      id: "repo-say",
      name: "say-to-me",
      path: "/home/dev/say-to-me",
      primaryBranch: "main",
      worktrees: ["foo"],
      worktreeBranches: { foo: "feature/foo" },
    };
    const fresh = {
      ...defaultSpace,
      id: "space-fresh",
      name: "Fresh",
      repos: [],
    };
    const home = {
      ...defaultSpace,
      id: "space-home",
      name: "Home",
      repos: [sourceRepo],
    };
    const attachedOnlyMain = {
      id: "repo-say",
      name: "say-to-me",
      path: "/home/dev/say-to-me",
      primaryBranch: "main",
      worktrees: [] as string[],
    };
    vi.mocked(fetchSpaceState).mockResolvedValue({
      selectedSpaceId: fresh.id,
      spaces: [fresh, home],
    });
    vi.mocked(attachRepositoryToSpace).mockResolvedValue({
      state: {
        selectedSpaceId: fresh.id,
        spaces: [{ ...fresh, repos: [attachedOnlyMain] }, home],
      },
    });

    await renderDashboard(`/dashboard/${fresh.id}`);
    const openPicker = Array.from(container!.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Choose repository for new worktree"),
    );
    expect(openPicker).toBeTruthy();
    await act(async () => {
      openPicker!.click();
      await Promise.resolve();
    });

    const worktreeRow = Array.from(container!.querySelectorAll("button")).find(
      (node) =>
        node.textContent?.includes("foo") && node.textContent.includes("Branch: feature/foo"),
    );
    expect(worktreeRow).toBeTruthy();
    await act(async () => {
      worktreeRow!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(attachRepositoryToSpace).toHaveBeenCalledWith(
      fresh.id,
      "say-to-me",
      "/home/dev/say-to-me",
    );
    expect(container!.textContent).toContain("Add to say-to-me");
    const createFromInput = Array.from(container!.querySelectorAll("label")).find((label) =>
      label.textContent?.includes("CREATE FROM"),
    );
    const baseInput = createFromInput?.querySelector("input");
    expect(baseInput).toBeTruthy();
    expect(baseInput!.value).toBe("feature/foo");
  });
});
