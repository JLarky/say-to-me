import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";
import {
  formatContinueAttributionLine,
  formatIdleContinueBody,
  isAttributedIdleStoredText,
  isFailedRelayNoticeText,
  isIdleContinueNoticeText,
  parseMessageCreatedAt,
} from "@say-to-me/session-utils/idle-notices";
import {
  resolveAgentCliServerUrl,
  type ResolveWorkerInternalUrlOptions,
} from "./external-cli/worker-internal-url.ts";

export const USER_CONTINUE_HEADER =
  "you have to reply to this message with voice (cli `say-to-me usage` to learn how/why)";

export const IDLE_CONTINUE_HEADER =
  "you got idle notification (cli `say-to-me usage jarvis` to learn when they happen)";

export type VoicePromptMessage = {
  text: string;
  createdAt?: string | null;
  sessionId?: string | null;
  sessionRefs?: string | null;
  forwardRole?: string | null;
  forwardSourceSessionId?: string | null;
  forwardTargetSessionId?: string | null;
};

export type AgentVoicePromptPart = {
  body: string;
  kind?: "user" | "idle";
  at?: Date | string | number;
  targetSessionId?: string | null;
  targetAlias?: string | null;
};

export type BuildAgentVoicePromptOptions = ResolveWorkerInternalUrlOptions & {
  kind?: "user" | "idle";
  at?: Date | string | number;
  now?: Date;
  timeZone?: string;
  targetSessionId?: string | null;
  targetAlias?: string | null;
  lookupAlias?: (sessionId: string) => string | null | undefined;
};

type IdleSessionRef = { id: string; alias?: string | null };

export function parseVoicePromptSessionRefs(
  sessionRefs: string | null | undefined,
): IdleSessionRef[] {
  if (!sessionRefs) return [];
  const parsed = safeJsonParse(UnknownJson, sessionRefs);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): IdleSessionRef[] => {
    if (typeof item === "string") return [{ id: item }];
    if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
      const alias = "alias" in item && typeof item.alias === "string" ? item.alias : null;
      return [{ id: item.id, alias }];
    }
    return [];
  });
}

export function idleTargetFromMessage(
  recipientId: string,
  message: VoicePromptMessage,
): IdleSessionRef | null {
  const refs = parseVoicePromptSessionRefs(message.sessionRefs);
  const other = refs.find((ref) => ref.id !== recipientId) ?? refs[0];
  if (other?.id) return other;
  if (message.forwardRole === "source" && message.forwardTargetSessionId) {
    return { id: message.forwardTargetSessionId };
  }
  if (
    message.forwardRole === "target" &&
    message.forwardSourceSessionId &&
    message.forwardSourceSessionId !== recipientId
  ) {
    return { id: message.forwardSourceSessionId };
  }
  return null;
}

function isolatedServerLine(options?: ResolveWorkerInternalUrlOptions): string {
  const server = resolveAgentCliServerUrl(options);
  return server
    ? `\nThis session requires \`say-to-me api --server ${server}\` on every call. Otherwise it will use port 5411.`
    : "";
}

function resolveKind(body: string, kind?: "user" | "idle"): "user" | "idle" {
  if (kind) return kind;
  if (isFailedRelayNoticeText(body)) return "user";
  if (isIdleContinueNoticeText(body)) return "idle";
  return "user";
}

function resolveAlias(
  targetSessionId: string | null | undefined,
  targetAlias: string | null | undefined,
  lookupAlias?: (sessionId: string) => string | null | undefined,
): string | null {
  const explicit = targetAlias?.trim();
  if (explicit) return explicit;
  if (!targetSessionId || !lookupAlias) return null;
  return lookupAlias(targetSessionId)?.trim() || null;
}

function resolveAt(part: AgentVoicePromptPart, options?: BuildAgentVoicePromptOptions): Date {
  if (part.at != null) return parseMessageCreatedAt(part.at);
  if (options?.at != null) return parseMessageCreatedAt(options.at);
  return options?.now ?? new Date();
}

function formatPartBody(
  recipientId: string,
  part: AgentVoicePromptPart,
  options?: BuildAgentVoicePromptOptions,
): string {
  const kind = resolveKind(part.body, part.kind ?? options?.kind);
  if (kind === "idle" && isAttributedIdleStoredText(part.body)) {
    return part.body.trim();
  }
  const at = resolveAt(part, options);
  let body = part.body;
  if (kind === "idle") {
    const targetSessionId = part.targetSessionId ?? options?.targetSessionId;
    if (targetSessionId) {
      body = formatIdleContinueBody(
        targetSessionId,
        resolveAlias(
          targetSessionId,
          part.targetAlias ?? options?.targetAlias,
          options?.lookupAlias,
        ),
      );
    }
  }
  return formatContinueAttributionLine(recipientId, body, at, options?.timeZone);
}

export function buildAgentVoicePrompt(
  sessionId: string,
  body: string | AgentVoicePromptPart | AgentVoicePromptPart[],
  options?: BuildAgentVoicePromptOptions,
): string {
  const parts: AgentVoicePromptPart[] = Array.isArray(body)
    ? body
    : typeof body === "string"
      ? [
          {
            body,
            kind: options?.kind,
            at: options?.at,
            targetSessionId: options?.targetSessionId,
            targetAlias: options?.targetAlias,
          },
        ]
      : [body];
  const kinds = parts.map((part) => resolveKind(part.body, part.kind ?? options?.kind));
  const header =
    kinds.length > 0 && kinds.every((kind) => kind === "idle")
      ? IDLE_CONTINUE_HEADER
      : USER_CONTINUE_HEADER;
  const attributed = parts.map((part) => formatPartBody(sessionId, part, options)).join("\n");
  return `${header}${isolatedServerLine(options)}\n\n${attributed}`;
}

export function buildAgentVoicePromptFromMessage(
  sessionId: string,
  message: VoicePromptMessage,
  options?: BuildAgentVoicePromptOptions,
): string {
  const target = idleTargetFromMessage(sessionId, message);
  return buildAgentVoicePrompt(
    sessionId,
    {
      body: message.text,
      at: message.createdAt ?? undefined,
      targetSessionId: target?.id,
      targetAlias: target?.alias,
    },
    options,
  );
}
