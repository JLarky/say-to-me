import { describe, expect, it } from "vite-plus/test";
import {
  claudeModelsFromSettingsJson,
  isAsyncProviderModels,
  parseClaudeSettingsCurrentModelJson,
  parseCodexConfigTomlCurrentModel,
  parseCodexModelsCacheJson,
  parseCursorCliConfigCurrentModelJson,
  parseCursorCliConfigModelsJson,
  parseGrokDefaultModelText,
  parseGrokModelsText,
} from "./decoders.ts";

describe("parseGrokModelsText", () => {
  it("parses starred and dashed model lines and marks default", () => {
    const models = parseGrokModelsText(`
* grok-3 (default)
- grok-2
  not-a-model
`);
    expect(models).toEqual([
      { providerID: "xai", id: "grok-3", name: "grok-3 (default)" },
      { providerID: "xai", id: "grok-2", name: "grok-2" },
    ]);
  });

  it("parses the default model for current CLI model", () => {
    expect(parseGrokDefaultModelText("* grok-3 (default)\n- grok-2")).toEqual({
      providerID: "xai",
      modelID: "grok-3",
    });
    expect(parseGrokDefaultModelText("- grok-2")).toBeNull();
  });
});

describe("parseCodexModelsCacheJson", () => {
  it("keeps visibility=list entries only", () => {
    expect(
      parseCodexModelsCacheJson(
        JSON.stringify({
          models: [
            { visibility: "list", slug: "gpt-5", display_name: "GPT-5" },
            { visibility: "hidden", slug: "secret", display_name: "Secret" },
            { visibility: "list", slug: "o3" },
          ],
        }),
      ),
    ).toEqual([
      { providerID: "openai", id: "gpt-5", name: "GPT-5" },
      { providerID: "openai", id: "o3", name: "o3" },
    ]);
  });

  it("returns empty for invalid json", () => {
    expect(parseCodexModelsCacheJson("not json")).toEqual([]);
  });
});

describe("claudeModelsFromSettingsJson", () => {
  it("lists Claude Code aliases, not only settings.json", () => {
    const models = claudeModelsFromSettingsJson('{"model":"sonnet"}');
    const ids = models.map((model) => model.id);
    expect(ids).toEqual(
      expect.arrayContaining(["sonnet", "opus", "haiku", "fable", "best", "opusplan"]),
    );
    expect(models.every((model) => model.providerID === "anthropic")).toBe(true);
    expect(models.length).toBeGreaterThan(1);
  });

  it("prepends a custom settings model when it is not an alias", () => {
    const models = claudeModelsFromSettingsJson('{"model":"custom-deploy"}');
    expect(models[0]).toEqual({
      providerID: "anthropic",
      id: "custom-deploy",
      name: "custom-deploy",
    });
    expect(models.map((model) => model.id)).toContain("sonnet");
  });

  it("still returns aliases when settings json is missing or invalid", () => {
    expect(claudeModelsFromSettingsJson(null).length).toBeGreaterThan(1);
    expect(claudeModelsFromSettingsJson("not json").map((model) => model.id)).toContain("opus");
  });

  it("reads current model from settings json", () => {
    expect(parseClaudeSettingsCurrentModelJson('{"model":"claude-sonnet-4"}')).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    });
  });
});

describe("parseCursorCliConfigModelsJson", () => {
  it("prefers displayModelId and displayName", () => {
    expect(
      parseCursorCliConfigModelsJson(
        JSON.stringify({
          model: {
            modelId: "raw-id",
            displayModelId: "shown-id",
            displayName: "Shown Name",
          },
        }),
      ),
    ).toEqual([{ providerID: "cursor", id: "shown-id", name: "Shown Name" }]);
    expect(
      parseCursorCliConfigCurrentModelJson(
        JSON.stringify({ model: { modelId: "raw-id", displayModelId: "shown-id" } }),
      ),
    ).toEqual({ providerID: "cursor", modelID: "shown-id" });
  });
});

describe("parseCodexConfigTomlCurrentModel", () => {
  it("reads the model assignment", () => {
    expect(parseCodexConfigTomlCurrentModel('model = "gpt-5"\n')).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    });
    expect(parseCodexConfigTomlCurrentModel("# no model\n")).toBeNull();
  });
});

describe("isAsyncProviderModels", () => {
  it("is only true for opencode", () => {
    expect(isAsyncProviderModels("opencode")).toBe(true);
    expect(isAsyncProviderModels("codex")).toBe(false);
  });
});
