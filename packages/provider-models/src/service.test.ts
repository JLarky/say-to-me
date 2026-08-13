import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  ProviderModels,
  type ProviderModelsService,
  currentCliProviderModel,
  listCliProviderModels,
} from "./service.ts";

function fakeProviderModels(service: ProviderModelsService): Layer.Layer<ProviderModelsService> {
  return Layer.succeed(ProviderModels, service);
}

describe("listCliProviderModels / currentCliProviderModel", () => {
  it("yields the injected service for known providers", async () => {
    const layer = fakeProviderModels({
      listModels: (providerName) =>
        Effect.succeed(
          providerName === "claude"
            ? [{ providerID: "anthropic", id: "sonnet", name: "Sonnet" }]
            : providerName === "unknown"
              ? null
              : [],
        ),
      currentCliModel: (backend) =>
        Effect.succeed(backend === "codex" ? { providerID: "openai", modelID: "gpt-5" } : null),
    });

    await expect(
      Effect.runPromise(listCliProviderModels("claude").pipe(Effect.provide(layer))),
    ).resolves.toEqual([{ providerID: "anthropic", id: "sonnet", name: "Sonnet" }]);
    await expect(
      Effect.runPromise(listCliProviderModels("unknown").pipe(Effect.provide(layer))),
    ).resolves.toBeNull();
    await expect(
      Effect.runPromise(currentCliProviderModel("codex").pipe(Effect.provide(layer))),
    ).resolves.toEqual({ providerID: "openai", modelID: "gpt-5" });
    await expect(
      Effect.runPromise(currentCliProviderModel("none").pipe(Effect.provide(layer))),
    ).resolves.toBeNull();
  });

  it("propagates intentional empty catalog fallbacks from the service", async () => {
    const layer = fakeProviderModels({
      listModels: () => Effect.succeed([]),
      currentCliModel: () => Effect.succeed(null),
    });
    await expect(
      Effect.runPromise(listCliProviderModels("cursor").pipe(Effect.provide(layer))),
    ).resolves.toEqual([]);
    await expect(
      Effect.runPromise(currentCliProviderModel("cursor").pipe(Effect.provide(layer))),
    ).resolves.toBeNull();
  });
});
