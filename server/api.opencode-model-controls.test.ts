import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  listOpenCodeModelsEffect,
  OpenCodeModelControls,
  OpenCodeModelSession,
  resetOpenCodeModelEffect,
  setAllOpenCodeModelsEffect,
  setOpenCodeModelEffect,
  updateOpenCodeModelEffect,
  type OpenCodeModelControlsService,
  type OpenCodeModelSessionService,
} from "./api-routes/opencode-model-controls.ts";
import type { DbSession } from "./db/schemas.ts";

function session(overrides: Partial<DbSession> = {}): DbSession {
  return {
    id: "ses_e2db075f13bfmSRBKzh6uE9y5X",
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

function fakeOpenCodeModelControls(
  overrides: Partial<OpenCodeModelControlsService> = {},
): Layer.Layer<OpenCodeModelControlsService> {
  return Layer.succeed(OpenCodeModelControls, {
    listModels: () =>
      Effect.succeed([
        {
          providerID: "github-copilot",
          id: "gpt-5.5",
          name: "GPT-5.5",
          reasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ]),
    setModel: () => Effect.void,
    getModel: () => Effect.succeed({ providerID: "github-copilot", modelID: "gpt-5.5" }),
    addStatus: (session) => Effect.succeed(session),
    ...overrides,
  });
}

function fakeOpenCodeModelSession(
  initialSession: DbSession = session(),
  overrides: Partial<OpenCodeModelSessionService> = {},
): Layer.Layer<OpenCodeModelSessionService> {
  let currentSession = initialSession;
  return Layer.succeed(OpenCodeModelSession, {
    ensure: () => Effect.sync(() => currentSession),
    listAll: () => Effect.sync(() => [currentSession]),
    updateModel: (_sessionId, providerID, modelID) =>
      Effect.sync(() => {
        currentSession = {
          ...currentSession,
          opencodeSelectedModelProvider: providerID,
          opencodeSelectedModel: modelID,
        };
      }),
    updateModelAndReasoningEffort: (_sessionId, providerID, modelID, reasoningEffort) =>
      Effect.sync(() => {
        currentSession = {
          ...currentSession,
          opencodeSelectedModelProvider: providerID,
          opencodeSelectedModel: modelID,
          reasoningEffort,
        };
      }),
    broadcast: () => Effect.void,
    ...overrides,
  });
}

function fakeOpenCodeModelLayers(
  controls: Partial<OpenCodeModelControlsService> = {},
  sessions: Partial<OpenCodeModelSessionService> = {},
) {
  return Layer.mergeAll(
    fakeOpenCodeModelControls(controls),
    fakeOpenCodeModelSession(session(), sessions),
  );
}

describe("OpenCode model controls route effects", () => {
  it("lists models through the injected OpenCode service", async () => {
    const payload = await Effect.runPromise(
      listOpenCodeModelsEffect("ses_a35509f81cfcghp3fiGUjBJooq").pipe(
        Effect.provide(fakeOpenCodeModelLayers()),
      ),
    );

    expect(payload).toEqual({
      models: [
        {
          providerID: "github-copilot",
          id: "gpt-5.5",
          name: "GPT-5.5",
          reasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
    });
  });

  it("maps model listing failures to the public upstream error", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        listOpenCodeModelsEffect("ses_dac0c99e2dd534PfCxYVVy4tD5").pipe(
          Effect.provide(
            fakeOpenCodeModelLayers({
              listModels: () => Effect.fail(new Error("model list failed")),
            }),
          ),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "OpenCodeModelUpstreamError",
      error: "model list failed",
      status: 502,
    });
  });

  it("stores the selected model before enriching the response session", async () => {
    let enrichedSessionProvider: string | null | undefined = null;
    let enrichedSessionModel: string | null | undefined = null;
    const payload = await Effect.runPromise(
      updateOpenCodeModelEffect(
        "ses_59ba0a1b11c69NXRgr6y6p6h1z",
        " github-copilot ",
        " gpt-5.5 ",
      ).pipe(
        Effect.provide(
          fakeOpenCodeModelLayers({
            addStatus: (session) =>
              Effect.sync(() => {
                enrichedSessionProvider = session.opencodeSelectedModelProvider;
                enrichedSessionModel = session.opencodeSelectedModel;
                return session;
              }),
          }),
        ),
      ),
    );

    expect(payload.session).toMatchObject({
      opencodeSelectedModelProvider: "github-copilot",
      opencodeSelectedModel: "gpt-5.5",
    });
    expect(enrichedSessionProvider).toBe("github-copilot");
    expect(enrichedSessionModel).toBe("gpt-5.5");
  });

  it("sets the selected model on the OpenCode session", async () => {
    const setCalls: unknown[] = [];
    const payload = await Effect.runPromise(
      setOpenCodeModelEffect(
        "ses_bd0ebbcf69181w1dx15PWQL2D6",
        " github-copilot ",
        " gpt-5.5 ",
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeOpenCodeModelControls({
              setModel: (sessionId, providerID, modelID, directory) =>
                Effect.sync(() => {
                  setCalls.push({ sessionId, providerID, modelID, directory });
                }),
            }),
            fakeOpenCodeModelSession(session({ opencodeDirectory: "/repo" })),
          ),
        ),
      ),
    );

    expect(payload.session).toMatchObject({
      opencodeSelectedModelProvider: "github-copilot",
      opencodeSelectedModel: "gpt-5.5",
    });
    expect(setCalls).toEqual([
      {
        sessionId: "ses_e2db075f13bfmSRBKzh6uE9y5X",
        providerID: "github-copilot",
        modelID: "gpt-5.5",
        directory: "/repo",
      },
    ]);
  });

  it("does not store the selected model when OpenCode rejects the set", async () => {
    let updateCalled = false;
    const error = await Effect.runPromise(
      Effect.flip(
        setOpenCodeModelEffect("ses_fbcf633fab7dI2cplSdkyWHGrp", "github-copilot", "gpt-5.5").pipe(
          Effect.provide(
            Layer.mergeAll(
              fakeOpenCodeModelControls({
                setModel: () => Effect.fail(new Error("set failed")),
              }),
              fakeOpenCodeModelSession(session(), {
                updateModel: () =>
                  Effect.sync(() => {
                    updateCalled = true;
                  }),
              }),
            ),
          ),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "OpenCodeModelUpstreamError",
      error: "set failed",
      status: 502,
    });
    expect(updateCalled).toBe(false);
  });

  it("resets the selected model from the OpenCode session", async () => {
    const payload = await Effect.runPromise(
      resetOpenCodeModelEffect("ses_339e1debe963AwQsZyGZgNJTGj").pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeOpenCodeModelControls({
              getModel: (sessionId, directory) =>
                Effect.sync(() => {
                  expect({ sessionId, directory }).toEqual({
                    sessionId: "ses_e2db075f13bfmSRBKzh6uE9y5X",
                    directory: "/repo",
                  });
                  return { providerID: "openai", modelID: "gpt-5.5", variant: "high" };
                }),
            }),
            fakeOpenCodeModelSession(
              session({ opencodeDirectory: "/repo", reasoningEffort: "low" }),
            ),
          ),
        ),
      ),
    );

    expect(payload.session).toMatchObject({
      opencodeSelectedModelProvider: "openai",
      opencodeSelectedModel: "gpt-5.5",
      reasoningEffort: "high",
    });
  });

  it("keeps the combined reset typed and does not broadcast after a DB failure", async () => {
    let broadcastCalled = false;
    const error = await Effect.runPromise(
      Effect.flip(
        resetOpenCodeModelEffect("ses_2bc7a70b6154vO0xUFLQwNZqLG").pipe(
          Effect.provide(
            Layer.mergeAll(
              fakeOpenCodeModelControls({
                getModel: () =>
                  Effect.succeed({ providerID: "openai", modelID: "gpt-5.5", variant: "high" }),
              }),
              fakeOpenCodeModelSession(session({ reasoningEffort: "low" }), {
                updateModelAndReasoningEffort: () =>
                  Effect.fail({
                    _tag: "OpenCodeModelSessionError" as const,
                    error: "Unable to update OpenCode model and reasoning effort.",
                    status: 500,
                  }),
                broadcast: () =>
                  Effect.sync(() => {
                    broadcastCalled = true;
                  }),
              }),
            ),
          ),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "OpenCodeModelSessionError",
      error: "Unable to update OpenCode model and reasoning effort.",
      status: 500,
    });
    expect(broadcastCalled).toBe(false);
  });

  it("rejects blank model selections without calling OpenCode", async () => {
    let addStatusCalled = false;
    const error = await Effect.runPromise(
      Effect.flip(
        updateOpenCodeModelEffect("ses_7d2a428eb68bORmBg2lWTjgTm4", "", "gpt-5.5").pipe(
          Effect.provide(
            fakeOpenCodeModelLayers({
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
      _tag: "OpenCodeModelValidationError",
      error: "Model is required.",
      status: 400,
    });
    expect(addStatusCalled).toBe(false);
  });

  it("sets the selected model on all sessions", async () => {
    const setCalls: unknown[] = [];
    const sessions = [
      session({ id: "ses_e09287220d07k6Fk4EtONt3XqJ", opencodeDirectory: "/repo1" }),
      session({ id: "ses_4d2ed5547dd7HTadm16SLGXzii", opencodeDirectory: "/repo2" }),
    ];
    const updatedModels: Record<string, { providerID: string; modelID: string }> = {};
    const result = await Effect.runPromise(
      setAllOpenCodeModelsEffect("github-copilot", "gpt-5.5").pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeOpenCodeModelControls({
              setModel: (sessionId, providerID, modelID, directory) =>
                Effect.sync(() => {
                  setCalls.push({ sessionId, providerID, modelID, directory });
                }),
            }),
            Layer.succeed(OpenCodeModelSession, {
              ensure: (sessionId) =>
                Effect.sync(() => sessions.find((s) => s.id === sessionId) ?? sessions[0]),
              listAll: () => Effect.sync(() => sessions),
              updateModel: (sessionId, providerID, modelID) =>
                Effect.sync(() => {
                  updatedModels[sessionId] = { providerID, modelID };
                }),
              updateModelAndReasoningEffort: () => Effect.void,
              broadcast: () => Effect.void,
            }),
          ),
        ),
      ),
    );

    expect(result).toEqual({ updatedCount: 2, failedCount: 0 });
    expect(setCalls).toEqual([
      {
        sessionId: "ses_e09287220d07k6Fk4EtONt3XqJ",
        providerID: "github-copilot",
        modelID: "gpt-5.5",
        directory: "/repo1",
      },
      {
        sessionId: "ses_4d2ed5547dd7HTadm16SLGXzii",
        providerID: "github-copilot",
        modelID: "gpt-5.5",
        directory: "/repo2",
      },
    ]);
    expect(updatedModels).toEqual({
      ses_e09287220d07k6Fk4EtONt3XqJ: { providerID: "github-copilot", modelID: "gpt-5.5" },
      ses_4d2ed5547dd7HTadm16SLGXzii: { providerID: "github-copilot", modelID: "gpt-5.5" },
    });
  });

  it("rejects blank provider when setting all sessions", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        setAllOpenCodeModelsEffect("", "gpt-5.5").pipe(Effect.provide(fakeOpenCodeModelLayers())),
      ),
    );
    expect(error).toEqual({
      _tag: "OpenCodeModelValidationError",
      error: "Model is required.",
      status: 400,
    });
  });

  it("counts OpenCode failures without updating local state for failed sessions", async () => {
    const sessions = [
      session({ id: "ses_f4550eabf104sqHghTZSZjNeMZ", opencodeDirectory: "/repo1" }),
      session({ id: "ses_a86f3b717b3dlIgKjut9755h7A", opencodeDirectory: "/repo2" }),
    ];
    const updatedModels: string[] = [];
    const result = await Effect.runPromise(
      setAllOpenCodeModelsEffect("github-copilot", "gpt-5.5").pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeOpenCodeModelControls({
              setModel: (sessionId) =>
                sessionId === "ses_f4550eabf104sqHghTZSZjNeMZ"
                  ? Effect.fail(new Error("OpenCode rejected"))
                  : Effect.void,
            }),
            Layer.succeed(OpenCodeModelSession, {
              ensure: (sessionId) =>
                Effect.sync(() => sessions.find((s) => s.id === sessionId) ?? sessions[0]),
              listAll: () => Effect.sync(() => sessions),
              updateModel: (sessionId) =>
                Effect.sync(() => {
                  updatedModels.push(sessionId);
                }),
              updateModelAndReasoningEffort: () => Effect.void,
              broadcast: () => Effect.void,
            }),
          ),
        ),
      ),
    );

    expect(result).toEqual({ updatedCount: 1, failedCount: 1 });
    expect(updatedModels).toEqual(["ses_a86f3b717b3dlIgKjut9755h7A"]);
  });
});
