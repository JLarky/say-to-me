import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createProviderSession, fetchProviderModels } from "./session-creation-api.ts";

const originalFetch = globalThis.fetch;

function parseRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(init.body);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("session creation API", () => {
  it("loads CLI provider models", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ models: [{ providerID: "cursor", id: "auto", name: "Auto" }] }),
    );

    await expect(fetchProviderModels("cursor")).resolves.toEqual([
      { providerID: "cursor", id: "auto", name: "Auto" },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/providers/cursor/models");
  });

  it("creates a CLI session in the selected path", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        session: {
          id: "cur_test",
          state: "general",
          alias: null,
          revision: 0,
          createdAt: "2026-07-17",
          updatedAt: "2026-07-17",
          opencodeProjectId: null,
          opencodeWorkspaceId: null,
          opencodeDirectory: null,
          opencodeWorktree: null,
          opencodePath: null,
          opencodeProjectName: null,
          opencodeBranch: null,
          opencodeSelectedModelProvider: "cursor",
          opencodeSelectedModel: "auto",
          reasoningEffort: null,
          cwd: "/work/repo",
        },
      }),
    );

    await expect(createProviderSession("cursor", "/work/repo", "auto", "")).resolves.toBe(
      "cur_test",
    );
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init).toMatchObject({ method: "POST" });
    expect(parseRequestBody(init)).toEqual({
      provider: "cursor",
      path: "/work/repo",
      modelID: "auto",
    });
  });

  it("creates OpenCode sessions without a model payload", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        session: { id: "ses_e946608d8f44iE5XvXLyK7tlO9" },
        project: { id: "project" },
      }),
    );

    await expect(createProviderSession("opencode", "/work/repo", "", "")).resolves.toBe(
      "ses_e946608d8f44iE5XvXLyK7tlO9",
    );
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("/api/opencode-sessions");
    expect(parseRequestBody(init)).toEqual({ path: "/work/repo" });
  });
});
