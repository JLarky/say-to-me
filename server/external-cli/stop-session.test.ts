import { describe, expect, it } from "vite-plus/test";
import { stopExternalCliSession } from "./stop-session.ts";

describe("stopExternalCliSession", () => {
  it("skips message updates when cancelJob loses the status race", async () => {
    let cancelCalls = 0;
    let messageReads = 0;

    const result = await stopExternalCliSession({
      sessionId: "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb",
      isValidSessionId: () => true,
      invalidSessionIdError: "nope",
      listActiveJobs: () => {
        messageReads += 1;
        return [{ id: 1, messageId: 42 }];
      },
      cancelJob: (jobId) => {
        cancelCalls += 1;
        expect(jobId).toBe(1);
        return 0;
      },
      killWorker: async () => {},
    });

    expect(result).toEqual({ ok: true });
    expect(cancelCalls).toBe(1);
    expect(messageReads).toBe(1);
  });

  it("busyOnly + keepMessageIds scope which jobs a stop cancels", async () => {
    const cancelled: number[] = [];

    // Message ids that exist nowhere: markDeliveryStoppedByUser is skipped for
    // missing rows, keeping this test on the cancellation-scoping behavior.
    const result = await stopExternalCliSession({
      sessionId: "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb",
      isValidSessionId: () => true,
      invalidSessionIdError: "nope",
      listActiveJobs: () => [
        { id: 1, messageId: 9900011, status: "running" },
        { id: 2, messageId: 9900012, status: "pending" },
        { id: 3, messageId: 9900013, status: "running" },
      ],
      cancelJob: (jobId) => {
        cancelled.push(jobId);
        return 1;
      },
      keepMessageIds: [9900013],
      busyOnly: true,
      killWorker: async () => {},
    });

    expect(result).toEqual({ ok: true });
    // The queued-but-idle sibling (2) survives a busyOnly stop; the forced
    // message's own job (3) survives via keepMessageIds; only the live turn
    // holding the provider (1) is cancelled.
    expect(cancelled).toEqual([1]);
  });
});
