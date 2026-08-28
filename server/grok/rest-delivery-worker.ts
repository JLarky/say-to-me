import { spawn } from "node:child_process";
import { Effect } from "effect";
import { buildAgentVoicePrompt } from "../agent-voice-prompt.ts";
import type { DbGrokDeliveryJob, DbMessage } from "../db/schemas.ts";
import {
  ProviderFailedError,
  ProviderNotStartedError,
  type ProviderPromptError,
} from "@say-to-me/external-cli-delivery/workflow";
import { createExternalCliRestDeliveryWorker } from "../external-cli/rest-delivery-worker.ts";
import { workerBin, workerVersion } from "../external-cli/worker-env.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

type ClaimedJob = {
  job: DbGrokDeliveryJob;
  grok: { cwd: string; resumeId: string; model?: string };
  message: DbMessage | null;
};

type ClaimedJobWithMessage = ClaimedJob & { message: DbMessage };

export function grokDeliveryPrompt(
  job: Pick<DbGrokDeliveryJob, "grokSessionId">,
  message: Pick<DbMessage, "text">,
): string {
  return buildAgentVoicePrompt(job.grokSessionId, message.text);
}

export function parseGrokJsonOutput(stdout: string): { isError?: boolean; text?: string } {
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
): Effect.Effect<string | null, ProviderPromptError> {
  return Effect.async<string | null, ProviderPromptError>((resume) => {
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

    const settle = (effect: Effect.Effect<string | null, ProviderPromptError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    // `error` fires when the child never ran, so the prompt cannot have been
    // read. A non-zero `close` means it ran and may well have read it.
    child.on("error", (error) =>
      settle(
        Effect.fail(
          new ProviderNotStartedError({
            message: `Grok agent could not be started: ${error.message}`,
            cause: error,
          }),
        ),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        settle(
          Effect.fail(
            new ProviderFailedError({
              message: `Grok agent exited with code ${code}: ${stderr.trim()}`,
            }),
          ),
        );
        return;
      }
      const parsed = parseGrokJsonOutput(stdout);
      if (parsed.isError) {
        settle(
          Effect.fail(new ProviderFailedError({ message: parsed.text ?? "Grok delivery failed." })),
        );
        return;
      }
      const reply = parsed.text?.trim() ?? "";
      settle(Effect.succeed(reply || null));
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
