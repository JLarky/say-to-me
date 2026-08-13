import { cursorDeliveryJobs } from "../db/drizzle-schema.ts";
import {
  createStopSession,
  type StopExternalCliResult,
} from "../external-cli/create-stop-session.ts";
import { cursorBooWorkerName } from "../external-cli/providers.ts";
import { isCursorSessionId } from "../session-id.ts";

export type StopCursorResult = StopExternalCliResult;

export const stopCursorSession = createStopSession({
  backendLabel: "cursor",
  deliveryJobsTable: cursorDeliveryJobs,
  sessionIdColumn: cursorDeliveryJobs.cursorSessionId,
  isValidSessionId: isCursorSessionId,
  invalidSessionIdError: "Invalid Cursor session id.",
  workerName: cursorBooWorkerName,
});
