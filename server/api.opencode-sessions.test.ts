import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  createOpenCodeSessionEffect,
  OpenCodeSession,
  type OpenCodeSessionService,
} from "./api-routes/opencode-sessions.ts";
import type { DbSession } from "./db/schemas.ts";

function session(overrides: Partial<DbSession> = {}): DbSession {
  return {
    id: "ses_21b10f1da9012Ci26V1slASfwG",
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

function fakeOpenCodeSession(
  overrides: Partial<OpenCodeSessionService> = {},
): Layer.Layer<OpenCodeSessionService> {
  return Layer.succeed(OpenCodeSession, {
    createSession: () => Effect.succeed({ ok: true, session: session() }),
    addStatus: (session) => Effect.succeed(session),
    ...overrides,
  });
}

describe("OpenCode session creation route effect", () => {
  it("creates an OpenCode session and returns the enriched response session", async () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "say-to-me-create-service-"));
    let createdPath: string | null = null;
    let enrichedSessionId: string | null = null;

    try {
      const payload = await Effect.runPromise(
        createOpenCodeSessionEffect(workspacePath).pipe(
          Effect.provide(
            fakeOpenCodeSession({
              createSession: (inputPath) =>
                Effect.sync(() => {
                  createdPath = inputPath;
                  return { ok: true, session: session({ id: "ses_bc7fc66991851lGLTy40jN3u0n" }) };
                }),
              addStatus: (session) =>
                Effect.sync(() => {
                  enrichedSessionId = session.id;
                  return {
                    ...session,
                    opencodeStatus: "idle",
                    opencodeTitle: "created title",
                    opencodeModel: "gpt-5.5",
                  };
                }),
            }),
          ),
        ),
      );

      expect(createdPath).toBe(workspacePath);
      expect(enrichedSessionId).toBe("ses_bc7fc66991851lGLTy40jN3u0n");
      expect(payload.session).toMatchObject({
        id: "ses_bc7fc66991851lGLTy40jN3u0n",
        opencodeStatus: "idle",
        opencodeTitle: "created title",
        opencodeModel: "gpt-5.5",
      });
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("maps upstream creation failures and does not enrich the response", async () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "say-to-me-create-fail-service-"));
    let addStatusCalled = false;

    try {
      const error = await Effect.runPromise(
        Effect.flip(
          createOpenCodeSessionEffect(workspacePath).pipe(
            Effect.provide(
              fakeOpenCodeSession({
                createSession: () =>
                  Effect.succeed({
                    ok: false,
                    error: "OpenCode returned HTTP 503",
                    status: 503,
                  }),
                addStatus: () =>
                  Effect.sync(() => {
                    addStatusCalled = true;
                    return {};
                  }),
              }),
            ),
          ),
        ),
      );

      expect(error).toEqual({
        _tag: "OpenCodeSessionUpstreamError",
        error: "OpenCode returned HTTP 503",
        status: 503,
      });
      expect(addStatusCalled).toBe(false);
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});
