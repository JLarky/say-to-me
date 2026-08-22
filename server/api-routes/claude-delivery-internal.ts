import { createExternalCliDeliveryInternalDispatcher } from "../external-cli/delivery-internal.ts";
import { workerVersion } from "../external-cli/worker-env.ts";
import {
  cancelClaudeDeliveryJobFromWorker,
  claimClaudeDeliveryJobForWorker,
  completeClaudeDeliveryJobFromWorker,
  failClaudeDeliveryJobFromWorker,
  markClaudeDeliveryJobDispatchedFromWorker,
  markClaudeDeliveryJobCliTurnEndedFromWorker,
  markClaudeDeliveryJobUnconfirmedFromWorker,
  renewClaudeDeliveryJobFromWorker,
  retryClaudeDeliveryJobFromWorker,
  type ClaudeDeliveryLease,
} from "../claude/durable-delivery.ts";
import { scheduleClaudeBooWorkerReplacement } from "../external-cli/providers.ts";

export type { ClaudeDeliveryLease };

export const dispatchClaudeDeliveryInternalRequest =
  createExternalCliDeliveryInternalDispatcher<ClaudeDeliveryLease>({
    backendLabel: "Claude",
    basePath: "/api/internal/claude-delivery",
    sessionIdField: "claudeSessionId",
    sessionIdLeaseField: "claudeSessionId",
    workerVersion: workerVersion("CLAUDE"),
    scheduleWorkerReplacement: scheduleClaudeBooWorkerReplacement,
    claimDeliveryJobForWorker: claimClaudeDeliveryJobForWorker,
    completeDeliveryJobFromWorker: completeClaudeDeliveryJobFromWorker,
    retryDeliveryJobFromWorker: retryClaudeDeliveryJobFromWorker,
    failDeliveryJobFromWorker: failClaudeDeliveryJobFromWorker,
    markDeliveryJobDispatchedFromWorker: markClaudeDeliveryJobDispatchedFromWorker,
    markDeliveryJobCliTurnEndedFromWorker: markClaudeDeliveryJobCliTurnEndedFromWorker,
    markDeliveryJobUnconfirmedFromWorker: markClaudeDeliveryJobUnconfirmedFromWorker,
    cancelDeliveryJobFromWorker: cancelClaudeDeliveryJobFromWorker,
    renewDeliveryJobFromWorker: renewClaudeDeliveryJobFromWorker,
  });
