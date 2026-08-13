import type { SessionRuntimeInspection } from "../sessionRuntime.ts";
import type { OpenCodeStatus } from "../../src/types.ts";

const workingActivityStatuses = new Set(["busy", "pending", "retrying"]);

export type TimeoutDeliveryStatus = "pending" | "cli_timed_out";

export function classifyCliTimeoutFromActivity(
  activity: Pick<SessionRuntimeInspection, "latestActivityAt" | "latestActivitySnapshot"> | null,
  deliveryStartedAt: number,
  currentStatus?: typeof OpenCodeStatus.infer | null,
): TimeoutDeliveryStatus {
  const activityAt = activity?.latestActivityAt;
  const activityStatus = activity?.latestActivitySnapshot?.status;
  if (
    typeof activityAt === "number" &&
    activityAt >= deliveryStartedAt &&
    typeof activityStatus === "string" &&
    workingActivityStatuses.has(activityStatus)
  ) {
    return "pending";
  }
  if (currentStatus === "pending") return "pending";
  return "cli_timed_out";
}
