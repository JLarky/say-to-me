/** Short speakable idle / wait-completion notice bodies (Phase 2 presentation). */
export const TARGET_IDLE_NOTICE_TEXT = "Session is now idle.";
export const SOURCE_IDLE_NOTICE_TEXT = "Session is now idle.";
export const SOURCE_IDLE_NOTICE_PLURAL_TEXT = "Sessions are now idle.";
export const SOURCE_IDLE_FAILED_NOTICE_TEXT = "Your relay could not be delivered.";

const LEGACY_IDLE_TAG =
  /^<say-to-me-system>[\s\S]*?\bis idle now(?: after [\s\S]*?)?<\/say-to-me-system>$/;

const ATTRIBUTED_IDLE_LINE = /^at (\d{2}:\d{2}) (\S+) said: (say-to-me\([^)]+\) is now idle\.)$/;

const SAY_TO_ME_IDLE_BODY = /^say-to-me\([^)]+\) is now idle\.$/;

export function parseMessageCreatedAt(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }
  return new Date(trimmed);
}

export function formatLocalHm(at: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(at);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour.padStart(2, "0")}:${minute}`;
}

export function formatIdleContinueBody(
  targetSessionId: string,
  targetAlias?: string | null,
): string {
  const alias = targetAlias?.trim();
  return alias
    ? `say-to-me(${targetSessionId}, ${alias}) is now idle.`
    : `say-to-me(${targetSessionId}) is now idle.`;
}

export function formatContinueAttributionLine(
  recipientId: string,
  body: string,
  at: Date,
  timeZone?: string,
): string {
  return `at ${formatLocalHm(at, timeZone)} ${recipientId} said: ${body}`;
}

export function parseAttributedIdleLines(text: string): Array<{
  hm: string;
  recipientId: string;
  body: string;
}> {
  return text
    .split("\n")
    .map((line) => {
      const match = line.trim().match(ATTRIBUTED_IDLE_LINE);
      if (!match) return null;
      return { hm: match[1]!, recipientId: match[2]!, body: match[3]! };
    })
    .filter((row) => row != null);
}

export function isAttributedIdleStoredText(text: string): boolean {
  const lines = text
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => ATTRIBUTED_IDLE_LINE.test(line));
}

export function isFailedRelayNoticeText(text: string): boolean {
  return text.trim() === SOURCE_IDLE_FAILED_NOTICE_TEXT;
}

export function isIdleContinueNoticeText(text: string): boolean {
  const trimmed = text.trim();
  if (isFailedRelayNoticeText(trimmed)) return false;
  if (isAttributedIdleStoredText(trimmed)) return true;
  if (SAY_TO_ME_IDLE_BODY.test(trimmed)) return true;
  return isIdleNoticeText(trimmed);
}

export function isIdleNoticeText(text: string): boolean {
  const trimmed = text.trim();
  if (LEGACY_IDLE_TAG.test(trimmed)) return true;
  if (trimmed === TARGET_IDLE_NOTICE_TEXT) return true;
  if (trimmed === SOURCE_IDLE_NOTICE_TEXT) return true;
  if (trimmed === SOURCE_IDLE_NOTICE_PLURAL_TEXT) return true;
  if (trimmed === SOURCE_IDLE_FAILED_NOTICE_TEXT) return true;
  if (isAttributedIdleStoredText(trimmed)) return true;
  if (SAY_TO_ME_IDLE_BODY.test(trimmed)) return true;
  if (parseAttributedIdleLines(trimmed).length > 0) return true;
  return false;
}

export function sourceIdleNoticeText(entryCount: number): string {
  return entryCount > 1 ? SOURCE_IDLE_NOTICE_PLURAL_TEXT : SOURCE_IDLE_NOTICE_TEXT;
}

export function appendCoalescedIdleStoredText(input: {
  recipientId: string;
  existingText: string;
  existingAt: Date | string | number;
  existingTargetSessionId: string;
  existingTargetAlias?: string | null;
  nextAt: Date | string | number;
  nextTargetSessionId: string;
  nextTargetAlias?: string | null;
  timeZone?: string;
}): string {
  const nextLine = formatContinueAttributionLine(
    input.recipientId,
    formatIdleContinueBody(input.nextTargetSessionId, input.nextTargetAlias),
    parseMessageCreatedAt(input.nextAt),
    input.timeZone,
  );
  if (isAttributedIdleStoredText(input.existingText)) {
    return `${input.existingText.trim()}\n${nextLine}`;
  }
  const firstLine = formatContinueAttributionLine(
    input.recipientId,
    formatIdleContinueBody(input.existingTargetSessionId, input.existingTargetAlias),
    parseMessageCreatedAt(input.existingAt),
    input.timeZone,
  );
  return `${firstLine}\n${nextLine}`;
}
