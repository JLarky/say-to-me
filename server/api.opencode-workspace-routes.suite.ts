import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
} from "./api.harness.ts";
import { createOpenCodeSessionEffect, OpenCodeSession } from "./api-routes/opencode-sessions.ts";
import { stopOpenCodeSessionEffect, StopOpenCode } from "./api-routes/opencode-stop.ts";
import { createOpenCodeWorkspaceEffect } from "./api-routes/opencode-workspaces.ts";
import {
  OpenCodeModelControls,
  OpenCodeModelSession,
  updateOpenCodeModelEffect,
} from "./api-routes/opencode-model-controls.ts";
import type { DbSession } from "./db/schemas.ts";

async function expectEffectFailure(effect: Effect.Effect<unknown, unknown>, expected: unknown) {
  const error = await Effect.runPromise(Effect.flip(effect));
  expect(error).toEqual(expected);
}

function session(overrides: Partial<DbSession> = {}): DbSession {
  return {
    id: "ses_67068bc6bd52D9ARznQ60CkWCV",
    state: "general",
    alias: null,
    revision: 0,
    createdAt: "2026-06-19 00:00:00",
    updatedAt: "2026-06-19 00:00:00",
    opencodeProjectId: null,
    opencodeWorkspaceId: null,
    opencodeDirectory: null,
    opencodeWorktree: null,
    opencodePath: null,
    opencodeProjectName: null,
    opencodeBranch: null,
    opencodeSelectedModelProvider: null,
    opencodeSelectedModel: null,
    ...overrides,
  };
}

const fakeOpenCodeModelControls = Layer.succeed(OpenCodeModelControls, {
  listModels: () => Effect.succeed([]),
  setModel: () => Effect.void,
  getModel: () => Effect.succeed({ providerID: "github-copilot", modelID: "gpt-5.5" }),
  addStatus: (session) => Effect.succeed(session),
});

const fakeOpenCodeModelSession = Layer.succeed(OpenCodeModelSession, {
  ensure: () => Effect.succeed(session()),
  listAll: () => Effect.succeed([session()]),
  updateModel: () => Effect.void,
  updateModelAndReasoningEffort: () => Effect.void,
  broadcast: () => Effect.void,
});

const fakeOpenCodeSession = Layer.succeed(OpenCodeSession, {
  createSession: () =>
    Effect.succeed({ ok: true, session: session({ id: "ses_1907af38746ahWLTYLjDX96OEP" }) }),
  addStatus: (session) => Effect.succeed(session),
});

const fakeStopOpenCode = Layer.succeed(StopOpenCode, {
  ensureSession: () => Effect.succeed(undefined),
  stopSession: () => Effect.succeed({ ok: true }),
  queuePayload: (sessionId) =>
    Effect.succeed({
      revision: 1,
      messages: [],
      presence: [],
      session: {
        id: sessionId,
        state: "general",
        alias: null,
        revision: 1,
        createdAt: "2026-06-18 00:00:00",
        updatedAt: "2026-06-18 00:00:00",
        href: `/sessions/${sessionId}`,
        opencodeStatus: null,
        opencodeTitle: null,
        opencodeAgent: null,
        opencodeModelProvider: null,
        opencodeModel: null,
        opencodeDirB64: null,
        organizePath: [],
        backend: "opencode",
      },
      sessions: [],
      lastNoteFirstLine: null,
    }),
});

