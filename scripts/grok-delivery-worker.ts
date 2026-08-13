#!/usr/bin/env node
import { Effect } from "effect";
import { grokRestDeliveryWorkerLoop } from "../server/grok/rest-delivery-worker.ts";
import { workerVersion } from "../server/external-cli/worker-env.ts";
import { isGrokSessionId } from "../server/session-id.ts";

const sessionId = process.argv[2];

if (!sessionId || !isGrokSessionId(sessionId)) {
  console.error("Usage: grok-delivery-worker.ts <gr_session_id>");
  process.exit(1);
}

console.log(
  JSON.stringify({
    msg: "grok delivery worker started",
    mode: process.env.SAY_TO_ME_GROK_WORKER_MODE ?? "echo",
    pid: process.pid,
    sessionId,
    workerVersion: workerVersion("GROK"),
  }),
);

Effect.runPromise(grokRestDeliveryWorkerLoop(sessionId)).catch((error) => {
  console.error("[grok-delivery-worker] crashed:", error);
  process.exit(1);
});
