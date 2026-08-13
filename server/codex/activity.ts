// Derive a lightweight activity view from a Codex rollout JSONL transcript.
// Pure over file contents; the file read lives in the route.

import {
  parseTimestamp,
  toolSummary,
  type Activity as CodexActivity,
  type ActivityItem as CodexActivityItem,
  type ActivityKind as CodexActivityKind,
} from "../external-cli/activity-parsing.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

export type { CodexActivity, CodexActivityItem, CodexActivityKind };

function textFromAssistantContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts = content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const candidate = block as { type?: unknown; text?: unknown };
    if (candidate.type === "output_text" && typeof candidate.text === "string")
      return [candidate.text];
    if (candidate.type === "text" && typeof candidate.text === "string") return [candidate.text];
    return [];
  });
  const text = parts.join("\n").trim();
  return text || null;
}

export function parseCodexActivity(jsonl: string, limit: number): CodexActivity {
  const items: CodexActivityItem[] = [];
  let lastTimestamp: number | null = null;

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = safeJsonParse(UnknownJson, trimmed) as {
      type?: unknown;
      timestamp?: unknown;
      payload?: Record<string, unknown>;
    } | null;
    if (!entry) continue;
    const timestamp = parseTimestamp(entry.timestamp);
    if (timestamp !== null) lastTimestamp = timestamp;

    const payload = entry.payload;
    if (!payload || typeof payload !== "object") continue;

    if (entry.type === "event_msg" && payload.type === "agent_message") {
      const message = payload.message;
      if (typeof message === "string" && message.trim()) {
        items.push({
          kind: payload.phase === "commentary" ? "thinking" : "message",
          text: message.trim(),
          timestamp,
        });
      }
      continue;
    }

    if (entry.type !== "response_item") continue;

    const payloadType = payload.type;
    if (payloadType === "message" && payload.role === "assistant") {
      const text = textFromAssistantContent(payload.content);
      if (text) items.push({ kind: "message", text, timestamp });
      continue;
    }

    if (payloadType === "function_call" && typeof payload.name === "string") {
      items.push({
        kind: "tool",
        tool: payload.name,
        text: toolSummary(payload.name, payload.arguments),
        timestamp,
      });
      continue;
    }

    if (payloadType === "web_search_call") {
      const action =
        payload.action && typeof payload.action === "object"
          ? (payload.action as Record<string, unknown>)
          : null;
      const query = action && typeof action.query === "string" ? action.query : "search";
      items.push({
        kind: "tool",
        tool: "web_search",
        text: toolSummary("web_search", { query }),
        timestamp,
      });
    }
  }

  return { items: items.slice(-limit), lastTimestamp };
}
