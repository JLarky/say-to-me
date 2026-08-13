import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Effect } from "effect";
import { buildAgentVoicePrompt } from "../agent-voice-prompt.ts";
import type { DbCodexDeliveryJob, DbMessage } from "../db/schemas.ts";
import { createExternalCliRestDeliveryWorker } from "../external-cli/rest-delivery-worker.ts";
import { workerBin, workerVersion } from "../external-cli/worker-env.ts";
import { codexReasoningEffortConfigArg, type CodexReasoningEffort } from "./reasoning-effort.ts";

type ClaimedJob = {
  job: DbCodexDeliveryJob;
  codex: { cwd: string; resumeId: string; model?: string; reasoningEffort?: CodexReasoningEffort };
  message: DbMessage | null;
};

type ClaimedJobWithMessage = ClaimedJob & { message: DbMessage };

function deliveryPrompt(job: DbCodexDeliveryJob, message: DbMessage): string {
  return buildAgentVoicePrompt(job.codexSessionId, message.text);
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
): Effect.Effect<string | null, Error> {
  return Effect.async<string | null, Error>((resume) => {
    // `-o` last-message file avoids parsing unstable `--json` event streams; per-job uuid temp path is race-safe.
    const outFile = path.join(tmpdir(), `say-to-me-codex-${randomUUID()}.txt`);
    const args = [
      ...codexCommandArgs(
        claimed.codex.resumeId,
        deliveryPrompt(job, claimed.message),
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

    const settle = (effect: Effect.Effect<string | null, Error>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

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
    child.on("error", (error) => {
      cleanup();
      settle(Effect.fail(error));
    });
    child.on("close", (code) => {
      try {
        if (code !== 0) {
          settle(Effect.fail(new Error(`Codex exited with code ${code}: ${stderr.trim()}`)));
          return;
        }
        const reply = parseCodexLastMessage(readFileSync(outFile, "utf8"));
        settle(Effect.succeed(reply || null));
      } catch (error) {
        settle(Effect.fail(error instanceof Error ? error : new Error(String(error))));
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
  deliveryPrompt,
  runPrompt: runCodexPrompt,
});

export const runCodexRestDeliveryOnce = codexRestWorker.runOnce;
export const codexRestDeliveryWorkerLoop = codexRestWorker.workerLoop;
