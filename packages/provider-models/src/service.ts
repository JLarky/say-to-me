import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import {
  type CurrentCliModel,
  type ProviderModel,
  claudeModelsFromSettingsJson,
  parseClaudeSettingsCurrentModelJson,
  parseCodexConfigTomlCurrentModel,
  parseCodexModelsCacheJson,
  parseCursorCliConfigCurrentModelJson,
  parseCursorCliConfigModelsJson,
  parseGrokDefaultModelText,
  parseGrokModelsText,
} from "./decoders.ts";

export class ProviderModelsIoError extends Data.TaggedError("ProviderModelsIoError")<{
  readonly cause: unknown;
}> {}

export type ProviderModelsService = {
  /**
   * Known CLI provider → models (possibly empty on IO/parse failure).
   * Unknown provider → `null`.
   */
  listModels: (providerName: string) => Effect.Effect<ProviderModel[] | null>;
  /** CLI config / default model for a session backend name; `null` when missing. */
  currentCliModel: (backend: string) => Effect.Effect<CurrentCliModel | null>;
};

export const ProviderModels = Context.GenericTag<ProviderModelsService>("say-to-me/ProviderModels");

function claudeConfigPath(home: string): string {
  return path.join(home, ".claude", "settings.json");
}
function cursorConfigPath(home: string): string {
  return path.join(home, ".cursor", "cli-config.json");
}
function codexConfigPath(home: string): string {
  return path.join(home, ".codex", "config.toml");
}
function codexModelsCachePath(home: string): string {
  return path.join(home, ".codex", "models_cache.json");
}

function readTextFile(filePath: string): Effect.Effect<string | null, ProviderModelsIoError> {
  return Effect.try({
    try: () => {
      if (!existsSync(filePath)) return null;
      return readFileSync(filePath, "utf-8");
    },
    catch: (cause) => new ProviderModelsIoError({ cause }),
  });
}

function execGrokModels(): Effect.Effect<string, ProviderModelsIoError> {
  return Effect.try({
    try: () => execSync("grok models", { encoding: "utf-8", timeout: 15000 }),
    catch: (cause) => new ProviderModelsIoError({ cause }),
  });
}

/** Intentionally swallow IO/parse failures the way the old sync helpers did. */
function fallbackEmptyModels(): Effect.Effect<ProviderModel[]> {
  return Effect.succeed([]);
}

function fallbackNullModel(): Effect.Effect<CurrentCliModel | null> {
  return Effect.succeed(null);
}

export function makeProviderModelsLive(home: string = homedir()): ProviderModelsService {
  const listModels = (providerName: string): Effect.Effect<ProviderModel[] | null> => {
    switch (providerName) {
      case "grok":
        return execGrokModels().pipe(
          Effect.map(parseGrokModelsText),
          Effect.catchAll(() => fallbackEmptyModels()),
        );
      case "codex":
        return readTextFile(codexModelsCachePath(home)).pipe(
          Effect.map((raw) => (raw ? parseCodexModelsCacheJson(raw) : [])),
          Effect.catchAll(() => fallbackEmptyModels()),
        );
      case "claude":
        return readTextFile(claudeConfigPath(home)).pipe(
          Effect.map((raw) => claudeModelsFromSettingsJson(raw)),
          // Alias catalog is still useful when settings.json is missing or invalid.
          Effect.catchAll(() => Effect.succeed(claudeModelsFromSettingsJson(null))),
        );
      case "cursor":
        return readTextFile(cursorConfigPath(home)).pipe(
          Effect.flatMap((raw) => {
            if (!raw) return fallbackEmptyModels();
            return Effect.try({
              try: () => parseCursorCliConfigModelsJson(raw),
              catch: (cause) => new ProviderModelsIoError({ cause }),
            });
          }),
          Effect.catchAll(() => fallbackEmptyModels()),
        );
      default:
        return Effect.succeed(null);
    }
  };

  const currentCliModel = (backend: string): Effect.Effect<CurrentCliModel | null> => {
    switch (backend) {
      case "grok":
        return execGrokModels().pipe(
          Effect.map(parseGrokDefaultModelText),
          Effect.catchAll(() => fallbackNullModel()),
        );
      case "codex":
        return readTextFile(codexConfigPath(home)).pipe(
          Effect.map((raw) => (raw ? parseCodexConfigTomlCurrentModel(raw) : null)),
          Effect.catchAll(() => fallbackNullModel()),
        );
      case "cursor":
        return readTextFile(cursorConfigPath(home)).pipe(
          Effect.flatMap((raw) => {
            if (!raw) return fallbackNullModel();
            return Effect.try({
              try: () => parseCursorCliConfigCurrentModelJson(raw),
              catch: (cause) => new ProviderModelsIoError({ cause }),
            });
          }),
          Effect.catchAll(() => fallbackNullModel()),
        );
      case "claude":
        return readTextFile(claudeConfigPath(home)).pipe(
          Effect.flatMap((raw) => {
            if (!raw) return fallbackNullModel();
            return Effect.try({
              try: () => parseClaudeSettingsCurrentModelJson(raw),
              catch: (cause) => new ProviderModelsIoError({ cause }),
            });
          }),
          Effect.catchAll(() => fallbackNullModel()),
        );
      default:
        return Effect.succeed(null);
    }
  };

  return { listModels, currentCliModel } satisfies ProviderModelsService;
}

export const ProviderModelsLive = Layer.succeed(ProviderModels, makeProviderModelsLive());

export function listCliProviderModels(
  providerName: string,
): Effect.Effect<ProviderModel[] | null, never, ProviderModelsService> {
  return Effect.gen(function* () {
    const providerModels = yield* ProviderModels;
    return yield* providerModels.listModels(providerName);
  });
}

export function currentCliProviderModel(
  backend: string,
): Effect.Effect<CurrentCliModel | null, never, ProviderModelsService> {
  return Effect.gen(function* () {
    const providerModels = yield* ProviderModels;
    return yield* providerModels.currentCliModel(backend);
  });
}
