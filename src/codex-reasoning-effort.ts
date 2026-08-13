export const codexReasoningEfforts = ["low", "medium", "high", "xhigh"] as const;

export type CodexReasoningEffort = (typeof codexReasoningEfforts)[number];

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return typeof value === "string" && codexReasoningEfforts.includes(value as CodexReasoningEffort);
}
