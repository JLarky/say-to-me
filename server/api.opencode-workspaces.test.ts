import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { DbSession } from "./db/schemas.ts";
import {
  OpenCodeWorkspace,
  type OpenCodeWorkspaceService,
  createOpenCodeWorkspaceProgram,
} from "./api-routes/opencode-workspaces.ts";

const baseSession = {
  id: "ses_affebd79d751bjlRppAf9yf1I5",
  state: "general",
  alias: null,
  revision: 1,
  createdAt: "2026-06-18 00:00:00",
  updatedAt: "2026-06-18 00:00:00",
  opencodeDirectory: "/workspace/project-worktree",
} satisfies DbSession;

function fakeOpenCodeWorkspace(overrides: Partial<OpenCodeWorkspaceService> = {}) {
  const calls: string[] = [];
  const service = {
    workspacePathStatus: (input: string) =>
      Effect.sync(() => {
        calls.push(`status:${input}`);
        return {
          ok: true,
          path: "/workspace/project",
          exists: true,
          isDirectory: true,
          writable: true,
          creatable: false,
          parentPath: null,
        };
      }),
    createWorktreeSession: (workspacePath: string) =>
      Effect.sync(() => {
        calls.push(`create:${workspacePath}`);
        return { ok: true as const, session: baseSession };
      }),
    addStatus: (session: DbSession) =>
      Effect.sync(() => {
        calls.push(`status-enrichment:${session.id}`);
        return {
          ...session,
          href: `/sessions/${session.id}`,
          opencodeStatus: "idle",
          opencodeTitle: "Workspace session",
          opencodeAgent: null,
          opencodeModelProvider: null,
          opencodeModel: null,
          opencodeDirB64: null,
          backend: "opencode",
        };
      }),
    ...overrides,
  } satisfies OpenCodeWorkspaceService;

  return { calls, layer: Layer.succeed(OpenCodeWorkspace, service) };
}

describe("say API: OpenCode workspaces", () => {
  it("creates a worktree session through injected Effect dependencies", async () => {
    const fake = fakeOpenCodeWorkspace();

    const payload = await Effect.runPromise(
      createOpenCodeWorkspaceProgram("~/project").pipe(Effect.provide(fake.layer)),
    );

    expect(payload.session).toMatchObject({
      id: "ses_affebd79d751bjlRppAf9yf1I5",
      opencodeDirectory: "/workspace/project-worktree",
      opencodeStatus: "idle",
      opencodeTitle: "Workspace session",
    });
    expect(fake.calls).toEqual([
      "status:~/project",
      "create:/workspace/project",
      "status-enrichment:ses_affebd79d751bjlRppAf9yf1I5",
    ]);
  });

  it("does not call OpenCode when workspace validation fails", async () => {
    const fake = fakeOpenCodeWorkspace({
      workspacePathStatus: (input) =>
        Effect.sync(() => {
          fake.calls.push(`status:${input}`);
          return { ok: false, error: "Enter a folder path." };
        }),
    });

    const error = await Effect.runPromise(
      Effect.flip(createOpenCodeWorkspaceProgram("").pipe(Effect.provide(fake.layer))),
    );

    expect(error).toEqual({
      _tag: "OpenCodeWorkspaceValidationError",
      error: "Enter a folder path.",
      status: 400,
    });
    expect(fake.calls).toEqual(["status:"]);
  });

  it("maps OpenCode worktree failures to public upstream errors", async () => {
    const fake = fakeOpenCodeWorkspace({
      createWorktreeSession: (workspacePath) =>
        Effect.sync(() => {
          fake.calls.push(`create:${workspacePath}`);
          return { ok: false as const, status: 409, error: "OpenCode returned HTTP 409" };
        }),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        createOpenCodeWorkspaceProgram("/workspace/project").pipe(Effect.provide(fake.layer)),
      ),
    );

    expect(error).toEqual({
      _tag: "OpenCodeWorkspaceUpstreamError",
      error: "OpenCode returned HTTP 409",
      status: 409,
    });
    expect(fake.calls).toEqual(["status:/workspace/project", "create:/workspace/project"]);
  });
});
