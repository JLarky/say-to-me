/** @vitest-environment jsdom */
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CreateJarvisDialog } from "./components/CreateJarvisDialog.tsx";
import { SpaceActionsTrigger, SpaceMenuContent } from "./components/page/NewDashboardChrome.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("./jarvis-create-api.ts", () => ({
  createJarvisInSpace: vi.fn(),
}));

vi.mock("./settings-api.ts", () => ({
  DEFAULT_JARVIS_PARENT_PATH: "~/.say-to-me/jarvis",
  displayLocationPath: (value: string | null | undefined, fallback: string) => value || fallback,
  fetchSettings: vi.fn(async () => ({
    preferredWorktreeParentPath: null,
    preferredJarvisParentPath: "~/.say-to-me/jarvis",
    t3ServerInstances: [],
  })),
}));

vi.mock("./session-creation-api.ts", async () => {
  const actual = await vi.importActual<typeof import("./session-creation-api.ts")>(
    "./session-creation-api.ts",
  );
  return {
    ...actual,
    fetchProviderModels: vi.fn(async (provider: string) => {
      if (provider === "claude") return [{ providerID: "anthropic", id: "opus", name: "Opus" }];
      if (provider === "codex") return [{ providerID: "openai", id: "gpt-5.4", name: "GPT 5.4" }];
      if (provider === "opencode")
        return [{ providerID: "openai", id: "gpt-4.1-mini", name: "gpt-4.1-mini" }];
      if (provider === "grok") return [];
      return [];
    }),
  };
});

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function waitForCreateJarvisReady(root: HTMLElement) {
  await act(async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const submit = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.type === "submit",
      );
      if (submit && !submit.disabled) return;
      await Promise.resolve();
    }
  });
}

