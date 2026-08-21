import { describe, expect, it } from "vite-plus/test";
import {
  isIdleNoticeText,
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

  it("pluralizes source notice copy", () => {
    expect(sourceIdleNoticeText(1)).toBe(SOURCE_IDLE_NOTICE_TEXT);
    expect(sourceIdleNoticeText(2)).toBe(SOURCE_IDLE_NOTICE_PLURAL_TEXT);
  });
});
