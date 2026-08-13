import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  getSessionOpenCodeReasoningEffortEffect,
  SessionOpenCodeReasoningEffortService,
  type SessionOpenCodeReasoningEffortService as SessionOpenCodeReasoningEffortServiceType,
  updateSessionOpenCodeReasoningEffortEffect,
} from "./api-routes/session-opencode-reasoning-effort.ts";
import type { DbSession } from "./db/schemas.ts";

function session(overrides: Partial<DbSession> = {}): DbSession {
  return {
    id: "ses_b35ee10a6214hJ2Li4V60pxNcS",
    state: "general",
    alias: null,
    revision: 0,
    createdAt: "2026-07-12 00:00:00",
    updatedAt: "2026-07-12 00:00:00",
    opencodeProjectId: null,
    opencodeWorkspaceId: null,
    opencodeDirectory: "/repo",
    opencodeWorktree: null,
    opencodePath: null,
    opencodeProjectName: null,
    opencodeBranch: null,
    opencodeSelectedModelProvider: "openai",
    opencodeSelectedModel: "gpt-5.5",
    reasoningEffort: null,
    ...overrides,
  };
}

function fakeService(
  initialSession: DbSession = session(),
  overrides: Partial<SessionOpenCodeReasoningEffortServiceType> = {},
) {
  let currentSession = initialSession;
  return Layer.succeed(SessionOpenCodeReasoningEffortService, {
    ensure: () => Effect.sync(() => currentSession),
    getSession: () => Effect.sync(() => currentSession),
    update: (_sessionId, effort) =>
      Effect.sync(() => {
        currentSession = { ...currentSession, reasoningEffort: effort };
      }),
    broadcast: () => Effect.void,
    listModels: () =>
      Effect.succeed([
        {
          providerID: "openai",
          id: "gpt-5.5",
          reasoningEfforts: ["low", "medium", "high"],
        },
      ]),
    getModel: () => Effect.succeed({ providerID: "openai", modelID: "gpt-5.5", variant: null }),
    setModel: () => Effect.void,
    ...overrides,
  } satisfies SessionOpenCodeReasoningEffortServiceType);
}

describe("OpenCode reasoning effort route effects", () => {
  it("reads model-defined effort choices and the persisted selection", async () => {
    const result = await Effect.runPromise(
      getSessionOpenCodeReasoningEffortEffect("ses_b35ee10a6214hJ2Li4V60pxNcS").pipe(
        Effect.provide(
          fakeService(session({ reasoningEffort: "medium" }), {
            getModel: () =>
              Effect.succeed({ providerID: "openai", modelID: "gpt-5.5", variant: "medium" }),
          }),
        ),
      ),
    );

    expect(result).toEqual({
      available: ["low", "medium", "high"],
      selected: "medium",
      current: "medium",
    });
  });

  it("keeps the provider default distinct from the first explicit choice", async () => {
    const result = await Effect.runPromise(
      getSessionOpenCodeReasoningEffortEffect("ses_b35ee10a6214hJ2Li4V60pxNcS").pipe(
        Effect.provide(fakeService()),
      ),
    );

    expect(result).toEqual({
      available: ["low", "medium", "high"],
      selected: null,
      current: null,
    });
  });

  it("does not persist or broadcast while reading an OpenCode-side change", async () => {
    let updateCalled = false;
    let broadcasts = 0;
    const result = await Effect.runPromise(
      getSessionOpenCodeReasoningEffortEffect("ses_b35ee10a6214hJ2Li4V60pxNcS").pipe(
        Effect.provide(
          fakeService(session({ reasoningEffort: "low" }), {
            getModel: () =>
              Effect.succeed({ providerID: "openai", modelID: "gpt-5.5", variant: "high" }),
            update: () => Effect.sync(() => void (updateCalled = true)),
            broadcast: () => Effect.sync(() => void broadcasts++),
          }),
        ),
      ),
    );

    expect(result).toMatchObject({ selected: "low", current: "high" });
    expect(updateCalled).toBe(false);
    expect(broadcasts).toBe(0);
  });

  it("validates against the selected model and broadcasts after persistence", async () => {
    let broadcasts = 0;
    let appliedVariant: string | null = null;
    const result = await Effect.runPromise(
      updateSessionOpenCodeReasoningEffortEffect("ses_b35ee10a6214hJ2Li4V60pxNcS", " high ").pipe(
        Effect.provide(
          fakeService(session(), {
            broadcast: () => Effect.sync(() => void broadcasts++),
            setModel: (_sessionId, _providerID, _modelID, _directory, variant) =>
              Effect.sync(() => void (appliedVariant = variant)),
          }),
        ),
      ),
    );

    expect(result.selected).toBe("high");
    expect(appliedVariant).toBe("high");
    expect(broadcasts).toBe(1);
  });

  it("clears the OpenCode override when the Default option is selected", async () => {
    let appliedVariant: string | null | undefined;
    let persistedEffort: string | null | undefined;
    const result = await Effect.runPromise(
      updateSessionOpenCodeReasoningEffortEffect("ses_b35ee10a6214hJ2Li4V60pxNcS", "").pipe(
        Effect.provide(
          fakeService(session({ reasoningEffort: "high" }), {
            setModel: (_sessionId, _providerID, _modelID, _directory, variant) =>
              Effect.sync(() => void (appliedVariant = variant)),
            update: (_sessionId, effort) => Effect.sync(() => void (persistedEffort = effort)),
          }),
        ),
      ),
    );

    expect(result).toEqual({
      available: ["low", "medium", "high"],
      selected: null,
      current: null,
    });
    expect(appliedVariant).toBeNull();
    expect(persistedEffort).toBeNull();
  });

  it("rejects unsupported values without updating or broadcasting", async () => {
    let updated = false;
    let broadcasts = 0;
    const error = await Effect.runPromise(
      Effect.flip(
        updateSessionOpenCodeReasoningEffortEffect("ses_b35ee10a6214hJ2Li4V60pxNcS", "turbo").pipe(
          Effect.provide(
            fakeService(session(), {
              update: () => Effect.sync(() => void (updated = true)),
              broadcast: () => Effect.sync(() => void broadcasts++),
            }),
          ),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "SessionOpenCodeReasoningEffortError",
      error: "Unsupported OpenCode reasoning effort.",
      status: 400,
    });
    expect(updated).toBe(false);
    expect(broadcasts).toBe(0);
  });

  it("preserves a typed Effect error when the database update fails", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        updateSessionOpenCodeReasoningEffortEffect("ses_b35ee10a6214hJ2Li4V60pxNcS", "high").pipe(
          Effect.provide(
            fakeService(session(), {
              update: () =>
                Effect.fail({
                  _tag: "SessionOpenCodeReasoningEffortError" as const,
                  error: "Unable to update OpenCode reasoning effort.",
                  status: 500,
                }),
            }),
          ),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "SessionOpenCodeReasoningEffortError",
      error: "Unable to update OpenCode reasoning effort.",
      status: 500,
    });
  });
});
