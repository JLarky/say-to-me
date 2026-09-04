import { isIdleNoticeText } from "@say-to-me/session-utils/idle-notices";
import { speechTextWithAgentNames } from "./paseo-mentions.ts";
import { resolveListDisplayName } from "./session-display.ts";
import type { Message, Session } from "./types.ts";
import type { AgentReplyMode } from "./utils.ts";

export {
  buildPaseoAgentNameMap,
  resolvePaseoAgentLabel,
  shortPaseoAgentId,
  speechTextWithAgentNames,
  splitTextWithPaseoMentions,
  uniquePaseoMentionsInText,
} from "./paseo-mentions.ts";

export function paseoChatListenerStatus(
  session: Pick<Session, "backend" | "state"> | null | undefined,
): { active: boolean; label: string } | null {
  if (session?.backend !== "paseo-chat") return null;
  if (session.state === "archived") {
    return { active: false, label: "Paseo chat listening paused (archived)" };
  }
  return { active: true, label: "Paseo chat listening" };
}

export function shouldShushPlayback(
  agentReplyMode: AgentReplyMode,
  { respectShush = false }: { respectShush?: boolean } = {},
): boolean {
  return respectShush && agentReplyMode === "shush";
}

export function sessionIdWithDisplayName(
  sessionId: string | undefined,
  alias: string | null | undefined,
): string | undefined {
  if (!sessionId) return undefined;
  const displayName = alias?.trim();
  return displayName ? `${sessionId} ${displayName}` : sessionId;
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length <= 9 ? sessionId : `${sessionId.slice(0, 7)}...${sessionId.slice(-2)}`;
}

const preferredBrowserSpeechVoiceNames = [
  "Microsoft Emma Online (Natural) - English (United States)",
  "Google US English",
];

export function preferredBrowserSpeechVoice<T extends { name: string; lang?: string }>(
  voices: readonly T[],
): T | null {
  for (const name of preferredBrowserSpeechVoiceNames) {
    const voice = voices.find((candidate) => candidate.name === name);
    if (voice) return voice;
  }
  return null;
}

/** Prefer speech-friendly text for browser TTS (idle notices + agent mentions). */
export function browserSpeechText(
  message: Pick<Message, "text" | "sessions">,
  namesByAgentId?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): string {
  if (isIdleNotificationMessage(message as Message)) {
    return idleNotificationSpeechText(message as Message);
  }
  // Always rewrite @uuid mentions: name if known, else Paseo short id (7 chars).
  return speechTextWithAgentNames(message.text, namesByAgentId);
}

export function isIdleNotificationMessage(message: Message): boolean {
  if (message.routineEvent?.kind === "watcher_completed") return true;
  return isIdleNoticeText(message.text);
}

export function idleNotificationSpeechText(message: Message): string {
  if (message.routineEvent?.reason === "failed") {
    return "Your relay could not be delivered.";
  }
  const idleSessionId =
    message.routineEvent?.targetSessionId ??
    message.text.match(/^<say-to-me-system>([\s\S]*?) is idle now/)?.[1]?.trim() ??
    message.sessions?.find((session) => session.id !== message.sessionId)?.id ??
    message.sessions?.[0]?.id;
  const idleSession = idleSessionId
    ? message.sessions?.find((session) => session.id === idleSessionId)
    : undefined;
  const idleSessionName = idleSession
    ? resolveListDisplayName({
        id: idleSession.id,
        alias: idleSession.alias,
        opencodeTitle: idleSession.title,
      })
    : idleSessionId;
  return idleSessionName ? `${idleSessionName} is now idle` : "Session is now idle";
}

export function shouldAutoplayMessage(
  message: Message,
  queuedIdleNotificationIds: ReadonlySet<Message["id"]>,
): boolean {
  if (message.author === "agent" && message.status === "queued") return true;
  return (
    isIdleNotificationMessage(message) &&
    message.status === "received" &&
    queuedIdleNotificationIds.has(message.id)
  );
}

export const idleNotificationSpeakingMs = 1_000;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SessionMessageRequestBody = {
  author: Message["author"];
  text: string;
  useCli: Message["useCli"];
  clientMessageId: string;
  forceOpencode?: boolean;
  notifyOnCompletion?: boolean;
  targetSessionId?: string;
  images?: string[];
};

export function sessionMessageRequestBody(pendingMessage: Message): SessionMessageRequestBody {
  const body: SessionMessageRequestBody = {
    author: pendingMessage.author,
    text: pendingMessage.text,
    useCli: pendingMessage.useCli,
    clientMessageId: String(pendingMessage.id),
  };
  if (pendingMessage.forceOpencode) body.forceOpencode = true;
  if (typeof pendingMessage.notifyOnCompletion === "boolean") {
    body.notifyOnCompletion = pendingMessage.notifyOnCompletion;
  }
  if (pendingMessage.targetSessionId) body.targetSessionId = pendingMessage.targetSessionId;
  if (pendingMessage.images) body.images = pendingMessage.images;
  return body;
}
