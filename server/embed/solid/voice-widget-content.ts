import type { VoiceWidgetMessage, VoiceWidgetMessagesPayload } from "./voice-widget-parse-json.ts";

export const VOICE_WIDGET_NOTE_LIMIT = 30;
export const SAY_TO_ME_UI_URL = "https://say.localhost:1311";
export const SAY_TO_ME_USAGE_PROMPT = "Tell your agent how to use Say To Me";
const MUTED_FOREGROUND_CLASS = ["text", "muted", "foreground"].join("-");

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Attachment JSON is intentionally projected only through the safe thumbnail fields below.
type AttachmentPayload = Record<string, unknown>;

export type VoiceWidgetLink = {
  readonly href: string;
  readonly target: "_blank";
  readonly rel: "noreferrer" | "noopener noreferrer";
};
export type VoiceWidgetUiBaseUrl = string | null | undefined;
export type VoiceWidgetStatusPresentation = { readonly label: string; readonly className: string };

export type VoiceWidgetRevisionDecision = {
  readonly accepted: boolean;
  readonly revision: number;
};

/**
 * Apply the banner's revision gate without applying any payload side effects.
 * Missing and non-integer revisions are accepted and do not advance the gate;
 * integer revisions accept equal/newer values and reject only older values.
 */
export function decideVoiceWidgetRevision(
  lastRevision: number,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  payloadRevision: unknown,
): VoiceWidgetRevisionDecision {
  if (typeof payloadRevision !== "number" || !Number.isInteger(payloadRevision)) {
    return { accepted: true, revision: lastRevision };
  }
  if (payloadRevision < lastRevision) {
    return { accepted: false, revision: lastRevision };
  }
  return { accepted: true, revision: payloadRevision };
}

export type VoiceWidgetStatus = "queued" | "speaking" | "played" | "stopped";
export function voiceWidgetUsagePrompt(sessionId: string): string {
  return (
    "you have to reply to my messages with voice (cli `say-to-me usage` to learn how/why) and your session id is " +
    sessionId
  );
}

