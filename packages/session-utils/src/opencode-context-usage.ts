type ContextUsage = {
  usedTokens?: number | null;
  limitTokens?: number | null;
  percent?: number | null;
  source?: "latestMessageTokens";
};

type ContextUsageActivity = {
  contextUsage?: ContextUsage | null;
} | null;

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return String(value);
}

export function formatContextUsage(activity: ContextUsageActivity): string | null {
  const usage = activity?.contextUsage;
  if (!usage) return null;
  if (usage.source === "latestMessageTokens" && typeof usage.usedTokens === "number") {
    return typeof usage.limitTokens === "number"
      ? `${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.limitTokens)}`
      : formatTokenCount(usage.usedTokens);
  }
  return null;
}

export function formatContextUsageDetails(activity: ContextUsageActivity): string | null {
  const usage = activity?.contextUsage;
  if (!usage) return null;
  const percent = typeof usage.percent === "number" ? `${Math.round(usage.percent)}%` : null;
  const tokens =
    typeof usage.usedTokens === "number" && typeof usage.limitTokens === "number"
      ? `${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.limitTokens)} tokens`
      : typeof usage.usedTokens === "number"
        ? `${formatTokenCount(usage.usedTokens)} input tokens`
        : null;
  return [percent, tokens].filter(Boolean).join(" · ") || null;
}

export function formatContextUsageTitle(activity: ContextUsageActivity): string | null {
  const usage = activity?.contextUsage;
  if (!usage) return null;
  if (usage.source === "latestMessageTokens") {
    return "Latest OpenCode message token total compared with the model context limit.";
  }
  return null;
}
