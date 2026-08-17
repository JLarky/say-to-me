/** Host Contract v2 for the complete `<say-to-me-widget>` element. */
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- The embed contract preserves provider-defined message payload fields for progressive UI projection. */

import {
  EMBED_WIDGET_PARK_SESSION_EVENT,
  EMBED_WIDGET_PARK_SESSION_DETAIL_BASE,
  EMBED_WIDGET_SOURCE,
  EMBED_WIDGET_VERSION,
} from "./widget-shared.ts";
import { SAY_TO_ME_UI_URL } from "./voice-widget-content.ts";

export const VOICE_WIDGET_TAG = "say-to-me-widget" as const;
export const VOICE_WIDGET_SOURCE = EMBED_WIDGET_SOURCE;
export const VOICE_WIDGET_VERSION = 2 as const;
export const VOICE_WIDGET_PARK_SESSION_VERSION = EMBED_WIDGET_VERSION;
export const VOICE_WIDGET_BANNER_API_VERSION = 2 as const;
export const VOICE_WIDGET_SPEECH_STARTED_EVENT = "say-to-me-speech-started" as const;
export const VOICE_WIDGET_SPEECH_ENDED_EVENT = "say-to-me-speech-ended" as const;
export const VOICE_WIDGET_QUEUE_IDLE_EVENT = "say-to-me-queue-idle" as const;

/** The widget owns one ID/Park toolbar; hosts must not compose a second one. */
export const VOICE_WIDGET_OWNS_ID_AND_PARK_CONTROLS = true as const;

export const VOICE_WIDGET_REQUIRED_ATTRIBUTES = ["session-id", "notes-base-url"] as const;

export const VOICE_WIDGET_OPTIONAL_ATTRIBUTES = [
  "ui-base-url",
  "storage-key",
  "timers-base-url",
] as const;

export const VOICE_WIDGET_INSERT_USAGE_PROMPT_EVENT = "say-to-me-insert-usage-prompt" as const;
export const VOICE_WIDGET_PARK_SESSION_EVENT = EMBED_WIDGET_PARK_SESSION_EVENT;
export const VOICE_WIDGET_PARK_SESSION_DETAIL_BASE = {
  ...EMBED_WIDGET_PARK_SESSION_DETAIL_BASE,
} as const;
export const VOICE_WIDGET_DEFAULT_STORAGE_KEY = "t3code:say-to-me-banner-collapsed:v1";
export const VOICE_WIDGET_DEFAULT_UI_BASE_URL = SAY_TO_ME_UI_URL;

export type VoiceWidgetAttributes = {
  readonly "session-id": string;
  readonly "notes-base-url": string;
  readonly "ui-base-url": string;
  readonly "storage-key": string;
  readonly "timers-base-url"?: string;
};

type MutableVoiceWidgetAttributes = {
  "session-id": string;
  "notes-base-url": string;
  "ui-base-url": string;
  "storage-key": string;
  "timers-base-url"?: string;
};

export type VoiceWidgetAttributeInput = Readonly<
  Partial<
    Record<
      (typeof VOICE_WIDGET_REQUIRED_ATTRIBUTES | typeof VOICE_WIDGET_OPTIONAL_ATTRIBUTES)[number],
      string | null | undefined
    >
  >
>;

