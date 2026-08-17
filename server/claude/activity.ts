// Derive a lightweight activity view from a Claude Code session's JSONL
// transcript. Pure over the file contents so it is unit-testable; the file read
// lives in the route. This is a snapshot (poll), not the live OpenCode hub.

import {
  toolSummary,
  type Activity as ClaudeActivity,
  type ActivityItem as ClaudeActivityItem,
  type ActivityKind as ClaudeActivityKind,
} from "../external-cli/activity-parsing.ts";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";

export type { ClaudeActivity, ClaudeActivityItem, ClaudeActivityKind };

const ClaudeTranscriptBlock = arktype({
  "type?": "string",
  "text?": "string",
  "name?": "string",
  "input?": "unknown",
  "thinking?": "string",
});

const ClaudeTranscriptLine = arktype({
  "type?": "string",
  "timestamp?": "string",
  "message?": { "content?": [ClaudeTranscriptBlock, "[]"] },
});

export function parseClaudeActivity(jsonl: string, limit: number): ClaudeActivity {
  const items: ClaudeActivityItem[] = [];
  let lastTimestamp: number | null = null;

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = safeJsonParse(ClaudeTranscriptLine, trimmed);
    if (!parsed || parsed.type !== "assistant") continue;

    const parsedTs = parsed.timestamp ? Date.parse(parsed.timestamp) : NaN;
    const timestamp = Number.isNaN(parsedTs) ? null : parsedTs;
    if (timestamp !== null) lastTimestamp = timestamp;

    const content = parsed.message?.content;
    if (!content) continue;
    for (const block of content) {
      if (block.type === "text" && block.text?.trim()) {
        items.push({ kind: "message", text: block.text.trim(), timestamp });
      } else if (block.type === "tool_use" && block.name) {
        items.push({
          kind: "tool",
          tool: block.name,
          text: toolSummary(block.name, block.input),
          timestamp,
        });
      } else if (block.type === "thinking" && block.thinking?.trim()) {
        items.push({ kind: "thinking", text: block.thinking.trim(), timestamp });
      }
    }
  }

  return { items: items.slice(-limit), lastTimestamp };
}
