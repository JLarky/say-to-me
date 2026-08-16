/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MessageComposer } from "./components/MessageComposer.tsx";
import {
  OpenCodeModelSelect,
  ReasoningEffortSelect,
  SessionModelControls,
} from "./components/SessionModelControls.tsx";
import type { Session } from "./types.ts";
import { parseJson, UnknownJson } from "@say-to-me/runtime-validation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const noop = async () => {};

function session(backend: Session["backend"]): Session {
  return {
    id: "cx_919f23a3-2180-77b1-b50e-18f757148705",
    backend,
    opencodeModelProvider: "openai",
    opencodeModel: "gpt-5.5",
  };
}

function openCodeSession(): Session {
  return { ...session("opencode"), id: "ses_1ff836cba5b7W2IE8852hd1wwV" };
}

function response(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
}

async function waitForDom<T>(read: () => T | null, timeoutMs = 2000): Promise<T> {
  const started = performance.now();
  while (performance.now() - started <= timeoutMs) {
    const value = read();
    if (value !== null) return value;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error("Timed out waiting for DOM update");
}

function CodexControls() {
  const [resetEffort, setResetEffort] = useState<string | null>(null);
  return (
    <>
      <OpenCodeModelSelect session={session("codex")} onEffortReset={setResetEffort} />
      <ReasoningEffortSelect session={session("codex")} resetEffort={resetEffort} />
    </>
  );
}

describe("Codex reasoning effort controls", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    vi.restoreAllMocks();
    container = undefined;
    root = undefined;
  });

  it("renders only for Codex sessions and combines model Reset with effort restoration", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        response({ models: [{ providerID: "openai", id: "gpt-5.5", name: "GPT-5.5" }] }),
      )
      .mockResolvedValueOnce(
        response({
          available: ["low", "medium", "high", "xhigh"],
          selected: null,
          current: "high",
        }),
      )
      .mockResolvedValueOnce(
        response({
          available: ["low", "medium", "high", "xhigh"],
          selected: "low",
          current: "low",
        }),
      )
      .mockResolvedValueOnce(
        response({ providerID: "openai", modelID: "gpt-5.5", reasoningEffort: "high" }),
      );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root!.render(<ReasoningEffortSelect session={session("none")} />));
    expect(container.querySelector("[data-codex-reasoning-effort]")).toBeNull();

    await act(async () => {
      root!.render(<CodexControls />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const select = container.querySelector(
      "[aria-label='Codex reasoning effort']",
    ) as HTMLSelectElement;
    expect(select.value).toBe("high");

    await act(async () => {
      select.value = "low";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/cx_919f23a3-2180-77b1-b50e-18f757148705/reasoning-effort",
      expect.objectContaining({ method: "PATCH" }),
    );

    await act(async () => {
      const resetButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Reset",
      );
      resetButton!.click();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/cx_919f23a3-2180-77b1-b50e-18f757148705/model/reset",
      expect.objectContaining({ method: "POST" }),
    );
    expect(select.value).toBe("high");
    expect(container.textContent).not.toContain("Reset effort");
  });
});

