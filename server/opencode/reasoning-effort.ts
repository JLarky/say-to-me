import {
  defaultOpenCodeReasoningEfforts,
  isOpenCodeReasoningEffort,
  normalizeOpenCodeReasoningEfforts,
} from "../../src/opencode-reasoning-effort.ts";

export { defaultOpenCodeReasoningEfforts as opencodeReasoningEfforts, isOpenCodeReasoningEffort };

export function readOpenCodeModelReasoningEfforts(
  options: Record<string, unknown>,
  variants?: Record<string, unknown>,
): string[] {
  const configured = normalizeOpenCodeReasoningEfforts(options.reasoningEffort);
  if (configured.length > 0) return configured;
  const configuredVariants = variants ? Object.keys(variants) : [];
  return configuredVariants.length > 0 ? configuredVariants : [...defaultOpenCodeReasoningEfforts];
}

export function opencodeReasoningEffortCliArg(effort: string): ["--variant", string] {
  return ["--variant", effort];
}

export function readOpenCodeSessionVariant(value: string | null | undefined): string | null {
  if (!isOpenCodeReasoningEffort(value)) return null;
  const trimmed = value.trim();
  return trimmed === "default" ? null : trimmed;
}
