export const codexReasoningEfforts = ["low", "medium", "high", "xhigh"] as const;

export type CodexReasoningEffort = (typeof codexReasoningEfforts)[number];

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SDK reasoning-effort metadata is narrowed by this predicate.
export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return typeof value === "string" && codexReasoningEfforts.includes(value as CodexReasoningEffort);
}
