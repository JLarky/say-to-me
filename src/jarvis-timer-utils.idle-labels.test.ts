import { describe, expect, it } from "vite-plus/test";
import { routineLabelInput } from "./jarvis-timer-utils.ts";
import { sessionIdleRoutineTitle } from "@say-to-me/session-utils/routine-labels";
import { Routine, Session } from "./types.ts";

const ownerId = "cur_00000000-0000-4000-8000-0000000000aa";
const targetId = "cur_00000000-0000-4000-8000-0000000000bb";

describe("routineLabelInput idle display names", () => {
  it("resolves aliases into waiting for e2e target to go idle", () => {
    const routine = Routine.assert({
      id: 21,
      ownerSessionId: ownerId,
      title: `Wait for ${targetId}`,
      status: "active",
      trigger: {
        kind: "session_idle",
        targetSessionId: targetId,
        sourceMessageId: 1,
        afterWorkSeen: true,
      },
      action: { kind: "notify_owner" },
      lastFiredAt: null,
      lastMessageId: null,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: "2026-08-21 00:00:00",
      updatedAt: "2026-08-21 00:00:00",
    });
    const sessions = [
      Session.assert({
        id: ownerId,
        alias: "e2e source",
        state: "general",
        createdAt: "2026-08-21 00:00:00",
        updatedAt: "2026-08-21 00:00:00",
      }),
      Session.assert({
        id: targetId,
        alias: "e2e target",
        state: "general",
        createdAt: "2026-08-21 00:00:00",
        updatedAt: "2026-08-21 00:00:00",
      }),
    ];
    const labels = routineLabelInput(routine, ownerId, sessions);
    expect(sessionIdleRoutineTitle(labels)).toBe("waiting for e2e target to go idle");
  });
});
