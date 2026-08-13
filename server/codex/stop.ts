import { codexDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  createStopSession,
  type StopExternalCliResult,
} from "../external-cli/create-stop-session.ts";
import { codexBooWorkerName } from "../external-cli/providers.ts";
import { isCodexSessionId } from "../session-id.ts";

export type StopCodexResult = StopExternalCliResult;

export const stopCodexSession = createStopSession({
  backendLabel: "codex",
  deliveryJobsTable: codexDeliveryJobs,
  sessionIdColumn: codexDeliveryJobs.codexSessionId,
  isValidSessionId: isCodexSessionId,
  invalidSessionIdError: "Invalid Codex session id.",
  workerName: codexBooWorkerName,
});
