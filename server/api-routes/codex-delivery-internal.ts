import { createExternalCliDeliveryInternalDispatcher } from "../external-cli/delivery-internal.ts";
import { workerVersion } from "../external-cli/worker-env.ts";
import {
  cancelCodexDeliveryJobFromWorker,
  claimCodexDeliveryJobForWorker,
  completeCodexDeliveryJobFromWorker,
  failCodexDeliveryJobFromWorker,
  markCodexDeliveryJobDispatchedFromWorker,
  markCodexDeliveryJobCliTurnEndedFromWorker,
  markCodexDeliveryJobUnconfirmedFromWorker,
  renewCodexDeliveryJobFromWorker,
  retryCodexDeliveryJobFromWorker,
  type CodexDeliveryLease,
} from "../codex/durable-delivery.ts";
import { scheduleCodexBooWorkerReplacement } from "../external-cli/providers.ts";

export type { CodexDeliveryLease };

export const dispatchCodexDeliveryInternalRequest =
  createExternalCliDeliveryInternalDispatcher<CodexDeliveryLease>({
    backendLabel: "Codex",
    basePath: "/api/internal/codex-delivery",
    sessionIdField: "codexSessionId",
    sessionIdLeaseField: "codexSessionId",
    workerVersion: workerVersion("CODEX"),
    scheduleWorkerReplacement: scheduleCodexBooWorkerReplacement,
    claimDeliveryJobForWorker: claimCodexDeliveryJobForWorker,
    completeDeliveryJobFromWorker: completeCodexDeliveryJobFromWorker,
    retryDeliveryJobFromWorker: retryCodexDeliveryJobFromWorker,
    failDeliveryJobFromWorker: failCodexDeliveryJobFromWorker,
    markDeliveryJobDispatchedFromWorker: markCodexDeliveryJobDispatchedFromWorker,
    markDeliveryJobCliTurnEndedFromWorker: markCodexDeliveryJobCliTurnEndedFromWorker,
    markDeliveryJobUnconfirmedFromWorker: markCodexDeliveryJobUnconfirmedFromWorker,
    cancelDeliveryJobFromWorker: cancelCodexDeliveryJobFromWorker,
    renewDeliveryJobFromWorker: renewCodexDeliveryJobFromWorker,
  });
