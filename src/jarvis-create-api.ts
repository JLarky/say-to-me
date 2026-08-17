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
type JarvisCreateRequestBody = {
  name: string;
  provider: CreateProvider;
  modelID?: string;
  reasoningEffort?: CodexReasoningEffort;
};

export async function createJarvisInSpace(input: {
  spaceId: string;
  name: string;
  provider: CreateProvider;
  modelID?: string;
  reasoningEffort?: CodexReasoningEffort | "";
}): Promise<JarvisCreateResult & { state: PrototypeSpacesState }> {
  const body: JarvisCreateRequestBody = {
    name: input.name,
    provider: input.provider,
  };
  if (input.modelID) body.modelID = input.modelID;
  if (input.provider === "codex" && input.reasoningEffort) {
    body.reasoningEffort = input.reasoningEffort;
  }
  const response = await fetch(`/api/spaces/${encodeURIComponent(input.spaceId)}/jarvis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
