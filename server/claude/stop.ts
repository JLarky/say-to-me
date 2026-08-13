import { claudeDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  createStopSession,
  type StopExternalCliResult,
} from "../external-cli/create-stop-session.ts";
import { claudeBooWorkerName } from "../external-cli/providers.ts";
import { isClaudeSessionId } from "../session-id.ts";

export type StopClaudeResult = StopExternalCliResult;

export const stopClaudeSession = createStopSession({
  backendLabel: "claude",
  deliveryJobsTable: claudeDeliveryJobs,
  sessionIdColumn: claudeDeliveryJobs.claudeSessionId,
  isValidSessionId: isClaudeSessionId,
  invalidSessionIdError: "Invalid Claude session id.",
  workerName: claudeBooWorkerName,
});
