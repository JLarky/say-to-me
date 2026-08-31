import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Effect } from "effect";
import {
  buildAgentVoicePromptFromMessage,
  type VoicePromptMessage,
} from "../agent-voice-prompt.ts";
import type { DbCodexDeliveryJob, DbMessage } from "../db/schemas.ts";
import {
  ProviderFailedError,
  ProviderNotStartedError,
  type ProviderPromptError,
  type ProviderPromptResult,
} from "@say-to-me/external-cli-delivery/workflow";
import { createExternalCliRestDeliveryWorker } from "../external-cli/rest-delivery-worker.ts";
import { workerBin, workerVersion } from "../external-cli/worker-env.ts";
import { bindSpawnedLiveChild } from "../external-cli/live-child.ts";
import type { ResolveWorkerInternalUrlOptions } from "../external-cli/worker-internal-url.ts";
import { codexReasoningEffortConfigArg, type CodexReasoningEffort } from "./reasoning-effort.ts";

type ClaimedJob = {
  job: DbCodexDeliveryJob;
  codex: { cwd: string; resumeId: string; model?: string; reasoningEffort?: CodexReasoningEffort };
  message: DbMessage | null;
};

type ClaimedJobWithMessage = ClaimedJob & { message: DbMessage };

export function codexDeliveryPrompt(
  job: Pick<DbCodexDeliveryJob, "codexSessionId">,
  message: VoicePromptMessage,
  options?: ResolveWorkerInternalUrlOptions,
): string {
  return buildAgentVoicePromptFromMessage(job.codexSessionId, message, options);
}

export function codexCommandArgs(
  resumeId: string,
  prompt: string,
  model?: string,
  reasoningEffort?: CodexReasoningEffort,
): string[] {
  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "resume",
    resumeId,
  ];
  if (model) args.push("--model", model);
  if (reasoningEffort) args.push("-c", codexReasoningEffortConfigArg(reasoningEffort));
  args.push(prompt);
  return args;
}

export function parseCodexLastMessage(output: string): string {
  return output.trim();
}

function runCodexPrompt(
  job: DbCodexDeliveryJob,
  claimed: ClaimedJobWithMessage,
): Effect.Effect<ProviderPromptResult, ProviderPromptError> {
  return Effect.async<ProviderPromptResult, ProviderPromptError>((resume) => {
    // `-o` last-message file avoids parsing unstable `--json` event streams; per-job uuid temp path is race-safe.
    const outFile = path.join(tmpdir(), `say-to-me-codex-${randomUUID()}.txt`);
    const args = [
      ...codexCommandArgs(
        claimed.codex.resumeId,
        codexDeliveryPrompt(job, claimed.message),
        claimed.codex.model,
        claimed.codex.reasoningEffort,
      ),
      "-o",
      outFile,
    ];
    const child = spawn(workerBin("CODEX", "codex"), args, {
      cwd: claimed.codex.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let stderr = "";

    const settle = (effect: Effect.Effect<ProviderPromptResult, ProviderPromptError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    const { releaseLiveChild } = bindSpawnedLiveChild(
      job.codexSessionId,
      child,
      job.id,
      (error) => {
        settle(
          Effect.fail(
            new ProviderFailedError({
              message: `Codex live child register did not land: ${error.message}`,
              processExited: false,
            }),
          ),
        );
      },
    );

    const cleanup = () => {
      try {
        unlinkSync(outFile);
      } catch {
        // ignore
      }
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    // `error` fires when the child never ran, so the prompt cannot have been
    // read. A non-zero `close`, or an unreadable last-message file, means it ran
    // and may well have read it.
    child.on("error", (error) => {
      releaseLiveChild();
      cleanup();
      settle(
        Effect.fail(
          new ProviderNotStartedError({
            message: `Codex could not be started: ${error.message}`,
            cause: error,
          }),
        ),
      );
    });
    child.on("close", (code) => {
      releaseLiveChild();
      try {
        if (code !== 0) {
          settle(
            Effect.fail(
              new ProviderFailedError({
                message: `Codex exited with code ${code}: ${stderr.trim()}`,
                processExited: true,
              }),
            ),
          );
          return;
        }
        const reply = parseCodexLastMessage(readFileSync(outFile, "utf8"));
        settle(Effect.succeed({ reply: reply || null, processExited: true }));
      } catch (error) {
        settle(
          Effect.fail(
            new ProviderFailedError({
              message: `Codex output could not be read: ${error instanceof Error ? error.message : String(error)}`,
              cause: error,
              processExited: true,
            }),
          ),
        );
      } finally {
        cleanup();
      }
    });
  });
}

const codexRestWorker = createExternalCliRestDeliveryWorker<DbCodexDeliveryJob, ClaimedJob>({
  backendLabel: "codex",
  envPrefix: "CODEX",
  realWorkerMode: "codex",
  apiBasePath: "/api/internal/codex-delivery",
  sessionIdRequestField: "codexSessionId",
  workerVersion: workerVersion("CODEX"),
  echoReplyLabel: "Echo from Codex worker",
  deliveryPrompt: codexDeliveryPrompt,
  runPrompt: runCodexPrompt,
});

export const runCodexRestDeliveryOnce = codexRestWorker.runOnce;
export const codexRestDeliveryWorkerLoop = codexRestWorker.workerLoop;