describe("OpenCode reasoning effort controls", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    vi.restoreAllMocks();
    container = undefined;
    root = undefined;
  });

  it("renders only for OpenCode sessions and persists an explicit choice", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        available: ["balanced", "deep"],
        selected: null,
        current: null,
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root!.render(<ReasoningEffortSelect session={session("codex")} />));
    expect(container.querySelector("[data-opencode-reasoning-effort]")).toBeNull();

    await act(async () => {
      root!.render(<ReasoningEffortSelect session={session("opencode")} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const select = container.querySelector(
      "[aria-label='OpenCode reasoning effort']",
    ) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0]?.textContent).toBe("Default (OpenCode)");
    expect([...select.options].map((option) => option.value)).toEqual(["", "balanced", "deep"]);

    await act(async () => {
      select.value = "deep";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/sessions/cx_919f23a3-2180-77b1-b50e-18f757148705/opencode-reasoning-effort",
      expect.objectContaining({ method: "PATCH" }),
    );

    await act(async () => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/sessions/cx_919f23a3-2180-77b1-b50e-18f757148705/opencode-reasoning-effort",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ effort: "" }),
      }),
    );
  });

  it("updates the shared selector when the model Reset restores OpenCode effort", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        response({
          available: ["low", "medium", "high"],
          selected: "medium",
          current: "medium",
        }),
      )
      .mockResolvedValueOnce(
        response({
          models: [{ providerID: "openai", id: "gpt-5.5", name: "GPT-5.5" }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          session: {
            id: "ses_1ff836cba5b7W2IE8852hd1wwV",
            opencodeSelectedModelProvider: "openai",
            opencodeSelectedModel: "gpt-5.5",
            reasoningEffort: "low",
          },
        }),
      );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<SessionModelControls session={openCodeSession()} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const select = container.querySelector(
      "[aria-label='OpenCode reasoning effort']",
    ) as HTMLSelectElement;
    expect(select.value).toBe("medium");

    await act(async () => {
      const resetButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Reset",
      );
      resetButton!.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/ses_1ff836cba5b7W2IE8852hd1wwV/opencode-model/reset",
      expect.objectContaining({ method: "POST" }),
    );
    expect(select.value).toBe("low");
  });

  it("reloads available efforts after the selected model changes", async () => {
    let effortRequest = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/models")) {
        return response({
          models: [
            { providerID: "openai", id: "gpt-5.5", name: "GPT-5.5" },
            { providerID: "openai", id: "gpt-5.6", name: "GPT-5.6" },
          ],
        });
      }
      if (url.endsWith("/opencode-reasoning-effort")) {
        return response(
          effortRequest++ === 0
            ? { available: ["low", "medium"], selected: "low", current: "low" }
            : { available: ["high"], selected: null, current: null },
        );
      }
      if (url.endsWith("/opencode-model") && init?.method === "PATCH") {
        return response({
          session: {
            id: "ses_1ff836cba5b7W2IE8852hd1wwV",
            opencodeSelectedModelProvider: "openai",
            opencodeSelectedModel: "gpt-5.6",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<SessionModelControls session={openCodeSession()} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const select = container.querySelector(
      "[aria-label='OpenCode reasoning effort']",
    ) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["", "low", "medium"]);

    const modelTrigger = container!.querySelector(
      "[aria-label='OpenCode model']",
    ) as HTMLButtonElement;
    if (modelTrigger.getAttribute("aria-expanded") !== "true") {
      act(() => modelTrigger.click());
    }
    const modelButton = await waitForDom(() =>
      container!.querySelector<HTMLButtonElement>("[data-opencode-model-value='openai/gpt-5.6']"),
    );
    act(() => modelButton.click());
    await waitForDom(() =>
      [...select.options].some((option) => option.value === "high") ? select : null,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/ses_1ff836cba5b7W2IE8852hd1wwV/opencode-model",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect([...select.options].map((option) => option.value)).toEqual(["", "high"]);
    expect(select.value).toBe("");
  });

  it("ignores a delayed effort response after switching sessions", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    let resolveSecond: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes("reasoning-effort")) return Promise.resolve(response({ models: [] }));
      return new Promise<Response>((resolve) => {
        if (url.includes("cx_919f23a3")) resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    });
    const firstSession = session("codex");
    const secondSession = { ...firstSession, id: "cx_219f23a3-2180-77b1-b50e-18f757148705" };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<SessionModelControls session={firstSession} />);
      await Promise.resolve();
    });
    await act(async () => {
      root!.render(<SessionModelControls session={secondSession} />);
      await Promise.resolve();
    });

    await act(async () => {
      resolveFirst!(response({ available: ["low"], selected: "low", current: "low" }));
      await Promise.resolve();
    });
    expect(
      (container.querySelector("[aria-label='Codex reasoning effort']") as HTMLSelectElement)
        .options,
    ).toHaveLength(0);

    await act(async () => {
      resolveSecond!(response({ available: ["high"], selected: "high", current: "high" }));
      await Promise.resolve();
    });
    const select = container.querySelector(
      "[aria-label='Codex reasoning effort']",
    ) as HTMLSelectElement;
    expect(select.value).toBe("high");
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return url.includes("reasoning-effort");
      }),
    ).toHaveLength(2);
  });
  it("loads searchable OpenCode model options with encoded values", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const savedModels: unknown[] = [];
    const setModels: unknown[] = [];
    const resetModels: string[] = [];

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/models") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: [{ providerID: "local", id: "anthropic/claude", name: "Claude" }],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (
        url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/opencode-model" &&
        init?.method === "PATCH"
      ) {
        savedModels.push(parseJson(UnknownJson, init.body as string));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: "ses_e946608d8f44iE5XvXLyK7tlO9",
                opencodeSelectedModelProvider: "local",
                opencodeSelectedModel: "anthropic/claude",
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (
        url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/opencode-model/set" &&
        init?.method === "POST"
      ) {
        setModels.push(parseJson(UnknownJson, init.body as string));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: "ses_e946608d8f44iE5XvXLyK7tlO9",
                opencodeSelectedModelProvider: "local",
                opencodeSelectedModel: "anthropic/claude",
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (
        url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/opencode-model/reset" &&
        init?.method === "POST"
      ) {
        resetModels.push(url);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: "ses_e946608d8f44iE5XvXLyK7tlO9",
                opencodeSelectedModelProvider: "github-copilot",
                opencodeSelectedModel: "gpt-5.5",
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    }) as typeof fetch;

    try {
      await act(async () => {
        root!.render(
          <MessageComposer
            onSend={noop}
            session={{ id: "ses_e946608d8f44iE5XvXLyK7tlO9", backend: "opencode" }}
            sessionId="ses_e946608d8f44iE5XvXLyK7tlO9"
          />,
        );
        await Promise.resolve();
      });

      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="OpenCode model"]',
      )!;
      await act(async () => {
        trigger.click();
      });

      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search OpenCode models"]',
      )!;
      const panel = search.parentElement!.parentElement!;
      expect(panel.getAttribute("data-opencode-model-panel-placement")).toBe("start");

      await act(async () => {
        search.value = "claude";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });

      const option = container.querySelector<HTMLButtonElement>(
        '[data-opencode-model-value="local/anthropic%2Fclaude"]',
      )!;
      expect(option.textContent).toContain("local/anthropic/claude");

      await act(async () => {
        option.click();
        await Promise.resolve();
      });

      expect(savedModels).toEqual([{ providerID: "local", modelID: "anthropic/claude" }]);
      expect(container.textContent).toContain("local/anthropic/claude");
      expect(window.localStorage.getItem("say-to-me.opencode.recentModels")).toContain(
        "anthropic/claude",
      );
      const setButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Set",
      )!;
      await act(async () => {
        setButton.click();
        await Promise.resolve();
      });
      expect(setModels).toEqual([{ providerID: "local", modelID: "anthropic/claude" }]);
      const resetButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Reset",
      )!;
      await act(async () => {
        resetButton.click();
        await Promise.resolve();
      });
      expect(resetModels).toEqual([
        "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/opencode-model/reset",
      ]);
      expect(container.textContent).toContain("copilot/gpt-5.5");
    } finally {
      globalThis.fetch = originalFetch;
      window.localStorage.clear();
    }
  });

  it("saves a manual Codex model with the inferred OpenAI provider", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const savedModels: unknown[] = [];
    const codexSessionId = "cx_019f23a3-2180-77b1-b50e-18f757148705";

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === `/api/sessions/${codexSessionId}/models`) {
        return Promise.resolve(
          new Response(JSON.stringify({ models: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === `/api/sessions/${codexSessionId}/model` && init?.method === "PATCH") {
        savedModels.push(parseJson(UnknownJson, init.body as string));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              providerID: "openai",
              modelID: "gpt-5.6-sol",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    }) as typeof fetch;

    try {
      await act(async () => {
        root!.render(
          <MessageComposer
            onSend={noop}
            session={{ id: codexSessionId, backend: "codex" }}
            sessionId={codexSessionId}
          />,
        );
        await Promise.resolve();
      });

      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="OpenCode model"]',
      )!;
      await act(async () => {
        trigger.click();
      });

      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search OpenCode models"]',
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          search,
          "gpt-5.6-sol",
        );
        search.dispatchEvent(new Event("input", { bubbles: true }));
        await Promise.resolve();
      });

      const option = container.querySelector<HTMLButtonElement>(
        '[data-opencode-model-value="gpt-5.6-sol"]',
      )!;
      await act(async () => {
        option.click();
        await Promise.resolve();
      });

      expect(savedModels).toEqual([{ providerID: "openai", modelID: "gpt-5.6-sol" }]);
      expect(container.textContent).toContain("openai/gpt-5.6-sol");
    } finally {
      globalThis.fetch = originalFetch;
      window.localStorage.clear();
    }
  });

  it("confirms before setting model for all OpenCode sessions", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const originalConfirm = globalThis.confirm;
    const setAllCalls: unknown[] = [];

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/models") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: [{ providerID: "local", id: "anthropic/claude", name: "Claude" }],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url === "/api/opencode-model/set-all" && init?.method === "POST") {
        setAllCalls.push(parseJson(UnknownJson, init.body as string));
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (
        url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/opencode-model" &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: "ses_e946608d8f44iE5XvXLyK7tlO9",
                opencodeSelectedModelProvider: "local",
                opencodeSelectedModel: "anthropic/claude",
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    }) as typeof fetch;

    try {
      await act(async () => {
        root!.render(
          <MessageComposer
            onSend={noop}
            session={{ id: "ses_e946608d8f44iE5XvXLyK7tlO9", backend: "opencode" }}
            sessionId="ses_e946608d8f44iE5XvXLyK7tlO9"
          />,
        );
        await Promise.resolve();
      });

      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="OpenCode model"]',
      )!;
      await act(async () => {
        trigger.click();
      });

      const option = container.querySelector<HTMLButtonElement>(
        '[data-opencode-model-value="local/anthropic%2Fclaude"]',
      )!;
      await act(async () => {
        option.click();
        await Promise.resolve();
      });

      const everywhereButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Set everywhere",
      )!;
      expect(everywhereButton).not.toBeUndefined();

      globalThis.confirm = vi.fn(() => false) as typeof confirm;
      everywhereButton.click();
      expect(globalThis.confirm).toHaveBeenCalledWith("Update model for ALL OpenCode sessions?");
      expect(setAllCalls).toEqual([]);

      globalThis.confirm = vi.fn(() => true) as typeof confirm;
      await act(async () => {
        everywhereButton.click();
        await Promise.resolve();
      });
      expect(setAllCalls).toEqual([{ providerID: "local", modelID: "anthropic/claude" }]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.confirm = originalConfirm;
      window.localStorage.clear();
    }
  });

  it("selects OpenCode models with keyboard navigation", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    const savedModels: unknown[] = [];

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/models") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: [
                { providerID: "copilot", id: "claude-haiku", name: "Claude Haiku" },
                { providerID: "copilot", id: "claude-sonnet", name: "Claude Sonnet" },
              ],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (
        url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/opencode-model" &&
        init?.method === "PATCH"
      ) {
        savedModels.push(parseJson(UnknownJson, init.body as string));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: "ses_e946608d8f44iE5XvXLyK7tlO9",
                opencodeSelectedModelProvider: "copilot",
                opencodeSelectedModel: "claude-sonnet",
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    }) as typeof fetch;

    try {
      await act(async () => {
        root!.render(
          <MessageComposer
            onSend={noop}
            session={{ id: "ses_e946608d8f44iE5XvXLyK7tlO9", backend: "opencode" }}
            sessionId="ses_e946608d8f44iE5XvXLyK7tlO9"
          />,
        );
        await Promise.resolve();
      });

      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="OpenCode model"]',
      )!;
      await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });

      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search OpenCode models"]',
      )!;
      await act(async () => {
        search.value = "claude";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        await Promise.resolve();
      });
      await act(async () => {
        search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await Promise.resolve();
      });

      expect(savedModels).toEqual([{ providerID: "copilot", modelID: "claude-sonnet" }]);
      expect(container.textContent).toContain("copilot/claude-sonnet");
      expect(container.querySelector('[data-active="true"]')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      window.localStorage.clear();
    }
  });

  it("keeps the model picker open across session status refreshes and remounts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/models")) {
        return response({
          models: [{ providerID: "openai", id: "gpt-4.1-mini", name: "gpt-4.1-mini" }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const first = openCodeSession();
    await act(async () => {
      root!.render(<OpenCodeModelSelect session={first} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await act(async () => {
      const trigger = container!.querySelector<HTMLButtonElement>("[aria-label='OpenCode model']");
      trigger!.click();
    });
    expect(container.querySelector("[data-opencode-model-panel-placement]")).toBeTruthy();

    await act(async () => {
      root!.render(
        <OpenCodeModelSelect session={{ ...first, opencodeStatus: "pending", revision: 2 }} />,
      );
    });
    expect(container.querySelector("[data-opencode-model-panel-placement]")).toBeTruthy();

    await act(async () => {
      root!.unmount();
      root = createRoot(container!);
      root.render(
        <OpenCodeModelSelect session={{ ...first, opencodeStatus: "idle", revision: 3 }} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.querySelector("[data-opencode-model-panel-placement]")).toBeTruthy();
  });
});
