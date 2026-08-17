import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The widget projects provider message fields lazily; its transport contract deliberately retains other JSON fields.
export type VoiceWidgetMessage = Record<string, unknown>;

export type VoiceWidgetMessagesPayload = {
  readonly messages: ReadonlyArray<unknown>;
  readonly revision?: unknown;
};

/**
 * The banner only accepts payloads whose messages property is an array.
 * Individual message fields are intentionally not validated here: the React
 * banner projected those values at render time and ignored other payload keys.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
export function parseVoiceWidgetPayload(raw: unknown): VoiceWidgetMessagesPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const messages = (raw as { readonly messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  return {
    messages,
    revision: (raw as { readonly revision?: unknown }).revision,
  };
}

/** Parse an EventSource/fetch JSON body using the same permissive boundary. */
export function parseVoiceWidgetJson(raw: string): VoiceWidgetMessagesPayload | null {
  return parseVoiceWidgetPayload(safeJsonParse(UnknownJson, raw));
}
