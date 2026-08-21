/** Short speakable idle / wait-completion notice bodies (Phase 2 presentation). */
export const TARGET_IDLE_NOTICE_TEXT = "Session is now idle.";
export const SOURCE_IDLE_NOTICE_TEXT = "Session is now idle.";
export const SOURCE_IDLE_NOTICE_PLURAL_TEXT = "Sessions are now idle.";
export const SOURCE_IDLE_FAILED_NOTICE_TEXT = "Your relay could not be delivered.";

const LEGACY_IDLE_TAG =
  /^<say-to-me-system>[\s\S]*?\bis idle now(?: after [\s\S]*?)?<\/say-to-me-system>$/;

export function isIdleNoticeText(text: string): boolean {
  const trimmed = text.trim();
  if (LEGACY_IDLE_TAG.test(trimmed)) return true;
  if (trimmed === TARGET_IDLE_NOTICE_TEXT) return true;
  if (trimmed === SOURCE_IDLE_NOTICE_TEXT) return true;
  if (trimmed === SOURCE_IDLE_NOTICE_PLURAL_TEXT) return true;
  if (trimmed === SOURCE_IDLE_FAILED_NOTICE_TEXT) return true;
  return false;
}

export function sourceIdleNoticeText(entryCount: number): string {
  return entryCount > 1 ? SOURCE_IDLE_NOTICE_PLURAL_TEXT : SOURCE_IDLE_NOTICE_TEXT;
}
