import { describe, expect, it } from "vite-plus/test";
import {
  normalizeVoiceWidgetAttributes,
  parseVoiceWidgetEvent,
  parseVoiceWidgetEventDetail,
  VOICE_WIDGET_DEFAULT_STORAGE_KEY,
  VOICE_WIDGET_DEFAULT_UI_BASE_URL,
  VOICE_WIDGET_OWNS_ID_AND_PARK_CONTROLS,
  VOICE_WIDGET_OPTIONAL_ATTRIBUTES,
  VOICE_WIDGET_PARK_SESSION_DETAIL_BASE,
  VOICE_WIDGET_PARK_SESSION_EVENT,
  VOICE_WIDGET_REQUIRED_ATTRIBUTES,
  VOICE_WIDGET_SOURCE,
  VOICE_WIDGET_TAG,
  VOICE_WIDGET_VERSION,
  VOICE_WIDGET_PARK_SESSION_VERSION,
  VOICE_WIDGET_BANNER_API_VERSION,
  VOICE_WIDGET_SPEECH_STARTED_EVENT,
  VOICE_WIDGET_SPEECH_ENDED_EVENT,
} from "./voice-widget-contract.ts";

const base = { source: VOICE_WIDGET_SOURCE, version: VOICE_WIDGET_VERSION } as const;
const parkBase = {
  ...VOICE_WIDGET_PARK_SESSION_DETAIL_BASE,
  version: VOICE_WIDGET_PARK_SESSION_VERSION,
} as const;

describe("voice widget Host Contract v2", () => {
  it("freezes the focused attribute surface, public tag, and one ID/Park owner", () => {
    expect(VOICE_WIDGET_TAG).toBe("say-to-me-widget");
    expect(VOICE_WIDGET_REQUIRED_ATTRIBUTES).toEqual(["session-id", "notes-base-url"]);
    expect(VOICE_WIDGET_OPTIONAL_ATTRIBUTES).toEqual([
      "ui-base-url",
      "storage-key",
      "timers-base-url",
    ]);
    expect(VOICE_WIDGET_OWNS_ID_AND_PARK_CONTROLS).toBe(true);
  });

  it("normalizes required and optional attributes", () => {
    expect(
      normalizeVoiceWidgetAttributes({
        "session-id": " ses_123 ",
        "notes-base-url": " /api/voice-notes ",
        "ui-base-url": " https://say.localhost:1311 ",
        "storage-key": " ",
        "timers-base-url": "/api/timers",
      }),
    ).toEqual({
      "session-id": "ses_123",
      "notes-base-url": "/api/voice-notes",
      "ui-base-url": "https://say.localhost:1311",
      "storage-key": VOICE_WIDGET_DEFAULT_STORAGE_KEY,
      "timers-base-url": "/api/timers",
    });
    expect(
      normalizeVoiceWidgetAttributes({
        "session-id": "ses_123",
        "notes-base-url": "/api/voice-notes",
      }),
    ).toMatchObject({
      "ui-base-url": VOICE_WIDGET_DEFAULT_UI_BASE_URL,
      "storage-key": VOICE_WIDGET_DEFAULT_STORAGE_KEY,
    });
    expect(
      normalizeVoiceWidgetAttributes({
        "session-id": "ses_123",
        "notes-base-url": "/api/voice-notes",
        "ui-base-url": "",
      })["ui-base-url"],
    ).toBe("");
  });

  it("rejects missing, blank, and non-canonical attributes", () => {
    expect(() => normalizeVoiceWidgetAttributes({})).toThrow(/session-id/);
    expect(() =>
      normalizeVoiceWidgetAttributes({
        "session-id": " ",
        "notes-base-url": "/api/voice-notes",
      }),
    ).toThrow(/session-id/);
    expect(() =>
      normalizeVoiceWidgetAttributes({
        "session-id": "ses_123",
        "notes-base-url": "",
      }),
    ).toThrow(/notes-base-url/);
  });

  it("accepts valid details and rejects wrong source/version/type or fields", () => {
    expect(VOICE_WIDGET_VERSION).toBe(2);
    expect(VOICE_WIDGET_PARK_SESSION_VERSION).toBe(1);
    expect(
      parseVoiceWidgetEventDetail({ ...base, type: "insert-usage-prompt", prompt: "use voice" }),
    ).toMatchObject({
      type: "insert-usage-prompt",
      prompt: "use voice",
    });
    expect(
      parseVoiceWidgetEventDetail(
        {
          ...parkBase,
          type: "park-session",
          sessionId: "ses_123",
        },
        "ses_123",
      ),
    ).toMatchObject({ type: "park-session", sessionId: "ses_123" });
    expect(
      parseVoiceWidgetEventDetail({ ...base, type: "collapse-change", collapsed: false }),
    ).toBeNull();
    expect(parseVoiceWidgetEventDetail({ ...base, type: "error", message: 7 })).toBeNull();
    expect(parseVoiceWidgetEventDetail({ ...base, type: "open-session", version: 2 })).toBeNull();
    expect(
      parseVoiceWidgetEventDetail(
        { ...base, type: "park-session", sessionId: "ses_other" },
        "ses_123",
      ),
    ).toBeNull();
    expect(parseVoiceWidgetEventDetail({ ...base, type: "unknown" })).toBeNull();
  });

  it("requires the exact event name and preserves bubbling/composed host parsing", () => {
    const detail = { ...parkBase, sessionId: "ses_123" } as const;
    const valid = new CustomEvent(VOICE_WIDGET_PARK_SESSION_EVENT, {
      bubbles: true,
      composed: true,
      detail,
    });
    expect(valid.bubbles).toBe(true);
    expect(valid.composed).toBe(true);
    expect(parseVoiceWidgetEvent(valid, "ses_123")).toEqual(detail);
    expect(
      parseVoiceWidgetEvent(
        new CustomEvent(VOICE_WIDGET_PARK_SESSION_EVENT, { detail }),
        "ses_other",
      ),
    ).toBeNull();
    expect(
      parseVoiceWidgetEvent(new CustomEvent("say-to-me-collapse-change", { detail }), "ses_123"),
    ).toBeNull();
    for (const removed of [
      "say-to-me-error",
      "say-to-me-playback-change",
      "say-to-me-open-session",
      "say-to-me-permission-issue",
    ]) {
      expect(parseVoiceWidgetEvent(new CustomEvent(removed, { detail }), "ses_123")).toBeNull();
    }
    expect(VOICE_WIDGET_PARK_SESSION_EVENT).toBe("say-to-me-park-session");
  });
  it("accepts only versioned speech activity events with note ids", () => {
    expect(VOICE_WIDGET_BANNER_API_VERSION).toBe(2);
    for (const [type, eventName] of [
      ["speech-started", VOICE_WIDGET_SPEECH_STARTED_EVENT],
      ["speech-ended", VOICE_WIDGET_SPEECH_ENDED_EVENT],
    ] as const) {
      const detail = { ...base, type, noteId: "42" };
      expect(
        parseVoiceWidgetEvent(
          new CustomEvent(eventName, { detail, bubbles: true, composed: true }),
          "42",
        ),
      ).toMatchObject(detail);
      expect(
        parseVoiceWidgetEvent(
          new CustomEvent(eventName, { detail: { ...detail, noteId: "" } }),
          "42",
        ),
      ).toBeNull();
    }
  });
});
