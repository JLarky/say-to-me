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
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

export type { CursorActivity, CursorActivityItem, CursorActivityKind };

export function parseCursorActivity(jsonl: string, limit: number): CursorActivity {
  const items: CursorActivityItem[] = [];
  let lastTimestamp: number | null = null;

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = safeJsonParse(UnknownJson, trimmed);
    if (!entry || typeof entry !== "object") continue;
    const typedEntry = entry as {
      role?: unknown;
      type?: unknown;
      timestamp?: unknown;
      message?: { content?: unknown };
    };
    if (typedEntry.role !== "assistant") continue;

    const parsedTs =
      typeof typedEntry.timestamp === "string" ? Date.parse(typedEntry.timestamp) : NaN;
    const timestamp = Number.isNaN(parsedTs) ? null : parsedTs;
    if (timestamp !== null) lastTimestamp = timestamp;

    const content = typedEntry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as {
        type?: unknown;
        text?: unknown;
        name?: unknown;
        input?: unknown;
        thinking?: unknown;
      };
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        items.push({ kind: "message", text: b.text.trim(), timestamp });
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        items.push({
          kind: "tool",
          tool: b.name,
          text: toolSummary(b.name, b.input),
          timestamp,
        });
      } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
        items.push({ kind: "thinking", text: b.thinking.trim(), timestamp });
      }
    }
  }

  if (items.length === 0) {
    for (const line of jsonl.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const entry = safeJsonParse(UnknownJson, trimmed);
      if (!entry || typeof entry !== "object") continue;
      const typedEntry = entry as { role?: unknown; message?: { content?: unknown } };
      if (typedEntry.role !== "assistant") continue;
      const text = textFromContent(typedEntry.message?.content);
      if (text) items.push({ kind: "message", text, timestamp: null });
    }
  }

  return { items: items.slice(-limit), lastTimestamp };
}
