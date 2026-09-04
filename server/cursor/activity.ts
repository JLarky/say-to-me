// Derive a lightweight activity view from a Cursor agent session's JSONL
// transcript. Pure over the file contents so it is unit-testable; the file read
// lives in the route. This is a snapshot (poll), not the live OpenCode hub.

import {
  textFromContent,
  toolSummary,
  type Activity as CursorActivity,
  type ActivityItem as CursorActivityItem,
  type ActivityKind as CursorActivityKind,
} from "../external-cli/activity-parsing.ts";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";

export type { CursorActivity, CursorActivityItem, CursorActivityKind };

const CursorTranscriptBlock = arktype({
  "type?": "string",
  "text?": "string",
  "name?": "string",
  "input?": "unknown",
  "thinking?": "string",
});

const CursorTranscriptLine = arktype({
  "role?": "string",
  "timestamp?": "string",
  "message?": { "content?": [CursorTranscriptBlock, "[]"] },
});

export function parseCursorActivity(jsonl: string, limit: number): CursorActivity {
  const items: CursorActivityItem[] = [];
  let lastTimestamp: number | null = null;

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = safeJsonParse(CursorTranscriptLine, trimmed);
    if (!parsed || parsed.role !== "assistant") continue;

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

  if (items.length === 0) {
    for (const line of jsonl.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = safeJsonParse(CursorTranscriptLine, trimmed);
      if (!parsed || parsed.role !== "assistant") continue;
      const text = textFromContent(parsed.message?.content);
      if (text) items.push({ kind: "message", text, timestamp: null });
    }
  }

  return { items: items.slice(-limit), lastTimestamp };
}
