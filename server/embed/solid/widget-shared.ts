/** Host contract for `<say-to-me-widget>`. */

export const EMBED_WIDGET_TAG = "say-to-me-widget";
export const EMBED_WIDGET_PATH = "/embed/widget.js";

export const EMBED_WIDGET_PARK_SESSION_EVENT = "say-to-me-park-session";
export const EMBED_WIDGET_SOURCE = "say-to-me-widget" as const;
export const EMBED_WIDGET_VERSION = 1 as const;

export const WIDGET_REQUIRED_ATTRIBUTES = ["session-id"] as const;

export const EMBED_WIDGET_PARK_SESSION_DETAIL_BASE = {
  source: EMBED_WIDGET_SOURCE,
  version: EMBED_WIDGET_VERSION,
  type: "park-session",
} as const;

/** Fail loudly when `session-id` is missing or blank after trim. */
export function requireWidgetSessionId(value: string | null | undefined): string {
  const sessionId = value?.trim() ?? "";
  if (!sessionId) {
    throw new Error("say-to-me-widget: missing required attribute session-id");
  }
  return sessionId;
}