async function submitCreateJarvisForm(root: HTMLElement) {
  await waitForCreateJarvisReady(root);
  await act(async () => {
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

/** Mirrors NewDashboardPage Escape + bootstrap-failure navigation rules. */
function DashboardCreateJarvisHarness({
  onNavigate,
  onBootstrapError,
}: {
  onNavigate: (sessionId: string) => void;
  onBootstrapError: (message: string) => void;
}) {
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
    <CreateJarvisDialog
      spaceId="spc_1"
      spaceName="Home"
      onBusyChange={setBusy}
      onClose={() => {
        if (!busy) setOpen(false);
      }}
      onCreated={({ sessionId, bootstrapStatus, bootstrapError }) => {
        setOpen(false);
        setBusy(false);
        if (bootstrapStatus === "failed") {
          onBootstrapError(bootstrapError || "Jarvis was created, but bootstrap delivery failed.");
          return;
        }
        onNavigate(sessionId);
      }}
    />
  );
}

describe("Create Jarvis frontend flows", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    vi.clearAllMocks();
  });

  it("marks Create Jarvis disabled with aria-disabled in the space menu", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <SpaceMenuContent
          title="Top level"
          createJarvisDisabled
          onCreateJarvis={() => undefined}
        />,
      );
    });
    const item = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Create Jarvis"),
    );
    expect(item?.disabled).toBe(true);
    expect(item?.getAttribute("aria-disabled")).toBe("true");
  });

  it("clears the previous provider model immediately on provider change", async () => {
    const { createJarvisInSpace } = await import("./jarvis-create-api.ts");
    const createMock = vi.mocked(createJarvisInSpace);
    createMock.mockResolvedValue({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      session: { id: "ses_82c41693cb14xpTRmGfTDe4Qs6" },
      workspaceDirectory: "/tmp/x",
      bootstrapStatus: "queued",
    } as never);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <CreateJarvisDialog
          spaceId="spc_1"
          spaceName="Home"
          defaultProvider="claude"
          defaultModel="opus"
          onClose={() => undefined}
          onCreated={() => undefined}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const submit = () =>
      [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.type === "submit",
      );

    expect(submit()?.disabled).toBe(false);

    const providerSelect = container.querySelector<HTMLSelectElement>("select");
    expect(providerSelect?.value).toBe("claude");

    act(() => {
      providerSelect!.value = "codex";
      providerSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(submit()?.disabled).toBe(true);
    expect(
      [...container.querySelectorAll("option")].some(
        (option) => option.getAttribute("value") === "opus",
      ),
    ).toBe(false);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(submit()?.disabled).toBe(false);
    const modelSelect = [...container.querySelectorAll<HTMLSelectElement>("select")][1];
    expect(modelSelect?.value).toBe("gpt-5.4");
  });

  it("shows an error with retry when the provider returns no models", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <CreateJarvisDialog
          spaceId="spc_1"
          spaceName="Home"
          defaultProvider="grok"
          onClose={() => undefined}
          onCreated={() => undefined}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/No models available/i);
    expect(container.textContent).toMatch(/Retry/i);
    const submit = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.type === "submit",
    );
    expect(submit?.disabled).toBe(true);
  });

  it("blocks Escape through the dashboard while create is busy", async () => {
    const { createJarvisInSpace } = await import("./jarvis-create-api.ts");
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Controlled Promise resolver forwards the mocked success value unchanged.
    let resolveCreate!: (value: unknown) => void;
    vi.mocked(createJarvisInSpace).mockImplementation(
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
        <DashboardCreateJarvisHarness
          onNavigate={() => undefined}
          onBootstrapError={() => undefined}
        />,
      );
    });

    const nameInput = container.querySelector<HTMLInputElement>("input");
    act(() => {
      setInputValue(nameInput!, "busy escape");
    });

    await submitCreateJarvisForm(container!);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    resolveCreate({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      session: { id: "ses_f98de3514a09pVgm0F0buZrRkc" },
      workspaceDirectory: "/tmp/x",
      bootstrapStatus: "queued",
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("does not navigate when bootstrap delivery fails", async () => {
    const { createJarvisInSpace } = await import("./jarvis-create-api.ts");
    vi.mocked(createJarvisInSpace).mockResolvedValue({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      session: { id: "ses_b9ed76a8d3ceLXDafY5Ru0egF0" },
      workspaceDirectory: "/tmp/x",
      bootstrapStatus: "failed",
      bootstrapError: "delivery blew up",
    } as never);

    const navigated: string[] = [];
    const errors: string[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <DashboardCreateJarvisHarness
          onNavigate={(sessionId) => navigated.push(sessionId)}
          onBootstrapError={(message) => errors.push(message)}
        />,
      );
    });

    const nameInput = container.querySelector<HTMLInputElement>("input");
    act(() => {
      setInputValue(nameInput!, "boot fail");
    });

    await submitCreateJarvisForm(container!);

    expect(navigated).toEqual([]);
    expect(errors).toEqual(["delivery blew up"]);
    expect(container.querySelector('[data-testid="dashboard-without-dialog"]')).toBeTruthy();
  });

  it("reports busy while creating so Escape will not close the dialog", async () => {
    const { createJarvisInSpace } = await import("./jarvis-create-api.ts");
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Controlled Promise resolver forwards the mocked success value unchanged.
    let resolveCreate!: (value: unknown) => void;
    vi.mocked(createJarvisInSpace).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }) as never,
    );

    const busy: boolean[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <CreateJarvisDialog
          spaceId="spc_1"
          spaceName="Home"
          onBusyChange={(next) => busy.push(next)}
          onClose={() => undefined}
          onCreated={() => undefined}
        />,
      );
    });

    const nameInput = container.querySelector<HTMLInputElement>("input");
    act(() => {
      setInputValue(nameInput!, "busy jarvis");
    });

    await submitCreateJarvisForm(container!);

    expect(busy.includes(true)).toBe(true);
    resolveCreate({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      session: { id: "ses_f98de3514a09pVgm0F0buZrRkc" },
      workspaceDirectory: "/tmp/x",
      bootstrapStatus: "queued",
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("surfaces bootstrap failure without treating create as a silent success path", async () => {
    const { createJarvisInSpace } = await import("./jarvis-create-api.ts");
    vi.mocked(createJarvisInSpace).mockResolvedValue({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      session: { id: "ses_b9ed76a8d3ceLXDafY5Ru0egF0" },
      workspaceDirectory: "/tmp/x",
      bootstrapStatus: "failed",
      bootstrapError: "delivery blew up",
    } as never);

    const created: Array<{ bootstrapStatus: string; bootstrapError?: string }> = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <CreateJarvisDialog
          spaceId="spc_1"
          spaceName="Home"
          onClose={() => undefined}
          onCreated={(result) => created.push(result)}
        />,
      );
    });

    const nameInput = container.querySelector<HTMLInputElement>("input");
    act(() => {
      setInputValue(nameInput!, "boot fail");
    });

    await submitCreateJarvisForm(container!);

    expect(created).toEqual([
      expect.objectContaining({
        bootstrapStatus: "failed",
        bootstrapError: "delivery blew up",
        sessionId: "ses_b9ed76a8d3ceLXDafY5Ru0egF0",
      }),
    ]);
  });

  it("keeps Tab focus inside the dialog while creating and restores the opener", async () => {
    const { createJarvisInSpace } = await import("./jarvis-create-api.ts");
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Controlled Promise resolver forwards the mocked success value unchanged.
    let resolveCreate!: (value: unknown) => void;
    vi.mocked(createJarvisInSpace).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }) as never,
    );

    const opener = document.createElement("button");
    opener.textContent = "opener";
    document.body.append(opener);
    opener.focus();

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <CreateJarvisDialog
          spaceId="spc_1"
          spaceName="Home"
          returnFocusTo={opener}
          onClose={() => undefined}
          onCreated={() => undefined}
        />,
      );
    });

    const nameInput = container.querySelector<HTMLInputElement>("input");
    act(() => {
      setInputValue(nameInput!, "focus trap");
    });

    await submitCreateJarvisForm(container!);

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
      session: { id: "ses_fc36a41f3eddB7Q3VpJTRcvySE" },
      workspaceDirectory: "/tmp/x",
      bootstrapStatus: "queued",
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => root!.unmount());
    root = undefined;
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("restores focus to the Space actions trigger through the real dashboard menu", async () => {
    const { createJarvisInSpace } = await import("./jarvis-create-api.ts");
    vi.mocked(createJarvisInSpace).mockResolvedValue({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      session: { id: "ses_c9811c25b276oSFxILLxuuqMMs_focus" },
      workspaceDirectory: "/tmp/x",
      bootstrapStatus: "queued",
    } as never);

    function MenuCreateJarvisFlow() {
      const [menuOpen, setMenuOpen] = useState(false);
      const [dialogOpen, setDialogOpen] = useState(false);
      const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null);
      return (
        <div>
          <SpaceActionsTrigger
            title="Home"
            open={menuOpen}
            onToggle={() => setMenuOpen((open) => !open)}
            onCreateJarvis={(opener) => {
              setReturnFocusTo(opener ?? null);
              setDialogOpen(true);
              setMenuOpen(false);
            }}
          />
          {dialogOpen ? (
            <CreateJarvisDialog
              spaceId="spc_1"
              spaceName="Home"
              returnFocusTo={returnFocusTo}
              onClose={() => setDialogOpen(false)}
              onCreated={() => setDialogOpen(false)}
            />
          ) : null}
        </div>
      );
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(<MenuCreateJarvisFlow />);
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Space actions"]',
    );
    expect(trigger).toBeTruthy();
    act(() => {
      trigger!.click();
    });
    const createItem = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Create Jarvis"),
    );
    expect(createItem).toBeTruthy();
    act(() => {
      createItem!.click();
    });
    // Menu unmounted — dialog restore target must be the persistent trigger.
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    // Close dialog while the Space actions trigger stays mounted.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    // CreateJarvisDialog listens for Escape only via onClose from parent — click backdrop cancel.
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    );
    expect(cancel).toBeTruthy();
    act(() => {
      cancel!.click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("restores focus to the context-menu opener, not the first Space actions trigger", async () => {
    const { createJarvisInSpace } = await import("./jarvis-create-api.ts");
    vi.mocked(createJarvisInSpace).mockResolvedValue({
      state: { selectedSpaceId: "spc_1", spaces: [] },
      session: { id: "ses_19ef13a06c46l2yxqumzmEqyDA_focus" },
      workspaceDirectory: "/tmp/x",
      bootstrapStatus: "queued",
    } as never);

    function DualTriggerContextMenuFlow() {
      const [dialogOpen, setDialogOpen] = useState(false);
      const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null);
      const [contextOpen, setContextOpen] = useState(false);
      const [contextOpener, setContextOpener] = useState<HTMLElement | null>(null);
      return (
        <div>
          {/* Mobile-first trigger (would be the wrong querySelector match). */}
          <div data-space-menu data-testid="mobile-trigger">
            <button type="button" aria-label="Space actions">
              mobile
            </button>
          </div>
          <button
            type="button"
            data-testid="space-nav-opener"
            onContextMenu={(event) => {
              event.preventDefault();
              setContextOpener(event.currentTarget);
              setContextOpen(true);
            }}
          >
            Space row
          </button>
          {/* Desktop trigger — second Space actions button. */}
          <SpaceActionsTrigger
            title="Home"
            open={false}
            onToggle={() => undefined}
            onCreateJarvis={() => undefined}
          />
          {contextOpen ? (
            <div role="menu" data-space-context-menu>
              <SpaceMenuContent
                title="Home"
                onCreateJarvis={() => {
                  setReturnFocusTo(contextOpener);
                  setDialogOpen(true);
                  setContextOpen(false);
                }}
              />
            </div>
          ) : null}
          {dialogOpen ? (
            <CreateJarvisDialog
              spaceId="spc_1"
              spaceName="Home"
              returnFocusTo={returnFocusTo}
              onClose={() => setDialogOpen(false)}
              onCreated={() => setDialogOpen(false)}
            />
          ) : null}
        </div>
      );
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root!.render(<DualTriggerContextMenuFlow />);
    });

    const spaceRow = container.querySelector<HTMLButtonElement>('[data-testid="space-nav-opener"]');
    const mobileTrigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="mobile-trigger"] button',
    );
    expect(spaceRow).toBeTruthy();
    expect(mobileTrigger).toBeTruthy();

    act(() => {
      spaceRow!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });
    const createItem = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Create Jarvis"),
    );
    expect(createItem).toBeTruthy();
    act(() => {
      createItem!.click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    );
    act(() => {
      cancel!.click();
    });
    expect(document.activeElement).toBe(spaceRow);
    expect(document.activeElement).not.toBe(mobileTrigger);
  });
});
