import { type as arktype } from "arktype";
import { parseJson, safeJsonParse } from "@say-to-me/runtime-validation";

export interface ProviderModel {
  providerID: string;
  id: string;
  name: string;
}

export type CurrentCliModel = { providerID: string; modelID: string };

export const GROK_PROVIDER = "xai";
export const CODEX_PROVIDER = "openai";
export const ANTHROPIC_PROVIDER = "anthropic";
export const CURSOR_PROVIDER = "cursor";

const ClaudeConfig = arktype({ "model?": "string" });
const CursorModelConfig = arktype({
  "model?": { "modelId?": "string", "displayModelId?": "string", "displayName?": "string" },
});
const CodexModelEntry = arktype({
  "visibility?": "string",
  "slug?": "string",
  "display_name?": "string",
});
const CodexModelsCache = arktype({
  "models?": CodexModelEntry.array(),
});

/**
 * Claude Code `/model` aliases accepted by the CLI (same set as its internal list).
 * Unlike Codex, Claude has no on-disk models cache — aliases are the selectable catalog.
 */
export const CLAUDE_MODEL_ALIASES: ReadonlyArray<{ id: string; name: string }> = [
  { id: "sonnet", name: "Sonnet" },
  { id: "opus", name: "Opus" },
  { id: "haiku", name: "Haiku" },
  { id: "fable", name: "Fable" },
  { id: "best", name: "Best" },
  { id: "sonnet[1m]", name: "Sonnet (1M)" },
  { id: "opus[1m]", name: "Opus (1M)" },
  { id: "fable[1m]", name: "Fable (1M)" },
  { id: "opusplan", name: "Opus Plan" },
];

export function parseGrokModelsText(output: string): ProviderModel[] {
  const models: ProviderModel[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^[\s*-]+\s*(\S+)/);
    if (match) {
      const id = match[1];
      if (id) {
        const isDefault = trimmed.includes("(default)");
        models.push({ providerID: GROK_PROVIDER, id, name: isDefault ? id + " (default)" : id });
      }
    }
  }
  return models;
}

export function parseGrokDefaultModelText(output: string): CurrentCliModel | null {
  const match = output.match(/^\s*\*\s*(\S+)\s+\(default\)/m);
  if (match?.[1]) return { providerID: GROK_PROVIDER, modelID: match[1] };
  return null;
}

export function parseCodexModelsCacheJson(raw: string): ProviderModel[] {
  const parsed = safeJsonParse(CodexModelsCache, raw);
  if (!parsed?.models) return [];
  return parsed.models
    .filter((m) => m.visibility === "list")
    .map((m) => ({
      providerID: CODEX_PROVIDER,
      id: m.slug ?? "",
      name: m.display_name ?? m.slug ?? "",
    }))
    .filter((m) => m.id.length > 0);
}

/** Alias catalog, optionally extended with a custom `settings.json` model. */
export function claudeModelsFromSettingsJson(raw: string | null): ProviderModel[] {
  const models: ProviderModel[] = CLAUDE_MODEL_ALIASES.map(({ id, name }) => ({
    providerID: ANTHROPIC_PROVIDER,
    id,
    name,
  }));
  if (!raw) return models;
  try {
    const validated = parseJson(ClaudeConfig, raw);
    const current = validated.model?.trim();
    // Keep a custom settings model selectable if it isn't already an alias.
    if (current && !models.some((model) => model.id === current)) {
      models.unshift({ providerID: ANTHROPIC_PROVIDER, id: current, name: current });
    }
  } catch {
    // Catalog is still useful when settings.json is missing or invalid.
  }
  return models;
}

export function parseCursorCliConfigModelsJson(raw: string): ProviderModel[] {
  const validated = parseJson(CursorModelConfig, raw);
  const model = validated.model;
  if (!model) return [];
  const id = model.displayModelId || model.modelId || "default";
  const name = model.displayName || id;
  return [{ providerID: CURSOR_PROVIDER, id, name }];
}

export function parseCodexConfigTomlCurrentModel(raw: string): CurrentCliModel | null {
  const match = raw.match(/^model\s*=\s*"([^"]+)"/m);
  if (!match?.[1]) return null;
  return { providerID: CODEX_PROVIDER, modelID: match[1] };
}

export function parseCursorCliConfigCurrentModelJson(raw: string): CurrentCliModel | null {
  const validated = parseJson(CursorModelConfig, raw);
  const model = validated.model;
  if (!model) return null;
  const modelID = model.displayModelId || model.modelId || "default";
  return { providerID: CURSOR_PROVIDER, modelID };
}

export function parseClaudeSettingsCurrentModelJson(raw: string): CurrentCliModel | null {
  const validated = parseJson(ClaudeConfig, raw);
  if (!validated.model) return null;
  return { providerID: ANTHROPIC_PROVIDER, modelID: validated.model };
}

/** Sync CLI providers only — OpenCode models come from the live OpenCode server. */
export function isAsyncProviderModels(providerName: string): boolean {
  return providerName === "opencode";
}