function resolveUiBaseUrl(uiBaseUrl: VoiceWidgetUiBaseUrl = SAY_TO_ME_UI_URL): string | null {
  if (uiBaseUrl === null || uiBaseUrl.trim() === "") return null;
  try {
    const url = new URL(uiBaseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function sayToMeSessionUrl(
  sessionId: string,
  uiBaseUrl?: VoiceWidgetUiBaseUrl,
): string | null {
  const baseUrl = resolveUiBaseUrl(uiBaseUrl);
  return baseUrl ? `${baseUrl}/ses/${encodeURIComponent(sessionId)}` : null;
}

export function sayToMeSessionLink(
  sessionId: string,
  uiBaseUrl?: VoiceWidgetUiBaseUrl,
): VoiceWidgetLink | null {
  const href = sayToMeSessionUrl(sessionId, uiBaseUrl);
  return href ? { href, target: "_blank", rel: "noreferrer" } : null;
}

export function sayToMeTitleUrl(
  sessionId: string,
  sessionState: string,
  uiBaseUrl?: VoiceWidgetUiBaseUrl,
): string | null {
  const baseUrl = resolveUiBaseUrl(uiBaseUrl);
  return baseUrl
    ? sessionState === "missing"
      ? baseUrl
      : sayToMeSessionUrl(sessionId, baseUrl)
    : null;
}

export function sayToMeAttachmentUrl(
  attachmentId: number,
  uiBaseUrl?: VoiceWidgetUiBaseUrl,
): string | null {
  const baseUrl = resolveUiBaseUrl(uiBaseUrl);
  return baseUrl
    ? `${baseUrl}/api/message-attachments/${encodeURIComponent(String(attachmentId))}`
    : null;
}

export function sayToMeAttachmentLink(
  attachmentId: number,
  uiBaseUrl?: VoiceWidgetUiBaseUrl,
): VoiceWidgetLink | null {
  const href = sayToMeAttachmentUrl(attachmentId, uiBaseUrl);
  return href ? { href, target: "_blank", rel: "noopener noreferrer" } : null;
}
export function voiceWidgetSessionDisplayName(session: {
  readonly id: string;
  readonly alias?: string | null;
  readonly title?: string | null;
}): string {
  return session.alias?.trim() || session.title?.trim() || session.id;
}
export function voiceWidgetWaitingLabel(waitingState: string | null | undefined): string {
  switch (waitingState) {
    case "working":
      return "Working";
    case "needs_answer":
      return "Needs answer";
    case "can_continue":
      return "Idle";
    default:
      return waitingState?.replaceAll("_", " ") || "Unknown";
  }
}
export function voiceWidgetWaitingClass(waitingState: string | null | undefined): string {
  switch (waitingState) {
    case "working":
      return "bg-amber-500/15 text-amber-700";
    case "needs_answer":
      return "bg-sky-500/15 text-sky-700";
    case "can_continue":
      return "bg-emerald-500/15 text-emerald-700";
    default:
      return "bg-muted " + MUTED_FOREGROUND_CLASS;
  }
}
export function voiceWidgetStatusPresentation(status: string): VoiceWidgetStatusPresentation {
  switch (status) {
    case "queued":
      return { label: status, className: "bg-amber-500/15 text-amber-700" };
    case "speaking":
      return { label: status, className: "bg-sky-500/15 text-sky-700" };
    case "played":
      return {
        label: status,
        className: "bg-emerald-500/15 text-emerald-700",
      };
    case "stopped":
      return { label: status, className: "bg-rose-500/15 text-rose-700" };
    default:
      return { label: status, className: "bg-muted/70 " + MUTED_FOREGROUND_CLASS };
  }
}

export type VoiceWidgetNote = {
  readonly id: string;
  readonly author: string;
  readonly time: string;
  readonly text: string;
  readonly extraMarkdown: string | null;
  readonly extraMarkdownHtml: string | null;
  readonly status: string;
  readonly attachments: ReadonlyArray<unknown>;
  readonly sessions: ReadonlyArray<unknown>;
};

const SAY_TO_ME_SQL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/** Say To Me returns SQLite UTC timestamps without an offset. */
export function normalizeVoiceWidgetTimestamp(timestamp: string): string {
  const trimmed = timestamp.trim();
  return SAY_TO_ME_SQL_TIMESTAMP_RE.test(trimmed) ? `${trimmed.replace(" ", "T")}Z` : trimmed;
}

/** Render voice-note timestamps in the browser's local timezone. */
export function formatSayToMeTimestamp(timestamp: string): string {
  const date = new Date(normalizeVoiceWidgetTimestamp(timestamp));
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function isSafeThumbnailDataUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value.trim());
}

/** Return only safe image thumbnails, preserving the banner's trimmed URL. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
export function imageAttachmentThumbnail(attachment: unknown): string | null {
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return null;
  const row = attachment as AttachmentPayload;
  if (typeof row.mimeType !== "string" || !row.mimeType.startsWith("image/")) return null;
  if (typeof row.thumbnailDataUrl !== "string") return null;
  const thumbnail = row.thumbnailDataUrl.trim();
  return thumbnail && isSafeThumbnailDataUrl(thumbnail) ? thumbnail : null;
}

/** Preserve banner status strings while identifying the four speech states. */
export function normalizeVoiceWidgetStatus(status: string): VoiceWidgetStatus | null {
  switch (status) {
    case "queued":
    case "speaking":
    case "played":
    case "stopped":
      return status;
    default:
      return null;
  }
}

/** Notes arrive oldest-first; the banner keeps the newest 30 and displays newest-first. */
export function projectVoiceWidgetNotes(
  payload: VoiceWidgetMessagesPayload,
): ReadonlyArray<VoiceWidgetNote> {
  return payload.messages
    .slice(-VOICE_WIDGET_NOTE_LIMIT)
    .slice()
    .toReversed()
    .map((rawMessage) => {
      const message = rawMessage as VoiceWidgetMessage;
      return {
        id: String(message.id),
        author: message.author as string,
        time: message.createdAt as string,
        text: message.text as string,
        extraMarkdown: (message.extraMarkdown ?? null) as string | null,
        extraMarkdownHtml: (message.extraMarkdownHtml ?? null) as string | null,
        status: message.status as string,
        attachments: (message.attachments ?? []) as ReadonlyArray<unknown>,
        sessions: (message.sessions ?? []) as ReadonlyArray<unknown>,
      };
    });
}
