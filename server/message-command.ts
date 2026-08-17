import { type as arktype } from "arktype";
import { Effect } from "effect";
import { extractLeadingSessionMessage } from "../src/session-mentions.ts";
import type { SessionReferenceInput } from "./messages.ts";
import { detectSessionBackend, normalizeSessionId } from "./session-id.ts";

// Session references (cards) and forward targets work for agent-backed
// sessions — OpenCode (`ses_`) or an external CLI provider. Voice-only (`vo_`)
// is local playback: direct messages are fine, but forwarding would create a
// completion watch that can never resolve (no delivery / work status).
function isReferenceableSessionId(sessionId: string): boolean {
  const backend = detectSessionBackend(sessionId);
  return backend !== "none" && backend !== "voice";
}
import {
  hasFullGitSha,
  hasInlineHttpsLink,
  hasRawSessionId,
  hasTooManySpelledNumberWords,
  normalizeClientMessageId,
  sessionMessageBodyKeys,
  SPELLED_NUMBER_WORDS_ERROR,
} from "./validation.ts";
import { maxMessageLength, maxUserMessageLength, minMessageLength } from "./config.ts";

export type MessageCommandValidationError = {
  error: string;
  status: number;
};

export type DirectMessageCommand = {
  type: "direct";
  author: "agent" | "user";
  clientMessageId: string | null;
  extraMarkdown: string | null;
  pushNotificationText: string | null;
  images: string[] | undefined;
  links: string[] | null;
  notifyOnCompletion: boolean;
  overflow: "force" | null;
  sessionId: string;
  sessionRefs: SessionReferenceInput[] | null;
  text: string;
  useCli: boolean;
  forceOpencode: boolean;
};

export type ForwardMessageCommand = {
  type: "forward";
  author: "user";
  clientMessageId: string | null;
  extraMarkdown: string | null;
  leadingRelay: { session: { alias: string | null; id: string }; text: string } | null;
  notifyOnCompletion: boolean;
  sessionId: string;
  targetSessionId: string;
  text: string;
  useCli: boolean;
  forceOpencode: boolean;
};

