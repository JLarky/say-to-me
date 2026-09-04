import { type as arktype } from "arktype";
import { safeResponseJson } from "@say-to-me/runtime-validation";

import type { CodexReasoningEffort } from "./codex-reasoning-effort.ts";
import { CliSessionPayload, CreateOpenCodeSessionPayload, ErrorPayload } from "./types.ts";

export type CliProvider = "claude" | "codex" | "cursor" | "grok";
export type CreateProvider = "opencode" | CliProvider;

export const providerLabels: Record<CreateProvider, string> = {
  opencode: "OpenCode",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
};

const ProviderModel = arktype({ providerID: "string", id: "string", name: "string" });
const ProviderModelsPayload = arktype({ models: ProviderModel.array() });

export type ProviderModel = typeof ProviderModel.infer;

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    return new Error((await safeResponseJson(response, ErrorPayload)).error || fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function fetchProviderModels(provider: CreateProvider): Promise<ProviderModel[]> {
  const response = await fetch(`/api/providers/${provider}/models`);
  if (!response.ok) throw await responseError(response, "Unable to load models.");
  return (await safeResponseJson(response, ProviderModelsPayload)).models;
}

/** OpenCode create/select values are `providerID/modelID`; CLI providers use bare model ids. */
export function providerModelOptionValue(provider: CreateProvider, model: ProviderModel): string {
  return provider === "opencode" ? `${model.providerID}/${model.id}` : model.id;
}

export async function createProviderSession(
  provider: CreateProvider,
  path: string,
  modelID: string,
  reasoningEffort: CodexReasoningEffort | "",
): Promise<string> {
  if (provider === "opencode") {
    const response = await fetch("/api/opencode-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) throw await responseError(response, "Unable to create OpenCode session.");
    return (await safeResponseJson(response, CreateOpenCodeSessionPayload)).session.id;
  }

  if (!modelID) throw new Error("Pick a model first.");
  const baseBody = { provider, path, modelID };
  const requestBody =
    provider === "codex" && reasoningEffort ? { ...baseBody, reasoningEffort } : baseBody;
  const response = await fetch("/api/cli-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) throw await responseError(response, "Unable to create session.");
  return (await safeResponseJson(response, CliSessionPayload)).session.id;
}
