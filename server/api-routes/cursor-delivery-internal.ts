import { createExternalCliDeliveryInternalDispatcher } from "../external-cli/delivery-internal.ts";
import { workerVersion } from "../external-cli/worker-env.ts";
import {
  cancelCursorDeliveryJobFromWorker,
  claimCursorDeliveryJobForWorker,
  completeCursorDeliveryJobFromWorker,
  failCursorDeliveryJobFromWorker,
  markCursorDeliveryJobDispatchedFromWorker,
  markCursorDeliveryJobCliTurnEndedFromWorker,
  markCursorDeliveryJobUnconfirmedFromWorker,
  renewCursorDeliveryJobFromWorker,
  retryCursorDeliveryJobFromWorker,
  type CursorDeliveryLease,
} from "../cursor/durable-delivery.ts";
import { scheduleCursorBooWorkerReplacement } from "../external-cli/providers.ts";

export type { CursorDeliveryLease };

export const dispatchCursorDeliveryInternalRequest =
  createExternalCliDeliveryInternalDispatcher<CursorDeliveryLease>({
    backendLabel: "Cursor",
    basePath: "/api/internal/cursor-delivery",
    sessionIdField: "cursorSessionId",
    sessionIdLeaseField: "cursorSessionId",
    workerVersion: workerVersion("CURSOR"),
    scheduleWorkerReplacement: scheduleCursorBooWorkerReplacement,
    claimDeliveryJobForWorker: claimCursorDeliveryJobForWorker,
    completeDeliveryJobFromWorker: completeCursorDeliveryJobFromWorker,
    retryDeliveryJobFromWorker: retryCursorDeliveryJobFromWorker,
    failDeliveryJobFromWorker: failCursorDeliveryJobFromWorker,
    markDeliveryJobDispatchedFromWorker: markCursorDeliveryJobDispatchedFromWorker,
    markDeliveryJobCliTurnEndedFromWorker: markCursorDeliveryJobCliTurnEndedFromWorker,
    markDeliveryJobUnconfirmedFromWorker: markCursorDeliveryJobUnconfirmedFromWorker,
    cancelDeliveryJobFromWorker: cancelCursorDeliveryJobFromWorker,
    renewDeliveryJobFromWorker: renewCursorDeliveryJobFromWorker,
  });
