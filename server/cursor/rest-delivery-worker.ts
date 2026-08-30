import { spawn } from "node:child_process";
import { Effect } from "effect";
import { type as arktype } from "arktype";
import { isIdleNoticeText } from "@say-to-me/session-utils/idle-notices";
import {
  buildAgentVoicePromptFromMessage,
  type VoicePromptMessage,
} from "../agent-voice-prompt.ts";
import type { DbCursorDeliveryJob, DbMessage } from "../db/schemas.ts";
import {
  ProviderFailedError,
  ProviderNotStartedError,
  type ProviderPromptError,
} from "@say-to-me/external-cli-delivery/workflow";
import { createExternalCliRestDeliveryWorker } from "../external-cli/rest-delivery-worker.ts";
import { postInternalJson } from "../external-cli/internal-http.ts";
import { workerBin, workerVersion } from "../external-cli/worker-env.ts";
import type { ResolveWorkerInternalUrlOptions } from "../external-cli/worker-internal-url.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

type ClaimedJob = {
  job: DbCursorDeliveryJob;
  cursor: { cwd: string; resumeId: string; model?: string };
  message: DbMessage | null;
};

type ClaimedJobWithMessage = ClaimedJob & { message: DbMessage };

const OkResponse = arktype({ ok: "boolean" });

export function cursorDeliveryPrompt(
  job: Pick<DbCursorDeliveryJob, "cursorSessionId">,
  message: VoicePromptMessage,
  options?: ResolveWorkerInternalUrlOptions,
): string {
  return buildAgentVoicePromptFromMessage(job.cursorSessionId, message, options);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Assistant text from a `stream-json` event. Tool-only assistant events are ignored. */
export function cursorAssistantText(event: unknown): string | null {
  if (!isJsonRecord(event) || event.type !== "assistant") return null;
  const message = event.message;
  if (!isJsonRecord(message) || !Array.isArray(message.content)) return null;
  const text = message.content
    .filter(isJsonRecord)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return text.trim() ? text : null;
}

export function parseCursorJsonOutput(stdout: string): { isError?: boolean; text?: string } {
  // `--output-format stream-json` is NDJSON. Older `--output-format json` shipped
  // as a bare result object or an array. Accept all three; dropping the reply
  // here loses the agent's final text and skips the idle notice.
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
      if (!isJsonRecord(record) || record.type !== "result") continue;
      isError = record.is_error === true;
      if (typeof record.result === "string" && record.result.trim()) text = record.result;
      break;
    }
    if (text != null || isError) break;
  }
  return { isError, text };
}

export function cursorCommandArgs(resumeId: string, prompt: string, model?: string): string[] {
  const args = ["-p", "--output-format", "stream-json", "--resume", resumeId, "--force", prompt];
  if (model) args.push("--model", model);
  return args;
}

function postCursorStreamProgress(sessionId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed || isIdleNoticeText(trimmed)) return;
  void postInternalJson(
    "/api/internal/cursor-delivery/progress",
    { cursorSessionId: sessionId, text: trimmed },
    OkResponse,
  ).catch((error: unknown) => {
    console.error("[cursor-delivery-worker] stream progress post failed:", error);
  });
}

function runCursorPrompt(
  job: DbCursorDeliveryJob,
  claimed: ClaimedJobWithMessage,
): Effect.Effect<string | null, ProviderPromptError> {
  return Effect.async<string | null, ProviderPromptError>((resume) => {
    const child = spawn(
      // `agent` is ambiguous — Grok installs one under that name too, and PATH
      // order decides the winner. `cursor-agent` only ever means Cursor.
      workerBin("CURSOR", "cursor-agent"),
      cursorCommandArgs(
        claimed.cursor.resumeId,
        cursorDeliveryPrompt(job, claimed.message),
        claimed.cursor.model,
      ),
      { cwd: claimed.cursor.cwd, stdio: ["ignore", "pipe", "pipe"] },
    );

    let settled = false;
    let stdout = "";
    let stderr = "";
    let pending = "";
    let lastAssistant = "";

    const settle = (effect: Effect.Effect<string | null, ProviderPromptError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const event = safeJsonParse(UnknownJson, trimmed);
      if (event === null) return;
      // Stream `result` is not idle. Idle is `child.close` only.
      const text = cursorAssistantText(event);
      if (text == null || text === lastAssistant) return;
      lastAssistant = text;
      postCursorStreamProgress(job.cursorSessionId, text);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const piece = chunk.toString("utf8");
      stdout += piece;
      pending += piece;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
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
      if (pending.trim()) consumeLine(pending);
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
      const reply = (parsed.text ?? lastAssistant).trim();
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
  deliveryPrompt: cursorDeliveryPrompt,
  runPrompt: runCursorPrompt,
});

export const runCursorRestDeliveryOnce = cursorRestWorker.runOnce;
export const cursorRestDeliveryWorkerLoop = cursorRestWorker.workerLoop;
