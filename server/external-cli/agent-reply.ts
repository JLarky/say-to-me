import { insertMessageRow } from "../messages.ts";
import { TARGET_IDLE_NOTICE_TEXT } from "@say-to-me/session-utils/idle-notices";

/** Voice reply + idle notification ding used by external CLI agent backends. */
export function insertExternalAgentReply(sessionId: string, text: string): void {
  insertMessageRow({
    sessionId,
    text: TARGET_IDLE_NOTICE_TEXT,
    extraMarkdown: text,
    author: "agent",
    status: "queued",
    links: null,
    sessionRefs: JSON.stringify([{ id: sessionId }]),
    clientMessageId: null,
  });
}
