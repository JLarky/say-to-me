import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  SessionModelSession,
  updateSessionModelEffect,
  type SessionModelSessionService,
} from "./api-routes/session-models.ts";
import type { DbSession } from "./db/schemas.ts";

function session(overrides: Partial<DbSession> = {}): DbSession {
  return {
    id: "cx_019f23a3-2180-77b1-b50e-18f757148705",
    state: "general",
    alias: null,
    revision: 0,
    createdAt: "2026-07-11 00:00:00",
    updatedAt: "2026-07-11 00:00:00",
    opencodeProjectId: null,
    opencodeWorkspaceId: null,
    opencodeDirectory: null,
    opencodeWorktree: null,
    opencodePath: null,
    opencodeProjectName: null,
    opencodeBranch: null,
    opencodeSelectedModelProvider: null,
    opencodeSelectedModel: null,
    cwd: null,
    ...overrides,
  };
}

describe("session model route effects", () => {
  it("updates the selected model through the injected session service", async () => {
    const calls: unknown[] = [];
    const layer = Layer.succeed(SessionModelSession, {
      ensure: (sessionId) =>
        Effect.sync(() => {
          calls.push(["ensure", sessionId]);
          return session({ id: sessionId });
        }),
      updateModel: (sessionId, providerID, modelID) =>
        Effect.sync(() => {
          calls.push(["update", sessionId, providerID, modelID]);
        }),
      updateModelAndReasoningEffort: (sessionId, providerID, modelID, effort) =>
        Effect.sync(() => {
          calls.push(["updateCombined", sessionId, providerID, modelID, effort]);
        }),
      broadcast: (sessionId) =>
        Effect.sync(() => {
          calls.push(["broadcast", sessionId]);
        }),
    } satisfies SessionModelSessionService);

    const result = await Effect.runPromise(
      updateSessionModelEffect(
        "cx_019f23a3-2180-77b1-b50e-18f757148705",
        " openai ",
        " gpt-5.6-sol ",
      ).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol" });
    expect(calls).toEqual([
      ["ensure", "cx_019f23a3-2180-77b1-b50e-18f757148705"],
      ["update", "cx_019f23a3-2180-77b1-b50e-18f757148705", "openai", "gpt-5.6-sol"],
      ["broadcast", "cx_019f23a3-2180-77b1-b50e-18f757148705"],
    ]);
  });

  it("keeps session write failures in the typed error channel", async () => {
    const layer = Layer.succeed(SessionModelSession, {
      ensure: (sessionId) => Effect.succeed(session({ id: sessionId })),
      updateModel: () =>
        Effect.fail({
          _tag: "SessionModelsError" as const,
          error: "Unable to update session model.",
          status: 500,
        }),
      updateModelAndReasoningEffort: () => Effect.void,
      broadcast: () => Effect.void,
    } satisfies SessionModelSessionService);

    const error = await Effect.runPromise(
      Effect.flip(
        updateSessionModelEffect(
          "cx_019f23a3-2180-77b1-b50e-18f757148705",
          "openai",
          "gpt-5.6-sol",
        ).pipe(Effect.provide(layer)),
      ),
    );

    expect(error).toEqual({
      _tag: "SessionModelsError",
      error: "Unable to update session model.",
      status: 500,
    });
  });
});
