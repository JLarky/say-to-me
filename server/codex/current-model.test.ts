import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProviderModels } from "@say-to-me/provider-models";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const testHome = mkdtempSync(path.join(tmpdir(), "codex-current-model-home-"));
process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;

const { parseCodexSessionLineModel, readCodexSessionModel } = await import("./current-model.ts");
const { clearCodexSessionJsonlPathCache } = await import("./resolve.ts");
const { resetSessionModelEffect, SessionModelSession } =
  await import("../api-routes/session-models.ts");

const unusedProviderModels = Layer.succeed(ProviderModels, {
  listModels: () => Effect.succeed(null),
  currentCliModel: () => Effect.succeed(null),
});

function writeSession(chatId: string, lines: unknown[]): void {
  const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "12");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    path.join(sessionDir, `rollout-2026-07-12T00-00-00-${chatId}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
}

afterEach(() => {
  clearCodexSessionJsonlPathCache();
});

describe("Codex per-session model", () => {
  it("parses model from thread settings and turn context lines", () => {
    expect(
      parseCodexSessionLineModel(
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "thread_settings_applied",
            thread_settings: { model: "gpt-5.6-sol", model_provider_id: "openai" },
          },
        }),
      ),
    ).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol" });

    expect(
      parseCodexSessionLineModel(
        JSON.stringify({
          type: "turn_context",
          payload: { model: "gpt-5.5" },
        }),
      ),
    ).toEqual({ providerID: null, modelID: "gpt-5.5" });
  });

  it("reads the latest recorded model from the session jsonl", () => {
    const chatId = "019f23a3-2180-77b1-b50e-18f757148705";
    writeSession(chatId, [
      {
        type: "session_meta",
        payload: { id: chatId, model_provider: "openai" },
      },
      {
        type: "turn_context",
        payload: { model: "gpt-5.5" },
      },
      {
        type: "event_msg",
        payload: {
          type: "thread_settings_applied",
          thread_settings: { model: "gpt-5.6-sol", model_provider_id: "openai" },
        },
      },
      {
        type: "turn_context",
        payload: { model: "gpt-5.6-sol" },
      },
    ]);

    expect(readCodexSessionModel(`cx_${chatId}`)).toEqual({
      providerID: "openai",
      modelID: "gpt-5.6-sol",
    });
  });

  it("returns null when no session model is recorded", () => {
    const chatId = "119f23a3-2180-77b1-b50e-18f757148705";
    writeSession(chatId, [{ type: "session_meta", payload: { id: chatId } }]);

    expect(readCodexSessionModel(`cx_${chatId}`)).toBeNull();
  });

  it("resets a Codex session from recorded session model before global config", async () => {
    const chatId = "219f23a3-2180-77b1-b50e-18f757148705";
    const updates: unknown[] = [];
    writeSession(chatId, [
      {
        type: "session_meta",
        payload: { id: chatId, model_provider: "openai" },
      },
      {
        type: "turn_context",
        payload: { model: "gpt-5.6-sol" },
      },
      {
        type: "turn_context",
        payload: { effort: "high" },
      },
    ]);

    const layer = Layer.succeed(SessionModelSession, {
      ensure: (sessionId) =>
        Effect.succeed({
          id: sessionId,
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
          opencodeSelectedModelProvider: null,
          opencodeSelectedModel: null,
          cwd: null,
        }),
      updateModel: (sessionId, providerID, modelID) =>
        Effect.sync(() => {
          updates.push({ sessionId, providerID, modelID });
        }),
      updateModelAndReasoningEffort: (sessionId, providerID, modelID, reasoningEffort) =>
        Effect.sync(() => {
          updates.push({ sessionId, providerID, modelID, reasoningEffort });
        }),
      broadcast: () => Effect.void,
    });

    const result = await Effect.runPromise(
      resetSessionModelEffect(`cx_${chatId}`).pipe(
        Effect.provide(Layer.mergeAll(layer, unusedProviderModels)),
      ),
    );

    expect(result).toEqual({
      providerID: "openai",
      modelID: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    expect(updates).toEqual([
      {
        sessionId: `cx_${chatId}`,
        providerID: "openai",
        modelID: "gpt-5.6-sol",
        reasoningEffort: "high",
      },
    ]);
  });

  it("does not broadcast when the combined Codex reset write fails", async () => {
    const chatId = "319f23a3-2180-77b1-b50e-18f757148705";
    let broadcasts = 0;
    writeSession(chatId, [
      { type: "turn_context", payload: { model: "gpt-5.6-sol", effort: "high" } },
    ]);

    const layer = Layer.succeed(SessionModelSession, {
      ensure: (sessionId) =>
        Effect.succeed({
          id: sessionId,
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
          opencodeSelectedModelProvider: null,
          opencodeSelectedModel: null,
          cwd: null,
        }),
      updateModel: () => Effect.void,
      updateModelAndReasoningEffort: () =>
        Effect.fail({
          _tag: "SessionModelsError" as const,
          error: "Unable to update session model and reasoning effort.",
          status: 500,
        }),
      broadcast: () =>
        Effect.sync(() => {
          broadcasts += 1;
        }),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        resetSessionModelEffect(`cx_${chatId}`).pipe(
          Effect.provide(Layer.mergeAll(layer, unusedProviderModels)),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "SessionModelsError",
      error: "Unable to update session model and reasoning effort.",
      status: 500,
    });
    expect(broadcasts).toBe(0);
  });
});