export type MessageCreateCommand = DirectMessageCommand | ForwardMessageCommand;

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- sessionMessageBodyKeys first rejects unknown keys, then this parser validates every supported field.
type MessageCommandBody = Record<string, unknown>;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function normalizeSessionReference(item: unknown): SessionReferenceInput | null {
  if (typeof item === "string") return { id: item, alias: null };
  if (!item || typeof item !== "object") return null;
  const record = item as { alias?: unknown; id?: unknown };
  if (typeof record.id !== "string") return null;
  const rawAlias = record.alias;
  if (rawAlias != null && typeof rawAlias !== "string") return null;
  const alias = rawAlias?.trim() || null;
  return { id: record.id, alias };
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function normalizeSessionReferences(rawSessions: unknown): SessionReferenceInput[] | null {
  if (rawSessions == null) return null;
  if (!Array.isArray(rawSessions)) return null;
  const refs = rawSessions.map(normalizeSessionReference);
  return refs.every((ref) => ref != null) ? refs : null;
}

function validateSessionReferenceAliases(refs: SessionReferenceInput[] | null): string | null {
  for (const ref of refs ?? []) {
    if (!ref.alias) continue;
    if (ref.alias.length > 80) return "Session aliases must be 80 characters or fewer.";
    if (/[\r\n]/.test(ref.alias)) return "Session aliases must be a single line.";
  }
  return null;
}

function validationError(error: string): MessageCommandValidationError {
  return { error, status: 400 };
}

function validateTextValue(
  text: string,
  {
    allowEmpty = false,
    maxLength = maxMessageLength(),
  }: { allowEmpty?: boolean; maxLength?: number } = {},
): MessageCommandValidationError | null {
  const minLength = minMessageLength();
  if (!allowEmpty && text.length < minLength) {
    return validationError(
      `Message is too short. Minimum length is ${minLength} character${minLength === 1 ? "" : "s"}.`,
    );
  }
  if (text.length > maxLength) {
    return validationError(`Message is too long. Maximum length is ${maxLength} characters.`);
  }
  return null;
}

export function buildSessionMessageCommand({
  body,
  rawSessionId,
}: {
  body: unknown;
  rawSessionId: string | null | undefined;
}): Effect.Effect<MessageCreateCommand, MessageCommandValidationError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) return yield* Effect.fail(validationError("Invalid session id."));

    const parsedKeys = sessionMessageBodyKeys(body ?? {});
    if (parsedKeys instanceof arktype.errors) {
      return yield* Effect.fail(validationError(parsedKeys.summary));
    }

    const record = body && typeof body === "object" ? (body as MessageCommandBody) : {};
    const rawText = typeof record.text === "string" ? record.text.trim() : "";
    const rawExtraMarkdown = record.extraMarkdown;
    const extraMarkdown = typeof rawExtraMarkdown === "string" ? rawExtraMarkdown.trim() : null;
    const rawPushNotificationText = record.pushNotificationText;
    const pushNotificationText =
      typeof rawPushNotificationText === "string" ? rawPushNotificationText.trim() || null : null;
    const rawAuthor = record.author;
    const author = rawAuthor === "agent" || rawAuthor === "user" ? rawAuthor : null;
    const useCli = record.useCli === true;
    const forceOpencode = record.forceOpencode === true;
    const overflow = record.overflow === "force" ? ("force" as const) : null;
    const clientMessageId = normalizeClientMessageId(record.clientMessageId);
    const rawTargetSessionId = record.targetSessionId;
    const explicitTargetSessionId =
      typeof rawTargetSessionId === "string" ? normalizeSessionId(rawTargetSessionId) : null;
    const leadingRelay =
      explicitTargetSessionId || author !== "user" ? null : extractLeadingSessionMessage(rawText);
    const targetSessionId = explicitTargetSessionId ?? leadingRelay?.session.id ?? null;
    const text = leadingRelay ? leadingRelay.text : rawText;
    const notifyOnCompletion = targetSessionId
      ? record.notifyOnCompletion !== false
      : record.notifyOnCompletion === true;
    const rawLinks = record.links;
    const linksValid =
      rawLinks == null ||
      (Array.isArray(rawLinks) && rawLinks.every((link) => typeof link === "string"));
    const links = Array.isArray(rawLinks) && linksValid ? rawLinks : null;
    const rawSessions = record.sessions;
    const sessionRefs = normalizeSessionReferences(rawSessions);
    const sessionsValid = rawSessions == null || sessionRefs != null;
    const rawImages = record.images;
    const imagesValid =
      rawImages == null ||
      (Array.isArray(rawImages) && rawImages.every((image) => typeof image === "string"));
    const images = Array.isArray(rawImages) && imagesValid ? rawImages : undefined;

    if (rawAuthor == null) {
      return yield* Effect.fail(
        validationError('Message author is required. Set author to "agent" or "user".'),
      );
    }
    if (!author) {
      return yield* Effect.fail(validationError('Message author must be "agent" or "user".'));
    }
    if (
      rawTargetSessionId != null &&
      (!explicitTargetSessionId || !isReferenceableSessionId(explicitTargetSessionId))
    ) {
      return yield* Effect.fail(validationError("Invalid target session id."));
    }
    // Leading say-to-me(...) relays also resolve to targetSessionId — reject voice/none.
    if (targetSessionId && !isReferenceableSessionId(targetSessionId)) {
      return yield* Effect.fail(validationError("Invalid target session id."));
    }
    if (targetSessionId && targetSessionId === sessionId) {
      return yield* Effect.fail(validationError("Cannot forward a message to the same session."));
    }
    if (!linksValid) {
      return yield* Effect.fail(validationError("Links must be an array of strings."));
    }
    if (!sessionsValid) {
      return yield* Effect.fail(
        validationError("Sessions must be an array of session ids or objects."),
      );
    }
    if (sessionRefs && !sessionRefs.every((ref) => isReferenceableSessionId(ref.id))) {
      return yield* Effect.fail(validationError("Sessions must be valid session ids."));
    }
    const sessionAliasError = validateSessionReferenceAliases(sessionRefs);
    if (sessionAliasError) return yield* Effect.fail(validationError(sessionAliasError));
    if (rawExtraMarkdown != null && typeof rawExtraMarkdown !== "string") {
      return yield* Effect.fail(validationError("Extra markdown must be a string."));
    }
    if (rawPushNotificationText != null && typeof rawPushNotificationText !== "string") {
      return yield* Effect.fail(validationError("Push notification text must be a string."));
    }
    if (rawPushNotificationText != null && author !== "agent") {
      return yield* Effect.fail(
        validationError("Push notification text is only allowed on agent messages."),
      );
    }
    if (!imagesValid) {
      return yield* Effect.fail(validationError("Images must be an array of file paths."));
    }
    if (targetSessionId && (images?.length ?? 0) > 0) {
      return yield* Effect.fail(validationError("Forwarded messages do not support images yet."));
    }

    const textError = validateTextValue(text, {
      allowEmpty: (images?.length ?? 0) > 0,
      maxLength: author === "user" ? maxUserMessageLength() : maxMessageLength(),
    });
    if (textError) return yield* Effect.fail(textError);
    if (extraMarkdown != null) {
      const extraMarkdownError = validateTextValue(extraMarkdown, {
        allowEmpty: true,
        maxLength: maxMessageLength(),
      });
      if (extraMarkdownError) return yield* Effect.fail(extraMarkdownError);
    }
    if (pushNotificationText != null) {
      const pushNotificationTextError = validateTextValue(pushNotificationText, {
        allowEmpty: true,
        maxLength: maxMessageLength(),
      });
      if (pushNotificationTextError) return yield* Effect.fail(pushNotificationTextError);
    }
    if (author === "agent" && hasInlineHttpsLink(text)) {
      return yield* Effect.fail(
        validationError(
          "Message text contains a link. Use the links field instead. Run `say-to-me usage` for supported fields.",
        ),
      );
    }
    if (author === "agent" && hasRawSessionId(text)) {
      return yield* Effect.fail(
        validationError(
          "Message text contains a raw session id. Use the sessions field instead. Run `say-to-me usage` for supported fields.",
        ),
      );
    }
    if (author === "agent" && hasFullGitSha(text)) {
      return yield* Effect.fail(
        validationError(
          "Message text contains a full git SHA. Use the links field or extraMarkdown instead. Run `say-to-me usage` for supported fields.",
        ),
      );
    }
    if (author === "agent" && hasTooManySpelledNumberWords(text)) {
      return yield* Effect.fail(validationError(SPELLED_NUMBER_WORDS_ERROR));
    }
    if (record.clientMessageId != null && !clientMessageId) {
      return yield* Effect.fail(validationError("Invalid client message id."));
    }
    if (record.notifyOnCompletion != null && typeof record.notifyOnCompletion !== "boolean") {
      return yield* Effect.fail(validationError("Notify on completion must be a boolean."));
    }

    if (targetSessionId) {
      return {
        author: "user",
        clientMessageId,
        extraMarkdown,
        leadingRelay,
        notifyOnCompletion,
        sessionId,
        targetSessionId,
        text,
        type: "forward",
        useCli,
        forceOpencode,
      } satisfies ForwardMessageCommand;
    }

    return {
      author,
      clientMessageId,
      extraMarkdown,
      pushNotificationText,
      images,
      links,
      notifyOnCompletion,
      overflow,
      sessionId,
      sessionRefs,
      text,
      type: "direct",
      useCli,
      forceOpencode,
    } satisfies DirectMessageCommand;
  });
}
