// Derive an activity view for a Paseo agent session from `paseo logs`' curated
// plain-text timeline (see fork-paseo's activity-curator.ts: entries are lines
// like "[Thought] ...", "[SomeTool] summary", or unlabeled assistant text).
// That command has no `--json` mode and emits no per-item timestamps, so items
// carry a null timestamp; busy/idle comes from a separate `paseo inspect` call.
import type { Activity, ActivityItem } from "../external-cli/activity-parsing.ts";

export type { Activity as PaseoActivity, ActivityItem as PaseoActivityItem };

const ENTRY_START = /^\[([^\]]+)\](?:\s(.*))?$/;
const THINKING_TAG = "Thought";
const PLAIN_TAGS = new Set(["User", "Error", "Tasks", "Compacted"]);

export function parsePaseoActivity(logs: string, limit: number): Activity {
  const trimmed = logs.trim();
  if (!trimmed || trimmed === "No activity to display.") {
    return { items: [], lastTimestamp: null };
  }

  const items: ActivityItem[] = [];
  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const match = ENTRY_START.exec(line);
    if (match) {
      const tag = match[1] ?? "";
      const rest = match[2] ?? "";
      if (tag === THINKING_TAG) {
        items.push({ kind: "thinking", text: rest, timestamp: null });
      } else if (PLAIN_TAGS.has(tag)) {
        items.push({ kind: "message", text: line, timestamp: null });
      } else {
        items.push({ kind: "tool", tool: tag, text: rest, timestamp: null });
      }
      continue;
    }
    const last = items.at(-1);
    if (!last) {
      items.push({ kind: "message", text: line, timestamp: null });
      continue;
    }
    items[items.length - 1] = { ...last, text: last.text ? `${last.text}\n${line}` : line };
  }
  return { items: items.slice(-limit), lastTimestamp: null };
}
