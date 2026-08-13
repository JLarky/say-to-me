import { grokDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  createStopSession,
  type StopExternalCliResult,
} from "../external-cli/create-stop-session.ts";
import { grokBooWorkerName } from "../external-cli/providers.ts";
import { isGrokSessionId } from "../session-id.ts";

export type StopGrokResult = StopExternalCliResult;

export const stopGrokSession = createStopSession({
  backendLabel: "grok",
  deliveryJobsTable: grokDeliveryJobs,
  sessionIdColumn: grokDeliveryJobs.grokSessionId,
  isValidSessionId: isGrokSessionId,
  invalidSessionIdError: "Invalid Grok session id.",
  workerName: grokBooWorkerName,
});
