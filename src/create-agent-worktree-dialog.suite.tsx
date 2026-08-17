/** @vitest-environment jsdom */
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CreateAgentWorktreeDialog } from "./components/CreateAgentWorktreeDialog.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("./agent-worktree-session.ts", async () => {
  const actual = await vi.importActual<typeof import("./agent-worktree-session.ts")>(
    "./agent-worktree-session.ts",
  );
  return {
    ...actual,
    createAgentWorktreeSession: vi.fn(),
  };
});

vi.mock("./session-creation-api.ts", async () => {
  const actual = await vi.importActual<typeof import("./session-creation-api.ts")>(
    "./session-creation-api.ts",
  );
  return {
    ...actual,
    fetchProviderModels: vi.fn(async () => [
      { providerID: "cursor", id: "cursor-grok-4.5-high", name: "Cursor Grok 4.5 High" },
    ]),
  };
});

/** Mirrors NewDashboardPage Escape rules for the agent dialog. */
function DashboardAgentDialogHarness() {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (open && !busy) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, open]);

  if (!open) return <div data-testid="dashboard-without-dialog">closed</div>;

  return (
    <CreateAgentWorktreeDialog
      spaceId="spc_1"
      spaceName="Home"
      repoId="repo_1"
      repoName="say-to-me"
      base="feat/example"
      parentPath="~/.say-to-me/workspaces"
      onBusyChange={setBusy}
      onClose={() => {
        if (!busy) setOpen(false);
      }}
      onCreated={() => {
        setOpen(false);
        setBusy(false);
      }}
    />
  );
}

describe("CreateAgentWorktreeDialog keyboard accessibility", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    vi.clearAllMocks();
  });

  it("focuses the first input like Create Jarvis and restores the opener on unmount", async () => {
    const opener = document.createElement("button");
    opener.textContent = "opener";
    document.body.append(opener);
    opener.focus();

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <CreateAgentWorktreeDialog
          spaceId="spc_1"
          spaceName="Home"
          repoId="repo_1"
          repoName="say-to-me"
          base="feat/example"
          parentPath="~/.say-to-me/workspaces"
          returnFocusTo={opener}
          onClose={() => undefined}
          onCreated={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    expect(document.activeElement).toBe(checkbox);

    act(() => root!.unmount());
    root = undefined;
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps Tab focus inside the dialog while creating", async () => {
    const { createAgentWorktreeSession } = await import("./agent-worktree-session.ts");
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Controlled Promise resolver forwards the mocked success value unchanged.
    let resolveCreate!: (value: unknown) => void;
    vi.mocked(createAgentWorktreeSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }) as never,
    );

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <CreateAgentWorktreeDialog
          spaceId="spc_1"
          spaceName="Home"
          repoId="repo_1"
          repoName="say-to-me"
          base="feat/example"
          parentPath="~/.say-to-me/workspaces"
          onClose={() => undefined}
          onCreated={() => undefined}
        />,
      );
    });
    await act(async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const submit = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.type === "submit",
        );
        if (submit && !submit.disabled) break;
        await Promise.resolve();
      }
    });

    await act(async () => {
      container!
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const dialog = container.querySelector<HTMLFormElement>('[role="dialog"]');
    expect(dialog).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(dialog?.contains(document.activeElement) || document.activeElement === dialog).toBe(
      true,
    );

    resolveCreate({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      sessionId: "cur_test",
      worktreePath: "/tmp/wt",
      branch: "agent/cursor-test",
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("closes on Escape when idle", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(<DashboardAgentDialogHarness />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[data-testid="dashboard-without-dialog"]')).toBeTruthy();
  });

  it("stays open on Escape while create is busy", async () => {
    const { createAgentWorktreeSession } = await import("./agent-worktree-session.ts");
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Controlled Promise resolver forwards the mocked success value unchanged.
    let resolveCreate!: (value: unknown) => void;
    vi.mocked(createAgentWorktreeSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }) as never,
    );

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(<DashboardAgentDialogHarness />);
    });
    await act(async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const submit = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.type === "submit",
        );
        if (submit && !submit.disabled) break;
        await Promise.resolve();
      }
    });
    await act(async () => {
      container!
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    resolveCreate({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      sessionId: "cur_test",
      worktreePath: "/tmp/wt",
      branch: "agent/cursor-test",
    });
    await act(async () => {
      await Promise.resolve();
    });
  });
});