describe("say API: OpenCode workspaces", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  it("creates a worktree then opens a session in its returned directory", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "say-to-me-worktree-"));
    const worktreeDir = "/home/dev/.opencode/worktree/abc123/eager-harbor";
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/experimental/worktree")) {
        if (req.method === "GET") {
          res.end(JSON.stringify([]));
          return;
        }
        res.end(
          JSON.stringify({
            name: "eager-harbor",
            branch: "opencode/eager-harbor",
            directory: worktreeDir,
          }),
        );
        return;
      }
      if (req.url?.startsWith("/project/current")) {
        res.end(
          JSON.stringify({
            id: "prj_x",
            worktree: projectPath,
            vcs: "git",
            name: "demo",
            sandboxes: [],
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/vcs")) {
        res.end(JSON.stringify({ branch: "opencode/eager-harbor", default_branch: "main" }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "ses_f9d1b4adff25VF32ZCZatbO74F",
          slug: "worktree",
          title: "worktree session",
          directory: worktreeDir,
          projectID: "prj_x",
          time: { created: 1, updated: 2 },
        }),
      );
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const created = await Effect.runPromise(createOpenCodeWorkspaceEffect(projectPath));
      expect(created.session).toMatchObject({
        id: "ses_f9d1b4adff25VF32ZCZatbO74F",
        opencodeDirectory: worktreeDir,
      });
      const worktreeCreate = openCode.requests.find(
        (r) => r.method === "POST" && r.url?.startsWith("/experimental/worktree"),
      );
      expect(worktreeCreate).toBeDefined();
      const sessionCreate = openCode.requests.find(
        (r) => r.method === "POST" && r.url?.startsWith("/session"),
      );
      expect(sessionCreate?.url).toContain(encodeURIComponent(worktreeDir));
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      rmSync(projectPath, { recursive: true, force: true });
      server.close();
    }
  });

  it("reuses an empty worktree instead of creating a new one", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "say-to-me-worktree-reuse-"));
    const emptyDir = "/home/dev/.opencode/worktree/abc123/reused-pool";
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/experimental/worktree")) {
        if (req.method === "GET") {
          res.end(JSON.stringify([emptyDir]));
          return;
        }
        res.end(JSON.stringify({ name: "should-not-create", directory: emptyDir }));
        return;
      }
      if (req.url?.startsWith("/project/current")) {
        res.end(
          JSON.stringify({
            id: "prj_reuse",
            worktree: projectPath,
            vcs: "git",
            name: "demo",
            sandboxes: [],
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/vcs")) {
        res.end(JSON.stringify({ branch: "opencode/reused-pool", default_branch: "main" }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "ses_ebd8844ac757wv1WFRmo7j4ulV",
          slug: "reused",
          title: "reused session",
          directory: emptyDir,
          projectID: "prj_reuse",
          time: { created: 1, updated: 2 },
        }),
      );
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const created = await Effect.runPromise(createOpenCodeWorkspaceEffect(projectPath));
      expect(created.session).toMatchObject({
        id: "ses_ebd8844ac757wv1WFRmo7j4ulV",
        opencodeDirectory: emptyDir,
      });
      const worktreeCreate = openCode.requests.find(
        (r) => r.method === "POST" && r.url?.startsWith("/experimental/worktree"),
      );
      expect(worktreeCreate).toBeUndefined();
      const sessionCreate = openCode.requests.find(
        (r) => r.method === "POST" && r.url?.startsWith("/session"),
      );
      expect(sessionCreate?.url).toContain(encodeURIComponent(emptyDir));
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      rmSync(projectPath, { recursive: true, force: true });
      server.close();
    }
  });

  it("preserves public OpenCode workspace upstream error responses", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "say-to-me-worktree-http-"));
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(req.method === "POST" ? 409 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req.method === "POST" ? { error: "conflict" } : []));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/opencode-workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: projectPath }),
      });
      await expect(response.json()).resolves.toEqual({
        error: "OpenCode returned HTTP 409",
        status: 409,
      });
      expect(response.status).toBe(409);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      rmSync(projectPath, { recursive: true, force: true });
      server.close();
    }
  });

  it("does not open a session when the created worktree has no directory", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "say-to-me-worktree-nodir-"));
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/experimental/worktree")) {
        if (req.method === "GET") {
          res.end(JSON.stringify([]));
          return;
        }
        res.end(
          JSON.stringify({
            name: "broken-worktree",
            branch: "opencode/broken-worktree",
            directory: null,
          }),
        );
        return;
      }
      res.end(JSON.stringify({ id: "ses_5a3f64dc971e7FN6EQm6jFoM5c_not_be_created" }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const error = await Effect.runPromise(
        Effect.flip(createOpenCodeWorkspaceEffect(projectPath)),
      );
      expect(error._tag).toBe("OpenCodeWorkspaceUpstreamError");
      expect(error.error).toContain("broken-worktree");
      expect(
        openCode.requests.some((r) => r.method === "POST" && r.url?.startsWith("/session")),
      ).toBe(false);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      rmSync(projectPath, { recursive: true, force: true });
      server.close();
    }
  });

  it("validates migrated OpenCode route inputs through the Effect route logic", async () => {
    const workspacePath = path.join(tmpdir(), `say-to-me-worktree-file-${Date.now()}`);
    writeFileSync(workspacePath, "not a directory");

    try {
      await expectEffectFailure(createOpenCodeWorkspaceEffect(workspacePath), {
        _tag: "OpenCodeWorkspaceValidationError",
        error: "Path must exist and be a writable directory.",
        status: 400,
      });

      await expectEffectFailure(
        createOpenCodeSessionEffect(workspacePath).pipe(Effect.provide(fakeOpenCodeSession)),
        {
          _tag: "OpenCodeSessionValidationError",
          error: "Path must exist and be a writable directory.",
          status: 400,
        },
      );
    } finally {
      rmSync(workspacePath, { force: true });
    }

    await expectEffectFailure(
      updateOpenCodeModelEffect("ses_1dd864100ffes6uqv2NbJatAKt", "", "gpt-5.5").pipe(
        Effect.provide(Layer.mergeAll(fakeOpenCodeModelControls, fakeOpenCodeModelSession)),
      ),
      {
        _tag: "OpenCodeModelValidationError",
        error: "Model is required.",
        status: 400,
      },
    );

    await expectEffectFailure(
      stopOpenCodeSessionEffect("not-a-session").pipe(Effect.provide(fakeStopOpenCode)),
      {
        _tag: "StopOpenCodeValidationError",
        error: "Invalid OpenCode session id.",
        status: 400,
      },
    );
  });
});
