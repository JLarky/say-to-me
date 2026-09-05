import { type as arktype } from "arktype";
import { safeResponseJson } from "@say-to-me/runtime-validation";
import type { CodexReasoningEffort } from "./codex-reasoning-effort.ts";
import type { CreateProvider } from "./session-creation-api.ts";
import { PrototypeSpacesSchema, type PrototypeSpacesState } from "./new-space-prototype.ts";

const JarvisCreateResponse = arktype({
  state: PrototypeSpacesSchema,
  session: { id: "string", "alias?": "string | null", "state?": "string" },
  workspaceDirectory: "string",
  bootstrapStatus: "'delivered' | 'queued' | 'failed'",
  "bootstrapError?": "string",
  resumed: "boolean",
});
const ErrorResponse = arktype({ error: "string" });

export type JarvisCreateResult = typeof JarvisCreateResponse.infer;

export async function createJarvisInSpace(input: {
  spaceId: string;
  name: string;
  provider: CreateProvider;
  modelID?: string;
  reasoningEffort?: CodexReasoningEffort | "";
}): Promise<JarvisCreateResult & { state: PrototypeSpacesState }> {
  const baseBody = {
    name: input.name,
    provider: input.provider,
  };
  const bodyWithModel = input.modelID ? { ...baseBody, modelID: input.modelID } : baseBody;
  const requestBody =
    input.provider === "codex" && input.reasoningEffort
      ? { ...bodyWithModel, reasoningEffort: input.reasoningEffort }
      : bodyWithModel;
  const response = await fetch(`/api/spaces/${encodeURIComponent(input.spaceId)}/jarvis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    let message = `Unable to create Jarvis (${response.status}).`;
    try {
      message = (await safeResponseJson(response, ErrorResponse)).error;
    } catch {
      // Keep status fallback.
    }
    throw new Error(message);
  }
  return safeResponseJson(response, JarvisCreateResponse);
}
