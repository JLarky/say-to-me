import { spawn } from "node:child_process";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { EXTERNAL_CLI_BOOTSTRAP_PROMPT } from "../external-cli/bootstrap-prompt.ts";
import { workerBin } from "../external-cli/worker-env.ts";
import { codexReasoningEffortConfigArg, type CodexReasoningEffort } from "./reasoning-effort.ts";

const CodexThreadStartedEvent = arktype({
  type: "'thread.started'",
  thread_id: "string",
});

const CodexErrorEvent = arktype({
  type: "'error'",
  message: "string",
});

export function codexBootstrapCommandArgs(
  prompt: string,
  model?: string,
  reasoningEffort?: CodexReasoningEffort,
): string[] {
  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--json",
  ];
  if (model) args.push("--model", model);
  if (reasoningEffort) args.push("-c", codexReasoningEffortConfigArg(reasoningEffort));
  args.push(prompt);
  return args;
}

export function parseCodexStartedThreadId(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = safeJsonParse(CodexThreadStartedEvent, line);
    if (parsed) return parsed.thread_id;
  }
  return output.match(/\bsession id:\s*([0-9a-f]{8}-[0-9a-f-]{27})/i)?.[1] ?? null;
}

export function parseCodexJsonError(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = safeJsonParse(CodexErrorEvent, line);
    if (parsed) return parsed.message;
  }
  return null;
}

export type BootstrapCodexThreadInput = {
  cwd: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  prompt?: string;
};

/**
 * Start a new Codex thread via `codex exec` (not resume) and return the real thread UUID.
 * Used at CLI session create so delivery can always `exec resume` a real rollout.
 */
export function bootstrapCodexThread(input: BootstrapCodexThreadInput): Promise<string> {
  const prompt = input.prompt ?? EXTERNAL_CLI_BOOTSTRAP_PROMPT;
  const args = codexBootstrapCommandArgs(prompt, input.model, input.reasoningEffort);
  return new Promise((resolve, reject) => {
    const child = spawn(workerBin("CODEX", "codex"), args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      settle(() => reject(error));
    });
    child.on("close", (code) => {
      settle(() => {
        const threadId = parseCodexStartedThreadId(stdout);
        if (threadId) {
          resolve(threadId);
          return;
        }
        const jsonError = parseCodexJsonError(stdout);
        const detail = jsonError || stderr.trim() || stdout.trim() || `exit code ${code ?? "?"}`;
        reject(new Error(`Codex bootstrap failed: ${detail}`));
      });
    });
  });
}
