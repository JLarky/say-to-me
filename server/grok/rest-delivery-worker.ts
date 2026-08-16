import { spawn } from "node:child_process";
import { Effect } from "effect";
import {
  buildAgentVoicePromptFromMessage,
  type VoicePromptMessage,
} from "../agent-voice-prompt.ts";
import type { DbGrokDeliveryJob, DbMessage } from "../db/schemas.ts";
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
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

type ClaimedJob = {
  job: DbGrokDeliveryJob;
  grok: { cwd: string; resumeId: string; model?: string };
  message: DbMessage | null;
};

type ClaimedJobWithMessage = ClaimedJob & { message: DbMessage };
export type GrokJsonOutput = { isError?: boolean; text?: string };

export function grokDeliveryPrompt(
  job: Pick<DbGrokDeliveryJob, "grokSessionId">,
  message: VoicePromptMessage,
  options?: ResolveWorkerInternalUrlOptions,
): string {
  return buildAgentVoicePromptFromMessage(job.grokSessionId, message, options);
}

export function parseGrokJsonOutput(stdout: string): GrokJsonOutput {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  // Try JSON first (if --output-format json)
  try {
    const entry = safeJsonParse(UnknownJson, trimmed);
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      if (typeof record.result === "string") {
        return { text: record.result };
      }
      if (typeof record.text === "string") {
        return { text: record.text };
      }
    }
  } catch {}
  // Fallback: plain text output
  return { text: trimmed };
}

export function grokCommandArgs(resumeId: string, prompt: string, model?: string): string[] {
  const args = [
    "--single",
    prompt,
    "--output-format",
    "json",
    "--resume",
    resumeId,
    "--always-approve",
  ];
  if (model) args.push("--model", model);
  return args;
}

function runGrokPrompt(
  job: DbGrokDeliveryJob,
  claimed: ClaimedJobWithMessage,
): Effect.Effect<ProviderPromptResult, ProviderPromptError> {
  return Effect.async<ProviderPromptResult, ProviderPromptError>((resume) => {
    const child = spawn(
      workerBin("GROK", "grok"),
      grokCommandArgs(
        claimed.grok.resumeId,
        grokDeliveryPrompt(job, claimed.message),
        claimed.grok.model,
      ),
      { cwd: claimed.grok.cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    let settled = false;
    let stdout = "";
    let stderr = "";

    const settle = (effect: Effect.Effect<ProviderPromptResult, ProviderPromptError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    const { releaseLiveChild } = bindSpawnedLiveChild(job.grokSessionId, child, job.id, (error) => {
      settle(
        Effect.fail(
          new ProviderFailedError({
            message: `Grok live child register did not land: ${error.message}`,
            processExited: false,
          }),
        ),
      );
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
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
            message: `Grok agent could not be started: ${error.message}`,
            cause: error,
          }),
        ),
      );
    });
    child.on("close", (code) => {
      releaseLiveChild();
      if (code !== 0) {
        settle(
          Effect.fail(
            new ProviderFailedError({
              message: `Grok agent exited with code ${code}: ${stderr.trim()}`,
              processExited: true,
            }),
          ),
        );
        return;
      }
      const parsed = parseGrokJsonOutput(stdout);
      if (parsed.isError) {
        settle(
          Effect.fail(
            new ProviderFailedError({
              message: parsed.text ?? "Grok delivery failed.",
              processExited: true,
            }),
          ),
        );
        return;
      }
      const reply = parsed.text?.trim() ?? "";
      settle(Effect.succeed({ reply: reply || null, processExited: true }));
    });
  });
}

const grokRestWorker = createExternalCliRestDeliveryWorker<DbGrokDeliveryJob, ClaimedJob>({
  backendLabel: "grok",
  envPrefix: "GROK",
  realWorkerMode: "grok",
  apiBasePath: "/api/internal/grok-delivery",
  sessionIdRequestField: "grokSessionId",
  workerVersion: workerVersion("GROK"),
  echoReplyLabel: "Echo from Grok worker",
  deliveryPrompt: grokDeliveryPrompt,
  runPrompt: runGrokPrompt,
});

export const runGrokRestDeliveryOnce = grokRestWorker.runOnce;
export const grokRestDeliveryWorkerLoop = grokRestWorker.workerLoop;
