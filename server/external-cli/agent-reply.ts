import { insertMessageRow } from "../messages.ts";

/** Voice reply + idle notification ding used by external CLI agent backends. */
export function insertExternalAgentReply(sessionId: string, text: string): void {
  insertMessageRow({
    sessionId,
    text: `<say-to-me-system>${sessionId} is idle now</say-to-me-system>`,
    extraMarkdown: text,
    author: "agent",
    status: "queued",
    links: null,
    sessionRefs: null,
    clientMessageId: null,
  });
}
