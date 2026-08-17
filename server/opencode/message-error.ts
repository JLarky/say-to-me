import { type as arktype } from "arktype";
import type { AssistantMessage } from "@opencode-ai/sdk/v2/client";

type OpenCodeMessageError = NonNullable<AssistantMessage["error"]>;

function compactSnippet(value: string | null | undefined): string | null {
  const snippet = value?.trim();
  return snippet ? snippet : null;
}

type OpenCodeMessageErrorHandlers = {
  [Name in OpenCodeMessageError["name"]]: (message: string | null) => string | null;
};

const openCodeMessageErrorHandlers = {
  MessageAbortedError: () => null,
  MessageOutputLengthError: () => null,
  ProviderAuthError: compactSnippet,
  UnknownError: compactSnippet,
  StructuredOutputError: compactSnippet,
  ContextOverflowError: compactSnippet,
  APIError: compactSnippet,
} satisfies OpenCodeMessageErrorHandlers;

const AssistantMessageInfo = arktype({
  role: "'assistant'",
  id: "string",
  "error?": "unknown",
});
// Runtime counterpart to the SDK-derived handler map above. The map's `satisfies`
// pin makes upstream error-name additions or renames a compile-time failure.
const OpenCodeMessageErrorEnvelope = arktype({
  name: "'MessageAbortedError' | 'MessageOutputLengthError' | 'ProviderAuthError' | 'UnknownError' | 'StructuredOutputError' | 'ContextOverflowError' | 'APIError'",
  data: { "message?": "string" },
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- OpenCode SDK payloads are untrusted; this helper parses them with AssistantMessageInfo before inspection.
function parseAssistantMessageInfo(info: unknown) {
  const parsed = AssistantMessageInfo(info);
  return parsed instanceof arktype.errors ? null : parsed;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- OpenCode SDK payloads are parsed by parseAssistantMessageInfo before reading the id.
export function assistantMessageInfoId(info: unknown): string | null {
  return parseAssistantMessageInfo(info)?.id ?? null;
}

/** Error on a failed assistant message (`info.error`), when OpenCode has no text parts. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- OpenCode SDK payloads are parsed by parseAssistantMessageInfo and OpenCodeMessageErrorEnvelope before inspection.
export function openCodeMessageInfoError(info: unknown): string | null {
  const parsedInfo = parseAssistantMessageInfo(info);
  if (!parsedInfo?.error) return null;

  const parsedError = OpenCodeMessageErrorEnvelope(parsedInfo.error);
  if (parsedError instanceof arktype.errors) return null;
  return openCodeMessageErrorHandlers[parsedError.name](parsedError.data.message ?? null);
}
