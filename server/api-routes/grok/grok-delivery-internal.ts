import { createExternalCliDeliveryInternalDispatcher } from "../../external-cli/delivery-internal.ts";
import { workerVersion } from "../../external-cli/worker-env.ts";
import {
  cancelGrokDeliveryJobFromWorker,
  claimGrokDeliveryJobForWorker,
  completeGrokDeliveryJobFromWorker,
  failGrokDeliveryJobFromWorker,
  renewGrokDeliveryJobFromWorker,
  retryGrokDeliveryJobFromWorker,
  type GrokDeliveryLease,
} from "../../grok/durable-delivery.ts";
import { scheduleGrokBooWorkerReplacement } from "../../external-cli/providers.ts";

export type { GrokDeliveryLease };

export const dispatchGrokDeliveryInternalRequest =
  createExternalCliDeliveryInternalDispatcher<GrokDeliveryLease>({
    backendLabel: "Grok",
    basePath: "/api/internal/grok-delivery",
    sessionIdField: "grokSessionId",
    sessionIdLeaseField: "grokSessionId",
    workerVersion: workerVersion("GROK"),
    scheduleWorkerReplacement: scheduleGrokBooWorkerReplacement,
    claimDeliveryJobForWorker: claimGrokDeliveryJobForWorker,
    completeDeliveryJobFromWorker: completeGrokDeliveryJobFromWorker,
    retryDeliveryJobFromWorker: retryGrokDeliveryJobFromWorker,
    failDeliveryJobFromWorker: failGrokDeliveryJobFromWorker,
    cancelDeliveryJobFromWorker: cancelGrokDeliveryJobFromWorker,
    renewDeliveryJobFromWorker: renewGrokDeliveryJobFromWorker,
  });
