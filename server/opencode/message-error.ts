import type { AssistantMessage } from "@opencode-ai/sdk/v2/client";

type OpenCodeMessageError = NonNullable<AssistantMessage["error"]>;

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SDK error envelopes are untrusted until the focused guards below establish their fields.
type OpenCodeErrorEnvelope = Record<string, unknown>;

function compactSnippet(value: string | null | undefined): string | null {
  const snippet = value?.trim();
  return snippet ? snippet : null;
}

function isRecord(value: unknown): value is OpenCodeErrorEnvelope {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenCodeMessageError(value: unknown): value is OpenCodeMessageError {
  if (!isRecord(value) || typeof value.name !== "string") return false;
  if (!isRecord(value.data)) return false;
  return true;
}

function isAssistantMessageInfo(
  info: unknown,
): info is Pick<AssistantMessage, "role" | "id" | "error"> {
  if (!isRecord(info)) return false;
  return info.role === "assistant" && typeof info.id === "string";
}

export function assistantMessageInfoId(info: unknown): string | null {
  return isAssistantMessageInfo(info) ? info.id : null;
}

function openCodeMessageErrorText(error: OpenCodeMessageError): string | null {
  switch (error.name) {
    case "MessageAbortedError":
      return null;
    case "MessageOutputLengthError":
      return null;
    case "ProviderAuthError":
    case "UnknownError":
    case "StructuredOutputError":
    case "ContextOverflowError":
    case "APIError":
      return compactSnippet(error.data.message);
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

/** Error on a failed assistant message (`info.error`), when OpenCode has no text parts. */
export function openCodeMessageInfoError(info: unknown): string | null {
  if (!isAssistantMessageInfo(info) || !info.error) return null;
  if (!isOpenCodeMessageError(info.error)) return null;
  return openCodeMessageErrorText(info.error);
}
