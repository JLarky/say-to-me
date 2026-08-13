import type { OpenCodeActivity } from "./types.ts";

export type OpenCodeActivityCard = NonNullable<OpenCodeActivity["recentItems"]>[number];

export function openCodeStatusRawMessage(statusRaw: unknown): string | null {
  if (!statusRaw || typeof statusRaw !== "object" || Array.isArray(statusRaw)) return null;
  const message = (statusRaw as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
}

/** Human-visible OpenCode session status error (retry / hard error), if any. */
export function openCodeStatusAlertMessage(activity: OpenCodeActivity | null): string | null {
  if (!activity) return null;
  if (activity.status !== "retrying" && activity.status !== "error") return null;

  const rawMessage = openCodeStatusRawMessage(activity.statusRaw);
  if (rawMessage) return rawMessage;

  const snippet = activity.latestOutputSnippet?.trim();
  if (snippet) return snippet;

  return activity.status === "retrying"
    ? "OpenCode is retrying this session."
    : "OpenCode reported an error for this session.";
}

export function buildOpenCodeActivityCards({
  activity,
  recentItems,
  streamError,
}: {
  activity: OpenCodeActivity | null;
  recentItems: OpenCodeActivityCard[];
  streamError?: string | null;
}): OpenCodeActivityCard[] {
  const statusAlert = openCodeStatusAlertMessage(activity);
  // Status-alert / empty-placeholder cards are plain text by design (no client markdown).
  // Server activity snapshots always attach snippetHtml on real recentItems.
  const alertCard: OpenCodeActivityCard | null = statusAlert
    ? {
        kind: "message",
        snippet: statusAlert,
        messageId: null,
        partId: null,
        timestamp: activity?.latestActivityTimestamp ?? null,
        partial: false,
        source: "v2",
      }
    : null;

  const cards = recentItems.filter((item) => item.snippet).slice(0, 5);
  if (alertCard) return [alertCard, ...cards];
  if (cards.length > 0) return cards;

  return [
    {
      kind: "message",
      snippet:
        streamError?.trim() ||
        activity?.latestOutputSnippet?.trim() ||
        "No OpenCode output preview yet.",
      messageId: null,
      partId: null,
      timestamp: null,
      partial: false,
      source: "v2",
    },
  ];
}

export function isOpenCodeStatusAlertCard(
  item: OpenCodeActivityCard,
  activity: OpenCodeActivity | null,
): boolean {
  const alert = openCodeStatusAlertMessage(activity);
  return Boolean(alert && item.snippet === alert);
}
