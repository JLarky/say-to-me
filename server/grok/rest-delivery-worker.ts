import { spawn } from "node:child_process";
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- Worker response JSON is validated by the existing typed response parser before use. */
import { type as arktype } from "arktype";
import { Effect } from "effect";
import { buildAgentVoicePrompt } from "../agent-voice-prompt.ts";
import type { DbGrokDeliveryJob, DbMessage } from "../db/schemas.ts";
import { createExternalCliRestDeliveryWorker } from "../external-cli/rest-delivery-worker.ts";
import { workerBin, workerVersion } from "../external-cli/worker-env.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

type ClaimedJob = {
  job: DbGrokDeliveryJob;
  grok: { cwd: string; resumeId: string; model?: string };
  message: DbMessage | null;
};

type ClaimedJobWithMessage = ClaimedJob & { message: DbMessage };
export type GrokJsonOutput = { isError?: boolean; text?: string };

const GrokResultEvent = arktype({
  "result?": "string",
  "text?": "string",
});

function deliveryPrompt(job: DbGrokDeliveryJob, message: DbMessage): string {
  return buildAgentVoicePrompt(job.grokSessionId, message.text);
}

export function parseGrokJsonOutput(stdout: string): GrokJsonOutput {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  // Try JSON first (if --output-format json)
  const entry = safeJsonParse(UnknownJson, trimmed);
  const resultEvent = GrokResultEvent(entry);
  if (!(resultEvent instanceof arktype.errors)) {
    if (resultEvent.result !== undefined) return { text: resultEvent.result };
    if (resultEvent.text !== undefined) return { text: resultEvent.text };
  }
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
): Effect.Effect<string | null, Error> {
  return Effect.async<string | null, Error>((resume) => {
    const child = spawn(
      workerBin("GROK", "grok"),
      grokCommandArgs(
        claimed.grok.resumeId,
        deliveryPrompt(job, claimed.message),
        claimed.grok.model,
      ),
      { cwd: claimed.grok.cwd, stdio: ["ignore", "pipe", "pipe"] },
    );

    let settled = false;
    let stdout = "";
    let stderr = "";

    const settle = (effect: Effect.Effect<string | null, Error>) => {
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
    child.on("error", (error) => settle(Effect.fail(error)));
    child.on("close", (code) => {
      if (code !== 0) {
        settle(Effect.fail(new Error(`Grok agent exited with code ${code}: ${stderr.trim()}`)));
        return;
      }
      const parsed = parseGrokJsonOutput(stdout);
      if (parsed.isError) {
        settle(Effect.fail(new Error(parsed.text ?? "Grok delivery failed.")));
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
  deliveryPrompt,
  runPrompt: runGrokPrompt,
});

export const runGrokRestDeliveryOnce = grokRestWorker.runOnce;
export const grokRestDeliveryWorkerLoop = grokRestWorker.workerLoop;
