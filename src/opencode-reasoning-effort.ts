/** Fallback values used when an OpenCode model does not publish its options. */
export const defaultOpenCodeReasoningEfforts = ["low", "medium", "high", "xhigh"] as const;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SDK reasoning-effort metadata is normalized at this boundary.
export function normalizeOpenCodeReasoningEfforts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value.filter((item): item is string => typeof item === "string" && item.length > 0),
      ),
    ];
  }
  if (value && typeof value === "object") {
    return Object.keys(value);
  }
  return [];
}

export function isOpenCodeReasoningEffort(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
