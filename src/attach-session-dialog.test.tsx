/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AttachSessionDialog } from "./components/AttachSessionDialog.tsx";
import type { DashboardPlacement } from "./spaces-api.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const navigateMock = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const basePlacement: DashboardPlacement = {
  sessionId: "cur_test",
  title: "say-to-me-add-dashboard-link",
  cwd: "/home/user/say-to-me-add-dashboard-link",
  ownerSpaceId: null,
  ownerSpaceName: null,
  ownerArchived: false,
  repositoryId: null,
  worktreeId: null,
  isMainCheckout: null,
  placementPossible: true,
  placementBlockReason: null,
  repairState: null,
  canonicalDashboardPath: null,
  needsChooser: true,
  chooserMode: "claim",
  discovered: null,
  preview: {
    targetSpaceId: null,
    wouldAttachRepository: false,
    wouldAttachWorktree: false,
    warnings: [],
  },
};

const spacesPayload = {
  state: {
    selectedSpaceId: "space-1",
    spaces: [
      {
        id: "space-1",
        name: "new space",
        parentId: null,
        archived: false,
        context: "",
        access: "private",
        repos: [],
        sessions: [],
      },
    ],
  },
};

describe("AttachSessionDialog", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  let linksButton: HTMLButtonElement | undefined;

  beforeEach(() => {
    navigateMock.mockReset();
    host = document.createElement("div");
    host.id = "root";
    host.style.color = "rgb(23, 32, 42)";
    host.style.backgroundColor = "rgb(255, 255, 255)";
    document.body.append(host);
    linksButton = document.createElement("button");
    linksButton.textContent = "Links";
    host.append(linksButton);
    const addNote = document.createElement("button");
    addNote.textContent = "+ Add note";
    host.append(addNote);
    root = createRoot(host);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes("/api/spaces") && !url.includes("/action")) {
          return new Response(JSON.stringify(spacesPayload), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("dashboard-placement")) {
          return new Response(JSON.stringify(basePlacement), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    document.body.querySelector("[data-attach-session-dialog]")?.remove();
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
    host = undefined;
    root = undefined;
    linksButton = undefined;
  });

  function renderDialog(placement: DashboardPlacement = basePlacement) {
    act(() => {
      root!.render(
        <MemoryRouter>
          <AttachSessionDialog
            sessionId="cur_test"
            initialPlacement={placement}
            returnFocusTo={linksButton}
            onClose={() => {}}
          />
        </MemoryRouter>,
      );
    });
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("uses human title and does not inherit host dark text identity", async () => {
    renderDialog();
    await flush();
    const modal = document.querySelector<HTMLElement>("[data-attach-modal]");
    expect(modal).not.toBeNull();
    const title = modal!.querySelector("h2");
    expect(title!.textContent).toContain("say-to-me-add-dashboard-link");
    expect(title!.textContent).not.toContain("cur_test");
    // stylex sets an explicit light color on the dark modal root
    expect(modal!.className.length).toBeGreaterThan(0);
  });

  it("shows the full search placeholder with icon and clear columns", async () => {
    renderDialog();
    await flush();
    const input = document.querySelector<HTMLInputElement>("[data-attach-search-input]");
    const field = document.querySelector("[data-attach-search-field]");
    expect(input).not.toBeNull();
    expect(input!.placeholder).toBe("Search spaces…");
    expect(field?.children.length).toBe(3);
    expect(field?.querySelector("[class]") || field?.firstElementChild).toBeTruthy();
  });

  it("wraps Tab focus inside the modal", async () => {
    renderDialog();
    await flush();
    const modal = document.querySelector<HTMLElement>("[data-attach-modal]");
    expect(modal).not.toBeNull();
    const focusable = [
      ...modal!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.tabIndex !== -1);
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    act(() => {
      last.focus();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(first);
    act(() => {
      first.focus();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(last);
  });

  it("marks a destination as selected and updates confirm copy", async () => {
    renderDialog();
    await flush();
    const radio = document.querySelector<HTMLButtonElement>('button[role="radio"]');
    expect(radio).not.toBeNull();
    expect(radio!.textContent).toContain("new space");
    await act(async () => {
      radio!.click();
      await Promise.resolve();
    });
    expect(radio!.getAttribute("aria-checked")).toBe("true");
    expect(radio!.getAttribute("data-selected")).toBe("true");
    const confirm = document.querySelector<HTMLButtonElement>("[data-attach-confirm]");
    expect(confirm?.textContent).toContain("Attach to new space");
    expect(confirm?.disabled).toBe(false);
  });

  it("keeps the dialog open and shows an inline error when attach fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes("/api/spaces") && !url.includes("/action")) {
          return new Response(JSON.stringify(spacesPayload), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("dashboard-placement")) {
          return new Response(JSON.stringify(basePlacement), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/action") && init?.method === "POST") {
          return new Response(JSON.stringify({ error: "Session owner changed." }), {
            status: 409,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }),
    );

    renderDialog();
    await flush();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[role="radio"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-attach-confirm]")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector("[data-attach-session-dialog]")).not.toBeNull();
    expect(document.querySelector("[data-attach-error]")?.textContent).toMatch(/owner changed/i);
  });

  it("recovers from owner-conflict 409 by refreshing placement and offering Go to dashboard", async () => {
    const ownedPlacement: DashboardPlacement = {
      ...basePlacement,
      ownerSpaceId: "space-2",
      ownerSpaceName: "second space",
      needsChooser: false,
      chooserMode: null,
      canonicalDashboardPath: "/dashboard/space-2?repo=repo-1&worktreeId=wt-1",
      preview: {
        targetSpaceId: null,
        wouldAttachRepository: false,
        wouldAttachWorktree: false,
        warnings: [],
      },
    };
    let afterConflict = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes("/api/spaces") && !url.includes("/action")) {
          return new Response(JSON.stringify(spacesPayload), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("dashboard-placement")) {
          return new Response(JSON.stringify(afterConflict ? ownedPlacement : basePlacement), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/action") && init?.method === "POST") {
          afterConflict = true;
          return new Response(
            JSON.stringify({ error: "Session is already imported into another space." }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }),
    );

    renderDialog();
    await flush();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[role="radio"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-attach-confirm]")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector("[data-attach-session-dialog]")).not.toBeNull();
    const takenOver = document.querySelector("[data-attach-taken-over]");
    expect(takenOver).not.toBeNull();
    expect(takenOver?.textContent ?? "").toContain("second space");
    expect(document.querySelector("[data-attach-warning]")).toBeNull();
    expect(document.querySelector("[data-attach-confirm]")).toBeNull();
    const go = document.querySelector<HTMLButtonElement>("[data-attach-go-dashboard]");
    expect(go).not.toBeNull();
    act(() => {
      go!.click();
    });
    expect(navigateMock).toHaveBeenCalledWith("/dashboard/space-2?repo=repo-1&worktreeId=wt-1");
  });

  it("uses a scrollable modal shell for mobile viewport constraints", async () => {
    renderDialog({
      ...basePlacement,
      preview: {
        ...basePlacement.preview,
        warnings: [
          "This repo is new for this space, so it will be attached.",
          "This worktree is new for this space, so it will be attached.",
        ],
      },
    });
    await flush();
    const modal = document.querySelector("[data-attach-modal]");
    const body = modal?.querySelector("[class]") && modal.firstElementChild;
    expect(modal).not.toBeNull();
    expect(body).not.toBeNull();
    expect(modal!.querySelector("footer")).not.toBeNull();
  });
});
