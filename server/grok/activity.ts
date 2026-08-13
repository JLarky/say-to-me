// Derive a lightweight activity view from a Grok agent session's JSONL
// transcript. Pure over the file contents so it is unit-testable; the file read
// lives in the route. This is a snapshot (poll), not the live OpenCode hub.

import { type as arktype } from "arktype";
import {
  textFromContent,
  toolSummary,
  type Activity as GrokActivity,
  type ActivityItem as GrokActivityItem,
  type ActivityKind as GrokActivityKind,
} from "../external-cli/activity-parsing.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

export type { GrokActivity, GrokActivityItem, GrokActivityKind };

const GrokSummaryItem = arktype({
  "type?": "string",
  "text?": "string",
});

const GrokToolCall = arktype({
  "name?": "string",
  "arguments?": "unknown",
});

const GrokContentBlock = arktype({
  "type?": "string",
  "text?": "string",
  "name?": "string",
  "input?": "unknown",
  "thinking?": "string",
});

const GrokTranscriptLine = arktype({
  "type?": "string",
  "timestamp?": "string",
  "role?": "string",
  "content?": "unknown",
  "tool_calls?": [GrokToolCall, "[]"],
  "message?": { "content?": "unknown" },
  "summary?": [GrokSummaryItem, "[]"],
});

export function parseGrokActivity(jsonl: string, limit: number): GrokActivity {
  const items: GrokActivityItem[] = [];
  let lastTimestamp: number | null = null;

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const raw = safeJsonParse(UnknownJson, trimmed);
    if (raw === null) continue;
    const parsed = GrokTranscriptLine(raw);
    if (parsed instanceof arktype.errors) continue;
    const entry = parsed;

    const parsedTs = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    const timestamp = Number.isNaN(parsedTs) ? null : parsedTs;
    if (timestamp !== null) lastTimestamp = timestamp;

    // Top-level reasoning (common in current grok transcripts): extract summary texts as thinking
    if (entry.type === "reasoning" && entry.summary) {
      for (const s of entry.summary) {
        if (s.type === "summary_text" && typeof s.text === "string" && s.text.trim()) {
          items.push({ kind: "thinking", text: s.text.trim(), timestamp });
        }
      }
    }

    // Grok format uses top-level "type", content can be string or array
    const isAssistant = entry.type === "assistant" || entry.role === "assistant";
    if (!isAssistant) continue;

    // Top-level tool_calls (current grok-build style): content often "", actions here
    if (entry.tool_calls) {
      for (const tc of entry.tool_calls) {
        if (typeof tc.name === "string") {
          items.push({
            kind: "tool",
            tool: tc.name,
            text: toolSummary(tc.name, tc.arguments),
            timestamp,
          });
        }
      }
    }

    let content = entry.content ?? entry.message?.content;
    if (typeof content === "string") {
      const text = content.trim();
      if (text) {
        items.push({ kind: "message", text, timestamp });
      }
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const rawBlock of content) {
      const b = GrokContentBlock(rawBlock);
      if (b instanceof arktype.errors) continue;
      if ((b.type === "text" || !b.type) && typeof b.text === "string" && b.text.trim()) {
        items.push({ kind: "message", text: b.text.trim(), timestamp });
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        items.push({
          kind: "tool",
          tool: b.name,
          text: toolSummary(b.name, b.input),
          timestamp,
        });
      } else if (
        (b.type === "thinking" || b.type === "reasoning") &&
        typeof b.thinking === "string" &&
        b.thinking.trim()
      ) {
        items.push({ kind: "thinking", text: b.thinking.trim(), timestamp });
      }
    }
  }

  // Fallback for very old/simple formats
  if (items.length === 0) {
    for (const line of jsonl.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const raw = safeJsonParse(UnknownJson, trimmed);
      if (raw === null) continue;
      const parsed = GrokTranscriptLine(raw);
      if (parsed instanceof arktype.errors) continue;
      const entry = parsed;
      const isAssistant = entry.type === "assistant" || entry.role === "assistant";
      if (!isAssistant) continue;
      const c = entry.content ?? entry.message?.content;
      const text = typeof c === "string" ? c.trim() : textFromContent(c);
      if (text) items.push({ kind: "message", text, timestamp: null });
    }
  }

  return { items: items.slice(-limit), lastTimestamp };
}
