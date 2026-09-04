import { spawn } from "node:child_process";
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- Worker response JSON is validated by the existing typed response parser before use. */
import { Effect } from "effect";
import {
  buildAgentVoicePromptFromMessage,
  type VoicePromptMessage,
} from "../agent-voice-prompt.ts";
import type { DbClaudeDeliveryJob, DbMessage } from "../db/schemas.ts";
import {
  ProviderFailedError,
  ProviderNotStartedError,
  type ProviderPromptError,
  type ProviderPromptResult,
} from "@say-to-me/external-cli-delivery/workflow";
import { createExternalCliRestDeliveryWorker } from "../external-cli/rest-delivery-worker.ts";
import { workerBin, workerMode, workerVersion } from "../external-cli/worker-env.ts";
import { bindSpawnedLiveChild } from "../external-cli/live-child.ts";
import type { ResolveWorkerInternalUrlOptions } from "../external-cli/worker-internal-url.ts";
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

export function claudeDeliveryPrompt(
  job: Pick<DbClaudeDeliveryJob, "claudeSessionId">,
  message: VoicePromptMessage,
  options?: ResolveWorkerInternalUrlOptions,
): string {
  return buildAgentVoicePromptFromMessage(job.claudeSessionId, message, options);
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
): Effect.Effect<ProviderPromptResult, ProviderPromptError> {
  return Effect.async<ProviderPromptResult, ProviderPromptError>((resume) => {
    const child = spawn(
      workerBin("CLAUDE", "claude"),
      resolveClaudeSpawnArgs(
        claimed.claude.cwd,
        job.claudeSessionId,
        claudeDeliveryPrompt(job, claimed.message),
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

    const settle = (effect: Effect.Effect<ProviderPromptResult, ProviderPromptError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    const { releaseLiveChild } = bindSpawnedLiveChild(
      job.claudeSessionId,
      child,
      job.id,
      (error) => {
        settle(
          Effect.fail(
            new ProviderFailedError({
              message: `Claude live child register did not land: ${error.message}`,
              processExited: false,
            }),
          ),
        );
      },
    );

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
    // `error` fires when the child never ran, so the prompt cannot have been
    // read. A non-zero `close` means it ran and may well have read it.
    child.on("error", (error) => {
      releaseLiveChild();
      settle(
        Effect.fail(
          new ProviderNotStartedError({
            message: `Claude could not be started: ${error.message}`,
            cause: error,
          }),
        ),
      );
    });
    child.on("close", (code) => {
      releaseLiveChild();
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer.trim());
      if (code !== 0) {
        settle(
          Effect.fail(
            new ProviderFailedError({
              message: `Claude exited with code ${code}: ${stderr.trim()}`,
              processExited: true,
            }),
          ),
        );
        return;
      }
      if (resultIsError) {
        settle(
          Effect.fail(
            new ProviderFailedError({
              message: resultText ?? "Claude delivery failed.",
              processExited: true,
            }),
          ),
        );
        return;
      }
      const reply = (resultText ?? textParts.join("\n\n")).trim();
      settle(Effect.succeed({ reply: reply || null, processExited: true }));
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
  deliveryPrompt: claudeDeliveryPrompt,
  runPrompt: runClaudePrompt,
});

export const runClaudeRestDeliveryOnce = claudeRestWorker.runOnce;
export const claudeRestDeliveryWorkerLoop = claudeRestWorker.workerLoop;

// Re-export for worker script logging.
export { workerMode as claudeWorkerMode };
