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
});
