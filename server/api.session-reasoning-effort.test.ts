import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { DbSession } from "./db/schemas.ts";
import type { SessionReasoningEffortService as SessionReasoningEffortServiceType } from "./api-routes/session-reasoning-effort.ts";

const {
  SessionReasoningEffortService,
  resetSessionReasoningEffortEffect,
  updateSessionReasoningEffortEffect,
} = await import("./api-routes/session-reasoning-effort.ts");

function session(id: string): DbSession {
  return {
    id,
    state: "general",
    alias: null,
    revision: 0,
    createdAt: "2026-07-12 00:00:00",
    updatedAt: "2026-07-12 00:00:00",
    opencodeProjectId: null,
    opencodeWorkspaceId: null,
    opencodeDirectory: null,
    opencodeWorktree: null,
    opencodePath: null,
    opencodeProjectName: null,
    opencodeBranch: null,
    opencodeSelectedModelProvider: "openai",
    opencodeSelectedModel: "gpt-5.5",
    reasoningEffort: null,
    cwd: "/tmp",
  };
}

function layerFor(
  overrides: Partial<SessionReasoningEffortServiceType> = {},
): Layer.Layer<SessionReasoningEffortServiceType> {
  return Layer.succeed(SessionReasoningEffortService, {
    ensure: (sessionId) => Effect.succeed(session(sessionId)),
    update: () => Effect.void,
    readSessionEffort: () => Effect.succeed(null),
    readGlobalEffort: () => Effect.succeed(null),
    getSession: (sessionId) => Effect.succeed(session(sessionId)),
    broadcast: () => Effect.void,
    ...overrides,
  });
}

describe("session reasoning effort route effects", () => {
  it("persists an explicit Codex effort and broadcasts it", async () => {
    const calls: unknown[] = [];
    const sessionId = "cx_619f23a3-2180-77b1-b50e-18f757148705";
    const result = await Effect.runPromise(
      updateSessionReasoningEffortEffect(sessionId, "high").pipe(
        Effect.provide(
          layerFor({
            update: (id, effort) => Effect.sync(() => calls.push(["update", id, effort])),
            broadcast: (id) => Effect.sync(() => calls.push(["broadcast", id])),
          }),
        ),
      ),
    );

    expect(result).toMatchObject({ selected: "high", current: "high" });
    expect(calls).toEqual([
      ["update", sessionId, "high"],
      ["broadcast", sessionId],
    ]);
  });

  it("keeps database failures in the typed Effect error channel", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        updateSessionReasoningEffortEffect(
          "cx_719f23a3-2180-77b1-b50e-18f757148705",
          "medium",
        ).pipe(
          Effect.provide(
            layerFor({
              update: () =>
                Effect.fail({
                  _tag: "SessionReasoningEffortError" as const,
                  error: "Unable to update session reasoning effort.",
                  status: 500,
                }),
            }),
          ),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "SessionReasoningEffortError",
      error: "Unable to update session reasoning effort.",
      status: 500,
    });
  });

  it("resets from the latest session-recorded effort", async () => {
    const chatId = "819f23a3-2180-77b1-b50e-18f757148705";
    const updates: unknown[] = [];

    const result = await Effect.runPromise(
      resetSessionReasoningEffortEffect(`cx_${chatId}`).pipe(
        Effect.provide(
          layerFor({
            readSessionEffort: () => Effect.succeed("high"),
            update: (id, effort) => Effect.sync(() => updates.push({ id, effort })),
          }),
        ),
      ),
    );

    expect(result).toMatchObject({ selected: "high", current: "high" });
    expect(updates).toEqual([{ id: `cx_${chatId}`, effort: "high" }]);
  });
});
