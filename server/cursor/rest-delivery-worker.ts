import { spawn } from "node:child_process";
import { Effect } from "effect";
import { buildAgentVoicePrompt } from "../agent-voice-prompt.ts";
import type { DbCursorDeliveryJob, DbMessage } from "../db/schemas.ts";
import { createExternalCliRestDeliveryWorker } from "../external-cli/rest-delivery-worker.ts";
import { workerBin, workerVersion } from "../external-cli/worker-env.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

type ClaimedJob = {
  job: DbCursorDeliveryJob;
  cursor: { cwd: string; resumeId: string; model?: string };
  message: DbMessage | null;
};

type ClaimedJobWithMessage = ClaimedJob & { message: DbMessage };

function deliveryPrompt(job: DbCursorDeliveryJob, message: DbMessage): string {
  return buildAgentVoicePrompt(job.cursorSessionId, message.text);
}

export function parseCursorJsonOutput(stdout: string): { isError?: boolean; text?: string } {
  const entry = safeJsonParse(UnknownJson, stdout.trim());
  if (!entry || typeof entry !== "object") return {};
  const record = entry as Record<string, unknown>;
  if (record.type !== "result") return {};
  return {
    isError: record.is_error === true,
    text: typeof record.result === "string" ? record.result : undefined,
  };
}

export function cursorCommandArgs(resumeId: string, prompt: string, model?: string): string[] {
  const args = ["-p", "--output-format", "json", "--resume", resumeId, "--force", prompt];
  if (model) args.push("--model", model);
  return args;
}

function runCursorPrompt(
  job: DbCursorDeliveryJob,
  claimed: ClaimedJobWithMessage,
): Effect.Effect<string | null, Error> {
  return Effect.async<string | null, Error>((resume) => {
    const child = spawn(
      workerBin("CURSOR", "agent"),
      cursorCommandArgs(
        claimed.cursor.resumeId,
        deliveryPrompt(job, claimed.message),
        claimed.cursor.model,
      ),
      { cwd: claimed.cursor.cwd, stdio: ["ignore", "pipe", "pipe"] },
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
        settle(Effect.fail(new Error(`Cursor agent exited with code ${code}: ${stderr.trim()}`)));
        return;
      }
      const parsed = parseCursorJsonOutput(stdout);
      if (parsed.isError) {
        settle(Effect.fail(new Error(parsed.text ?? "Cursor delivery failed.")));
        return;
      }
      const reply = parsed.text?.trim() ?? "";
      settle(Effect.succeed(reply || null));
    });
  });
}

const cursorRestWorker = createExternalCliRestDeliveryWorker<DbCursorDeliveryJob, ClaimedJob>({
  backendLabel: "cursor",
  envPrefix: "CURSOR",
  realWorkerMode: "cursor",
  apiBasePath: "/api/internal/cursor-delivery",
  sessionIdRequestField: "cursorSessionId",
  workerVersion: workerVersion("CURSOR"),
  echoReplyLabel: "Echo from Cursor worker",
  deliveryPrompt,
  runPrompt: runCursorPrompt,
});

export const runCursorRestDeliveryOnce = cursorRestWorker.runOnce;
export const cursorRestDeliveryWorkerLoop = cursorRestWorker.workerLoop;
