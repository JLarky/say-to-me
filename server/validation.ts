import { type as arktype, type Type } from "arktype";
import { type Response } from "express";
import { maxMessageLength, minMessageLength } from "./config.ts";

export function validateText(text: string, res: Response, { allowEmpty = false } = {}): boolean {
  const minLength = minMessageLength();
  const maxLength = maxMessageLength();
  if (!allowEmpty && text.length < minLength) {
    res.status(400).json({
      error: `Message is too short. Minimum length is ${minLength} character${minLength === 1 ? "" : "s"}.`,
    });
    return false;
  }

  if (text.length > maxLength) {
    res.status(400).json({
      error: `Message is too long. Maximum length is ${maxLength} characters.`,
    });
    return false;
  }

  return true;
}

export function hasInlineHttpsLink(text: string): boolean {
  return text.includes("https://");
}

export function validateTextHasNoInlineHttpsLinks(text: string, res: Response): boolean {
  if (!hasInlineHttpsLink(text)) return true;
  res.status(400).json({
    error:
      "Message text contains a link. Use the links field instead. Run `say-to-me usage` for supported fields.",
  });
  return false;
}

export function hasRawSessionId(text: string): boolean {
  return /(?<!say-to-me\()ses_[A-Za-z0-9]{26}(?=[^A-Za-z0-9]|$)/.test(text);
}

export function validateTextHasNoRawSessionIds(text: string, res: Response): boolean {
  if (!hasRawSessionId(text)) return true;
  res.status(400).json({
    error:
      "Message text contains a raw session id. Use the sessions field instead. Run `say-to-me usage` for supported fields.",
  });
  return false;
}

export function hasFullGitSha(text: string): boolean {
  return /(^|[^0-9a-fA-F])[0-9a-fA-F]{40}(?=[^0-9a-fA-F]|$)/.test(text);
}

export function validateTextHasNoFullGitShas(text: string, res: Response): boolean {
  if (!hasFullGitSha(text)) return true;
  res.status(400).json({
    error:
      "Message text contains a full git SHA. Use the links field or extraMarkdown instead. Run `say-to-me usage` for supported fields.",
  });
  return false;
}

const spelledNumberWordPattern =
  /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi;

export function hasTooManySpelledNumberWords(text: string): boolean {
  const matches = text.match(spelledNumberWordPattern) ?? [];
  return matches.length > 2;
}

export const SPELLED_NUMBER_WORDS_ERROR =
  'Message text contains spelled-out numbers. Write numbers as digits (example: use 235, not "two three five").';

export function validateTextHasFewSpelledNumberWords(text: string, res: Response): boolean {
  if (!hasTooManySpelledNumberWords(text)) return true;
  res.status(400).json({
    error: SPELLED_NUMBER_WORDS_ERROR,
  });
  return false;
}

// Reject requests that carry a field the endpoint cannot honor (e.g. images or
// links on an endpoint that does not persist them). Failing loudly with 400
// prevents silently dropping caller-supplied attachments or links. Returns true
// (and sends the response) when a listed field is present.
function rejectUnsupportedFields(
  body: unknown,
  res: Response,
  fields: Array<{ key: string; message: string }>,
): boolean {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  for (const { key, message } of fields) {
    if (record[key] != null) {
      res.status(400).json({ error: message });
      return true;
    }
  }
  return false;
}

// Only enforce key sets here; handlers still validate field values themselves.
export const sayBodyKeys = arktype({ "text?": "unknown", "overflow?": "unknown", "+": "reject" });
export const sessionMessageBodyKeys = arktype({
  "author?": "unknown",
  "text?": "unknown",
  "extraMarkdown?": "unknown",
  "pushNotificationText?": "unknown",
  "useCli?": "unknown",
  "forceOpencode?": "unknown",
  "clientMessageId?": "unknown",
  "links?": "unknown",
  "sessions?": "unknown",
  "images?": "unknown",
  "targetSessionId?": "unknown",
  "notifyOnCompletion?": "unknown",
  // Undocumented escape hatch — discovery is via the queue-full 400 error text only.
  "overflow?": "unknown",
  "+": "reject",
});
export const replyBodyKeys = arktype({ "text?": "unknown", "+": "reject" });

export function rejectUnknownKeys(body: unknown, res: Response, schema: Type): boolean {
  const result = schema(body ?? {});
  if (result instanceof arktype.errors) {
    res.status(400).json({ error: result.summary });
    return true;
  }
  return false;
}

export function rejectFields(
  body: unknown,
  res: Response,
  {
    unsupported,
    allowed,
  }: {
    unsupported: Array<{ key: string; message: string }>;
    allowed: Type;
  },
): boolean {
  return rejectUnsupportedFields(body, res, unsupported) || rejectUnknownKeys(body, res, allowed);
}

export function normalizeClientMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(trimmed)) return null;
  return trimmed;
}
