import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import {
  isCodexReasoningEffort,
  type CodexReasoningEffort,
} from "../../src/codex-reasoning-effort.ts";
import { codexSessionJsonlPath } from "./resolve.ts";
import { codexSessionUuid } from "../session-id.ts";

export {
  codexReasoningEfforts,
  type CodexReasoningEffort,
} from "../../src/codex-reasoning-effort.ts";

const CodexReasoningEffortEvent = arktype({
  "payload?": {
    "effort?": "string",
    "reasoning_effort?": "string",
    "thread_settings?": {
      "reasoning_effort?": "string",
    },
  },
});

const CODEX_CONFIG = path.join(homedir(), ".codex", "config.toml");

function parseEffort(value: string | undefined): CodexReasoningEffort | null {
  const trimmed = value?.trim();
  return trimmed && isCodexReasoningEffort(trimmed) ? trimmed : null;
}

export function parseCodexSessionLineReasoningEffort(raw: string): CodexReasoningEffort | null {
  const parsed = safeJsonParse(CodexReasoningEffortEvent, raw);
  if (!parsed?.payload) return null;
  return (
    parseEffort(parsed.payload.thread_settings?.reasoning_effort) ??
    parseEffort(parsed.payload.reasoning_effort) ??
    parseEffort(parsed.payload.effort)
  );
}

/** Prefer the latest effort recorded by this Codex thread over global config. */
export function readCodexSessionReasoningEffort(sessionId: string): CodexReasoningEffort | null {
  try {
    const sessionPath = codexSessionJsonlPath(codexSessionUuid(sessionId));
    if (!sessionPath) return null;
    let latest: CodexReasoningEffort | null = null;
    for (const line of readFileSync(sessionPath, "utf8").split("\n")) {
      const effort = parseCodexSessionLineReasoningEffort(line);
      if (effort) latest = effort;
    }
    return latest;
  } catch {
    return null;
  }
}

export function readCodexGlobalReasoningEffort(): CodexReasoningEffort | null {
  try {
    if (!existsSync(CODEX_CONFIG)) return null;
    const raw = readFileSync(CODEX_CONFIG, "utf8");
    return parseEffort(raw.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1]);
  } catch {
    return null;
  }
}

export function codexReasoningEffortConfigArg(effort: CodexReasoningEffort): string {
  return `model_reasoning_effort=${JSON.stringify(effort)}`;
}
