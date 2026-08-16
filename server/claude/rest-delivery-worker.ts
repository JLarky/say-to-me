import { spawn } from "node:child_process";
import { Effect } from "effect";
import { buildAgentVoicePrompt } from "../agent-voice-prompt.ts";
import type { DbClaudeDeliveryJob, DbMessage } from "../db/schemas.ts";
import { createExternalCliRestDeliveryWorker } from "../external-cli/rest-delivery-worker.ts";
import { workerBin, workerMode, workerVersion } from "../external-cli/worker-env.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";
import { resolveClaudeSessionFlag, type ClaudeSessionFlag } from "./delivery.ts";

const PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE ?? "bypassPermissions";

type ClaimedJob = {
  job: DbClaudeDeliveryJob;
  claude: { cwd: string; sessionFlag: ClaudeSessionFlag; model?: string };
  message: DbMessage | null;
};

type ClaimedJobWithMessage = ClaimedJob & { message: DbMessage };
export type ClaudeStreamOutput = { isError?: boolean; text?: string };

function deliveryPrompt(job: DbClaudeDeliveryJob, message: DbMessage): string {
  return buildAgentVoicePrompt(job.claudeSessionId, message.text);
}

export function parseClaudeStreamLine(line: string): ClaudeStreamOutput {
  const entry = safeJsonParse(UnknownJson, line);
  if (!entry || typeof entry !== "object") return {};
  const record = entry as Record<string, unknown>;
  if (record.type === "result") {
    return {
      isError: record.is_error === true,
      text: typeof record.result === "string" ? record.result : undefined,
    };
  }
  const message = record.message;
  if (!message || typeof message !== "object") return {};
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return {};
  const parts = content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const candidate = block as { type?: unknown; text?: unknown };
    return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
  });
  return parts.length > 0 ? { text: parts.join("\n") } : {};
}

export function claudeCommandArgs(
  sessionFlag: "--resume" | "--session-id",
  sessionValue: string,
  prompt: string,
  model?: string,
): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    sessionFlag,
    sessionValue,
    "--permission-mode",
    PERMISSION_MODE,
    prompt,
  ];
  if (model) args.push("--model", model);
  return args;
}

/**
 * Resolve Claude CLI session flags at spawn time from the local transcript.
 *
 * Do not trust `claimed.claude.sessionFlag` from the claim API alone: workers often
 * inherit `SAY_TO_ME_INTERNAL_URL=https://say.local:1355`, so claim can run on a
 * different checkout/server version than the worker script (always-`--resume` stale claim).
 */
export function resolveClaudeSpawnArgs(
  cwd: string,
  claudeSessionId: string,
  prompt: string,
  model?: string,
): string[] {
  const [sessionFlag, sessionValue] = resolveClaudeSessionFlag(cwd, claudeSessionId);
  return claudeCommandArgs(sessionFlag, sessionValue, prompt, model);
}

function runClaudePrompt(
  job: DbClaudeDeliveryJob,
  claimed: ClaimedJobWithMessage,
): Effect.Effect<string | null, Error> {
  return Effect.async<string | null, Error>((resume) => {
    const child = spawn(
      workerBin("CLAUDE", "claude"),
      resolveClaudeSpawnArgs(
        claimed.claude.cwd,
        job.claudeSessionId,
        deliveryPrompt(job, claimed.message),
        claimed.claude.model,
      ),
      { cwd: claimed.claude.cwd, stdio: ["ignore", "pipe", "pipe"] },
    );

    let settled = false;
    let stdoutBuffer = "";
    let stderr = "";
    const textParts: string[] = [];
    let resultText: string | null = null;
    let resultIsError = false;

    const settle = (effect: Effect.Effect<string | null, Error>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

    const handleLine = (line: string) => {
      const parsed = parseClaudeStreamLine(line);
      if (parsed.text) {
        if (parsed.isError === true) resultText = parsed.text;
        else if (parsed.isError === false) resultText = parsed.text;
        else textParts.push(parsed.text);
      }
      if (parsed.isError === true) resultIsError = true;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline === -1) break;
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line) handleLine(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => settle(Effect.fail(error)));
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer.trim());
      if (code !== 0) {
        settle(Effect.fail(new Error(`Claude exited with code ${code}: ${stderr.trim()}`)));
        return;
      }
      if (resultIsError) {
        settle(Effect.fail(new Error(resultText ?? "Claude delivery failed.")));
        return;
      }
      const reply = (resultText ?? textParts.join("\n\n")).trim();
      settle(Effect.succeed(reply || null));
    });
  });
}

const claudeRestWorker = createExternalCliRestDeliveryWorker<DbClaudeDeliveryJob, ClaimedJob>({
  backendLabel: "claude",
  envPrefix: "CLAUDE",
  realWorkerMode: "claude",
  apiBasePath: "/api/internal/claude-delivery",
  sessionIdRequestField: "claudeSessionId",
  workerVersion: workerVersion("CLAUDE"),
  echoReplyLabel: "Echo from Claude worker",
  deliveryPrompt,
  runPrompt: runClaudePrompt,
});

export const runClaudeRestDeliveryOnce = claudeRestWorker.runOnce;
export const claudeRestDeliveryWorkerLoop = claudeRestWorker.workerLoop;

// Re-export for worker script logging.
export { workerMode as claudeWorkerMode };
