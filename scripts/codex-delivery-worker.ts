#!/usr/bin/env node
import { Effect } from "effect";
import { codexRestDeliveryWorkerLoop } from "../server/codex/rest-delivery-worker.ts";
import { workerVersion } from "../server/external-cli/worker-env.ts";
import { isCodexSessionId } from "../server/session-id.ts";

const sessionId = process.argv[2];

if (!sessionId || !isCodexSessionId(sessionId)) {
  console.error("Usage: codex-delivery-worker.ts <cx_session_id>");
  process.exit(1);
}

console.log(
  JSON.stringify({
    msg: "codex delivery worker started",
    mode: process.env.SAY_TO_ME_CODEX_WORKER_MODE ?? "echo",
    pid: process.pid,
    sessionId,
    workerVersion: workerVersion("CODEX"),
  }),
);

Effect.runPromise(codexRestDeliveryWorkerLoop(sessionId)).catch((error) => {
  console.error("[codex-delivery-worker] crashed:", error);
  process.exit(1);
});
