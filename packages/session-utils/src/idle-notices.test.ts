import { describe, expect, it } from "vite-plus/test";
import {
  appendCoalescedIdleStoredText,
  formatContinueAttributionLine,
  formatIdleContinueBody,
  formatLocalHm,
  isFailedRelayNoticeText,
  isIdleContinueNoticeText,
  isIdleNoticeText,
  parseMessageCreatedAt,
  SOURCE_IDLE_FAILED_NOTICE_TEXT,
  SOURCE_IDLE_NOTICE_PLURAL_TEXT,
  SOURCE_IDLE_NOTICE_TEXT,
  sourceIdleNoticeText,
  TARGET_IDLE_NOTICE_TEXT,
} from "./idle-notices.ts";

describe("idle notices", () => {
  it("recognizes speakable and legacy idle notice text", () => {
    expect(isIdleNoticeText(TARGET_IDLE_NOTICE_TEXT)).toBe(true);
    expect(isIdleNoticeText(SOURCE_IDLE_NOTICE_TEXT)).toBe(true);
    expect(isIdleNoticeText(SOURCE_IDLE_NOTICE_PLURAL_TEXT)).toBe(true);
    expect(isIdleNoticeText(SOURCE_IDLE_FAILED_NOTICE_TEXT)).toBe(true);
    expect(isIdleNoticeText("<say-to-me-system>ses_abc is idle now</say-to-me-system>")).toBe(true);
    expect(isIdleNoticeText("please finish the task")).toBe(false);
  });

  it("keeps failed relays distinct from idle continues", () => {
    expect(isFailedRelayNoticeText(SOURCE_IDLE_FAILED_NOTICE_TEXT)).toBe(true);
    expect(isIdleContinueNoticeText(SOURCE_IDLE_FAILED_NOTICE_TEXT)).toBe(false);
    expect(isIdleContinueNoticeText(SOURCE_IDLE_NOTICE_TEXT)).toBe(true);
    expect(isIdleContinueNoticeText("say-to-me(cur_abc, review) is now idle.")).toBe(true);
  });

  it("pluralizes source notice copy", () => {
    expect(sourceIdleNoticeText(1)).toBe(SOURCE_IDLE_NOTICE_TEXT);
    expect(sourceIdleNoticeText(2)).toBe(SOURCE_IDLE_NOTICE_PLURAL_TEXT);
  });

  it("names the idle target from getSession alias, or id only", () => {
    expect(formatIdleContinueBody("cur_abc", "review")).toBe(
      "say-to-me(cur_abc, review) is now idle.",
    );
    expect(formatIdleContinueBody("cur_abc")).toBe("say-to-me(cur_abc) is now idle.");
    expect(formatIdleContinueBody("cur_abc", "  ")).toBe("say-to-me(cur_abc) is now idle.");
  });

  it("stores per-event clocks when coalescing idle notices", () => {
    const first = parseMessageCreatedAt("2026-08-29 20:02:00");
    const second = parseMessageCreatedAt("2026-08-29 20:05:00");
    expect(
      appendCoalescedIdleStoredText({
        recipientId: "cur_jarvis",
        existingText: SOURCE_IDLE_NOTICE_TEXT,
        existingAt: first,
        existingTargetSessionId: "cur_abc",
        existingTargetAlias: "review",
        nextAt: second,
        nextTargetSessionId: "cx_xyz",
        timeZone: "UTC",
      }),
    ).toBe(
      [
        "at 20:02 cur_jarvis said: say-to-me(cur_abc, review) is now idle.",
        "at 20:05 cur_jarvis said: say-to-me(cx_xyz) is now idle.",
      ].join("\n"),
    );
  });

  it("formats local 24h clock from sqlite UTC timestamps", () => {
    const at = parseMessageCreatedAt("2026-08-29 22:20:45");
    expect(formatLocalHm(at, "UTC")).toBe("22:20");
    expect(formatContinueAttributionLine("ses_abc", "hello", at, "UTC")).toBe(
      "at 22:20 ses_abc said: hello",
    );
  });
});
