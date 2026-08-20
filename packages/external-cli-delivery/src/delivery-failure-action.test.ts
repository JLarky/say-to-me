import { describe, expect, it } from "vite-plus/test";
import {
  deliveryFailureAction,
  DeliveryLeaseLostError,
  ProviderFailedError,
  ProviderNotStartedError,
} from "./workflow.ts";

const notStarted = new ProviderNotStartedError({ message: "spawn ENOENT" });
const ranAndFailed = new ProviderFailedError({ message: "exited with code 1" });
const leaseLost = new DeliveryLeaseLostError({ message: "another worker owns this job" });

function action(
  failure: ProviderNotStartedError | ProviderFailedError | DeliveryLeaseLostError,
  promptDispatched: boolean,
  attemptCount = 1,
  maxAttempts = 3,
) {
  return deliveryFailureAction({ failure, promptDispatched, attemptCount, maxAttempts })._tag;
}

describe("deliveryFailureAction", () => {
  it("abandons a job whose lease is gone, whatever the marker says", () => {
    expect(action(leaseLost, false)).toBe("abandon");
    expect(action(leaseLost, true)).toBe("abandon");
    expect(action(leaseLost, true, 3, 3)).toBe("abandon");
  });

  it("retries a provider that never started, even once the job is dispatched", () => {
    expect(action(notStarted, false)).toBe("retry");
    expect(action(notStarted, true)).toBe("retry");
  });

  it("reports a dispatched job whose provider ran and failed as unconfirmed", () => {
    expect(action(ranAndFailed, true)).toBe("unconfirmed");
  });

  it("keeps a dispatched job terminal no matter how many attempts remain", () => {
    expect(action(ranAndFailed, true, 1, 10)).toBe("unconfirmed");
  });

  it("retries an un-dispatched job whose provider ran and failed", () => {
    expect(action(ranAndFailed, false)).toBe("retry");
  });

  it("fails terminally once the attempt budget for a retryable failure is spent", () => {
    expect(action(notStarted, true, 3, 3)).toBe("failed");
    expect(action(ranAndFailed, false, 3, 3)).toBe("failed");
  });

  it("carries the failure message into the recorded outcome", () => {
    expect(
      deliveryFailureAction({
        failure: ranAndFailed,
        promptDispatched: true,
        attemptCount: 1,
        maxAttempts: 3,
      }),
    ).toEqual({ _tag: "unconfirmed", error: "exited with code 1" });
  });
});
