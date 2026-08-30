import type { SessionRuntimeInspection } from "../sessionRuntime.ts";
import type { OpenCodeStatus } from "../../src/types.ts";

const workingActivityStatuses = new Set(["busy", "pending", "retrying"]);
const workingSessionStatuses = new Set(["pending", "retrying"]);

export type TimeoutDeliveryStatus = "pending" | "cli_timed_out";

/** True when OpenCode is still on this turn, so a lost HTTP call is not a failed prompt. */
export function openCodeDeliveryLooksInFlight(
  activity: Pick<SessionRuntimeInspection, "latestActivityAt" | "latestActivitySnapshot"> | null,
  deliveryStartedAt: number,
  currentStatus?: typeof OpenCodeStatus.infer | null,
): boolean {
  const activityAt = activity?.latestActivityAt;
  const activityStatus = activity?.latestActivitySnapshot?.status;
  if (
    typeof activityAt === "number" &&
    activityAt >= deliveryStartedAt &&
    typeof activityStatus === "string" &&
    workingActivityStatuses.has(activityStatus)
  ) {
    return true;
  }
  return currentStatus != null && workingSessionStatuses.has(currentStatus);
}

export function classifyCliTimeoutFromActivity(
  activity: Pick<SessionRuntimeInspection, "latestActivityAt" | "latestActivitySnapshot"> | null,
  deliveryStartedAt: number,
  currentStatus?: typeof OpenCodeStatus.infer | null,
): TimeoutDeliveryStatus {
  return openCodeDeliveryLooksInFlight(activity, deliveryStartedAt, currentStatus)
    ? "pending"
    : "cli_timed_out";
}

export function classifyInterruptedApiDelivery(
  activity: Pick<SessionRuntimeInspection, "latestActivityAt" | "latestActivitySnapshot"> | null,
  deliveryStartedAt: number,
  currentStatus?: typeof OpenCodeStatus.infer | null,
): "pending" | "failed" {
  return openCodeDeliveryLooksInFlight(activity, deliveryStartedAt, currentStatus)
    ? "pending"
    : "failed";
}