function trimmed(value: string | null | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function requireAttribute(input: VoiceWidgetAttributeInput, name: string): string {
  const value = trimmed(input[name as keyof VoiceWidgetAttributeInput]);
  if (!value) throw new Error(`say-to-me-widget: missing required attribute ${name}`);
  return value;
}

/** Normalize host DOM attributes and reject missing/invalid required values. */
export function normalizeVoiceWidgetAttributes(
  input: VoiceWidgetAttributeInput,
): VoiceWidgetAttributes {
  const sessionId = requireAttribute(input, "session-id");
  const notesBaseUrl = requireAttribute(input, "notes-base-url");
  const result: MutableVoiceWidgetAttributes = {
    "session-id": sessionId,
    "notes-base-url": notesBaseUrl,
    "ui-base-url":
      input["ui-base-url"] === ""
        ? ""
        : (trimmed(input["ui-base-url"]) ?? VOICE_WIDGET_DEFAULT_UI_BASE_URL),
    "storage-key": trimmed(input["storage-key"]) ?? VOICE_WIDGET_DEFAULT_STORAGE_KEY,
  };
  const timersBaseUrl = trimmed(input["timers-base-url"]);
  if (timersBaseUrl) result["timers-base-url"] = timersBaseUrl;
  return result;
}

type VoiceWidgetBaseDetail<
  Type extends string,
  Version extends number = typeof VOICE_WIDGET_VERSION,
> = {
  readonly source: typeof VOICE_WIDGET_SOURCE;
  readonly version: Version;
  readonly type: Type;
};

export type VoiceWidgetEventDetail =
  | (VoiceWidgetBaseDetail<"insert-usage-prompt"> & { readonly prompt: string })
  | (VoiceWidgetBaseDetail<"park-session", typeof VOICE_WIDGET_PARK_SESSION_VERSION> & {
      readonly sessionId: string;
    })
  | (VoiceWidgetBaseDetail<"speech-started" | "speech-ended"> & { readonly noteId: string })
  | (VoiceWidgetBaseDetail<"queue-idle"> & { readonly workUnitId: string });

export type VoiceWidgetEventType = VoiceWidgetEventDetail["type"];

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasBase<Type extends string, Version extends number>(
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  value: unknown,
  version: Version,
  type: Type,
): value is VoiceWidgetBaseDetail<Type, Version> & Record<string, unknown> {
  return (
    isRecord(value) &&
    value.source === VOICE_WIDGET_SOURCE &&
    value.version === version &&
    value.type === type
  );
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function validSessionId(value: unknown, expectedSessionId?: string): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  return expectedSessionId === undefined || value === expectedSessionId;
}

/** Strictly parse a v1 detail and, when supplied, bind session actions to one host session. */
export function parseVoiceWidgetEventDetail(
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  detail: unknown,
  expectedSessionId?: string,
): VoiceWidgetEventDetail | null {
  if (hasBase(detail, VOICE_WIDGET_VERSION, "insert-usage-prompt")) {
    return typeof detail.prompt === "string" ? { ...detail, prompt: detail.prompt } : null;
  }
  if (hasBase(detail, VOICE_WIDGET_PARK_SESSION_VERSION, "park-session")) {
    return validSessionId(detail.sessionId, expectedSessionId)
      ? { ...detail, sessionId: detail.sessionId }
      : null;
  }
  if (
    hasBase(detail, VOICE_WIDGET_VERSION, "speech-started") ||
    hasBase(detail, VOICE_WIDGET_VERSION, "speech-ended")
  ) {
    return typeof detail.noteId === "string" && detail.noteId.trim()
      ? { ...detail, noteId: detail.noteId }
      : null;
  }
  if (hasBase(detail, VOICE_WIDGET_VERSION, "queue-idle")) {
    return typeof detail.workUnitId === "string" && detail.workUnitId.trim()
      ? { ...detail, workUnitId: detail.workUnitId.trim() }
      : null;
  }
  return null;
}

/** Parse a bubbling/composed CustomEvent without trusting its name or detail. */
export function parseVoiceWidgetEvent(
  event: Event,
  expectedSessionId?: string,
): VoiceWidgetEventDetail | null {
  if (typeof CustomEvent === "undefined" || !(event instanceof CustomEvent)) return null;
  const detail = parseVoiceWidgetEventDetail(event.detail, expectedSessionId);
  if (!detail) return null;
  const expectedName =
    detail.type === "park-session"
      ? VOICE_WIDGET_PARK_SESSION_EVENT
      : detail.type === "speech-started"
        ? VOICE_WIDGET_SPEECH_STARTED_EVENT
        : detail.type === "speech-ended"
          ? VOICE_WIDGET_SPEECH_ENDED_EVENT
          : detail.type === "queue-idle"
            ? VOICE_WIDGET_QUEUE_IDLE_EVENT
            : VOICE_WIDGET_INSERT_USAGE_PROMPT_EVENT;
  return event.type === expectedName ? detail : null;
}

/** Host → widget: enqueue the idle chime for one work unit. */
export function createVoiceWidgetQueueIdleEvent(workUnitId: string): CustomEvent {
  return new CustomEvent(VOICE_WIDGET_QUEUE_IDLE_EVENT, {
    bubbles: true,
    composed: true,
    detail: {
      source: VOICE_WIDGET_SOURCE,
      version: VOICE_WIDGET_VERSION,
      type: "queue-idle",
      workUnitId: workUnitId.trim(),
    } satisfies Extract<VoiceWidgetEventDetail, { type: "queue-idle" }>,
  });
}

/** First claim wins. Blank or already-seen ids are ignored. */
export function claimIdleWorkUnit(seen: Set<string>, workUnitId: string): string | null {
  const id = workUnitId.trim();
  if (!id || seen.has(id)) return null;
  seen.add(id);
  return id;
}
