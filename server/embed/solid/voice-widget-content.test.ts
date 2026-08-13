import { describe, expect, it } from "vite-plus/test";
import {
  decideVoiceWidgetRevision,
  formatSayToMeTimestamp,
  imageAttachmentThumbnail,
  normalizeVoiceWidgetStatus,
  normalizeVoiceWidgetTimestamp,
  projectVoiceWidgetNotes,
  SAY_TO_ME_USAGE_PROMPT,
  sayToMeAttachmentLink,
  sayToMeSessionLink,
  sayToMeTitleUrl,
  voiceWidgetSessionDisplayName,
  voiceWidgetStatusPresentation,
  voiceWidgetUsagePrompt,
  voiceWidgetWaitingClass,
  voiceWidgetWaitingLabel,
} from "./voice-widget-content.ts";
import { parseVoiceWidgetJson, parseVoiceWidgetPayload } from "./voice-widget-parse-json.ts";

describe("voice widget pure content", () => {
  it("preserves exact usage prompt and insertion payload", () => {
    expect(SAY_TO_ME_USAGE_PROMPT).toBe("Tell your agent how to use Say To Me");
    expect(voiceWidgetUsagePrompt("ses/a?b")).toBe(
      "you have to reply to my messages with voice (cli `say-to-me usage` to learn how/why) and your session id is ses/a?b",
    );
  });
  it("uses alias, title, then id display fallback", () => {
    expect(voiceWidgetSessionDisplayName({ id: "ses-id", alias: " Alias ", title: "Title" })).toBe(
      "Alias",
    );
    expect(voiceWidgetSessionDisplayName({ id: "ses-id", alias: "  ", title: " Title " })).toBe(
      "Title",
    );
    expect(voiceWidgetSessionDisplayName({ id: "ses-id", alias: null, title: undefined })).toBe(
      "ses-id",
    );
  });
  it("preserves waiting labels/classes and unknown fallback semantics", () => {
    expect(voiceWidgetWaitingLabel("working")).toBe("Working");
    expect(voiceWidgetWaitingLabel("needs_answer")).toBe("Needs answer");
    expect(voiceWidgetWaitingLabel("can_continue")).toBe("Idle");
    expect(voiceWidgetWaitingLabel("future_state_here")).toBe("future state here");
    expect(voiceWidgetWaitingLabel(null)).toBe("Unknown");
    expect(voiceWidgetWaitingClass("working")).toBe("bg-amber-500/15 text-amber-700");
    expect(voiceWidgetWaitingClass("future_state")).toBe("bg-muted text-muted-foreground");
  });
  it("constructs encoded links with target and rel intent", () => {
    expect(sayToMeSessionLink("ses/a?b")).toEqual({
      href: "https://say.localhost:1311/ses/ses%2Fa%3Fb",
      target: "_blank",
      rel: "noreferrer",
    });
    expect(sayToMeTitleUrl("ses-id", "missing")).toBe("https://say.localhost:1311");
    expect(sayToMeTitleUrl("ses/a", "ready")).toBe("https://say.localhost:1311/ses/ses%2Fa");
    expect(sayToMeAttachmentLink(7)).toEqual({
      href: "https://say.localhost:1311/api/message-attachments/7",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    expect(sayToMeSessionLink("ses-id", "")).toBeNull();
    expect(sayToMeTitleUrl("ses-id", "ready", "")).toBeNull();
    expect(sayToMeAttachmentLink(7, "")).toBeNull();
  });
  it("keeps known and unknown status strings with exact classes", () => {
    expect(voiceWidgetStatusPresentation("played")).toEqual({
      label: "played",
      className: "bg-emerald-500/15 text-emerald-700",
    });
    expect(voiceWidgetStatusPresentation("future-status")).toEqual({
      label: "future-status",
      className: "bg-muted/70 text-muted-foreground",
    });
  });
  it("matches revision acceptance and last-integer tracking semantics", () => {
    expect(decideVoiceWidgetRevision(5, undefined)).toEqual({ accepted: true, revision: 5 });
    expect(decideVoiceWidgetRevision(5, null)).toEqual({ accepted: true, revision: 5 });
    expect(decideVoiceWidgetRevision(5, "6")).toEqual({ accepted: true, revision: 5 });
    expect(decideVoiceWidgetRevision(5, 5.5)).toEqual({ accepted: true, revision: 5 });
    expect(decideVoiceWidgetRevision(5, Number.NaN)).toEqual({ accepted: true, revision: 5 });
    expect(decideVoiceWidgetRevision(5, 5)).toEqual({ accepted: true, revision: 5 });
    expect(decideVoiceWidgetRevision(5, 6)).toEqual({ accepted: true, revision: 6 });
    expect(decideVoiceWidgetRevision(5, 4)).toEqual({ accepted: false, revision: 5 });
  });

  it("formats valid timestamps in local Intl format and falls back to the raw invalid value", () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date("2026-07-26T19:17:58Z"));
    expect(formatSayToMeTimestamp(" 2026-07-26 19:17:58 ")).toBe(expected);
    expect(formatSayToMeTimestamp("not-a-date")).toBe("not-a-date");
  });

  it("returns only image-prefixed, present, safe thumbnail data URLs", () => {
    expect(
      imageAttachmentThumbnail({
        mimeType: "image/png",
        thumbnailDataUrl: " data:image/webp;base64,abc ",
      }),
    ).toBe("data:image/webp;base64,abc");
    expect(
      imageAttachmentThumbnail({ mimeType: "image/png", thumbnailDataUrl: undefined }),
    ).toBeNull();
    expect(imageAttachmentThumbnail({ mimeType: "image/png", thumbnailDataUrl: null })).toBeNull();
    expect(
      imageAttachmentThumbnail({
        mimeType: "audio/mpeg",
        thumbnailDataUrl: "data:image/webp;base64,abc",
      }),
    ).toBeNull();
    expect(
      imageAttachmentThumbnail({ mimeType: "image/png", thumbnailDataUrl: "javascript:alert(1)" }),
    ).toBeNull();
    expect(imageAttachmentThumbnail(null)).toBeNull();
    expect(
      imageAttachmentThumbnail({ mimeType: 7, thumbnailDataUrl: "data:image/png;base64,abc" }),
    ).toBeNull();
  });

  it("accepts only an object with an array messages property", () => {
    expect(parseVoiceWidgetPayload(null)).toBeNull();
    expect(parseVoiceWidgetPayload([])).toBeNull();
    expect(parseVoiceWidgetPayload({})).toBeNull();
    expect(parseVoiceWidgetPayload({ messages: "not an array" })).toBeNull();
    expect(parseVoiceWidgetPayload({ messages: [], extra: true })).toEqual({ messages: [] });
    expect(
      parseVoiceWidgetPayload({ messages: [{ extraMarkdownHtml: "<p>safe</p>" }] })?.messages[0],
    ).toEqual({ extraMarkdownHtml: "<p>safe</p>" });
  });

  it("rejects malformed JSON but preserves arbitrary message fields", () => {
    expect(parseVoiceWidgetJson("not json")).toBeNull();
    expect(parseVoiceWidgetJson('{"messages":[{"id":7,"status":"queued"}]}')).toEqual({
      messages: [{ id: 7, status: "queued" }],
      revision: undefined,
    });
  });

  it("normalizes SQLite UTC timestamps and leaves other strings unchanged", () => {
    expect(normalizeVoiceWidgetTimestamp(" 2026-07-26 19:17:58 ")).toBe("2026-07-26T19:17:58Z");
    expect(normalizeVoiceWidgetTimestamp("2026-07-26 19:17:58.123456")).toBe(
      "2026-07-26T19:17:58.123456Z",
    );
    expect(normalizeVoiceWidgetTimestamp("2026-07-26T19:17:58Z")).toBe("2026-07-26T19:17:58Z");
    expect(normalizeVoiceWidgetTimestamp("not-a-timestamp")).toBe("not-a-timestamp");
  });

  it("recognizes the four banner speech statuses and leaves unknown statuses generic", () => {
    expect(normalizeVoiceWidgetStatus("queued")).toBe("queued");
    expect(normalizeVoiceWidgetStatus("speaking")).toBe("speaking");
    expect(normalizeVoiceWidgetStatus("played")).toBe("played");
    expect(normalizeVoiceWidgetStatus("stopped")).toBe("stopped");
    expect(normalizeVoiceWidgetStatus("future-status")).toBeNull();
  });

  it("keeps the newest 30 notes in newest-first order and applies React defaults", () => {
    const messages = Array.from({ length: 31 }, (_, index) => ({
      id: index + 1,
      author: index % 2 === 0 ? "agent" : "user",
      createdAt: `2026-07-26 19:${String(index).padStart(2, "0")}:00`,
      text: `note ${index + 1}`,
      status: "queued",
    }));

    const notes = projectVoiceWidgetNotes({ messages });
    expect(notes).toHaveLength(30);
    expect(notes[0]).toMatchObject({ id: "31", text: "note 31" });
    expect(notes[29]).toMatchObject({ id: "2", text: "note 2" });
    expect(notes[0]?.extraMarkdown).toBeNull();
    expect(notes[0]?.extraMarkdownHtml).toBeNull();
    expect(
      projectVoiceWidgetNotes({
        messages: [
          {
            id: 1,
            author: "agent",
            createdAt: "now",
            text: "x",
            status: "played",
            extraMarkdownHtml: "<p>safe</p>",
          },
        ],
      })[0]?.extraMarkdownHtml,
    ).toBe("<p>safe</p>");
    expect(notes[0]?.attachments).toEqual([]);
    expect(notes[0]?.sessions).toEqual([]);
  });
});
