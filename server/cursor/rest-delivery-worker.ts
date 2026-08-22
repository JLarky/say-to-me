import { spawn } from "node:child_process";
import { Effect } from "effect";
import { buildAgentVoicePrompt } from "../agent-voice-prompt.ts";
import type { DbCursorDeliveryJob, DbMessage } from "../db/schemas.ts";
import {
  ProviderFailedError,
  ProviderNotStartedError,
  type ProviderPromptError,
} from "@say-to-me/external-cli-delivery/workflow";
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
  // `--output-format json` has shipped as a bare result object, an array of
  // events, or NDJSON depending on version. Accept all three; dropping the
  // reply here loses the agent's final text and skips the idle notice.
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  const candidates: unknown[] = [];
  const single = safeJsonParse(UnknownJson, trimmed);
  if (single !== null) {
    candidates.push(single);
  } else {
    for (const line of trimmed.split("\n")) {
      const parsed = safeJsonParse(UnknownJson, line.trim());
      if (parsed !== null) candidates.push(parsed);
    }
  }
  let isError = false;
  let text: string | undefined;
  for (const entry of candidates) {
    const records = Array.isArray(entry) ? entry : [entry];
    for (const record of records.reverse()) {
      if (!record || typeof record !== "object") continue;
      const typed = record as Record<string, unknown>;
      if (typed.type !== "result") continue;
      isError = typed.is_error === true;
      if (typeof typed.result === "string" && typed.result.trim()) text = typed.result;
      break;
    }
    if (text != null || isError) break;
  }
  return { isError, text };
}

export function cursorCommandArgs(resumeId: string, prompt: string, model?: string): string[] {
  const args = ["-p", "--output-format", "json", "--resume", resumeId, "--force", prompt];
  if (model) args.push("--model", model);
  return args;
}

function runCursorPrompt(
  job: DbCursorDeliveryJob,
  claimed: ClaimedJobWithMessage,
): Effect.Effect<string | null, ProviderPromptError> {
  return Effect.async<string | null, ProviderPromptError>((resume) => {
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
            message: `Cursor agent could not be started: ${error.message}`,
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
              message: `Cursor agent exited with code ${code}: ${stderr.trim()}`,
            }),
          ),
        );
        return;
      }
      const parsed = parseCursorJsonOutput(stdout);
      if (parsed.isError) {
        settle(
          Effect.fail(
            new ProviderFailedError({ message: parsed.text ?? "Cursor delivery failed." }),
          ),
        );
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
