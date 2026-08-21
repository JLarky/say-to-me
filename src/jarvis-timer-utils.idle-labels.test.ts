import { describe, expect, it } from "vite-plus/test";
import { routineLabelInput } from "./jarvis-timer-utils.ts";
import { sessionIdleRoutineTitle } from "@say-to-me/session-utils/routine-labels";
import { Routine, Session } from "./types.ts";

const ownerId = "cur_00000000-0000-4000-8000-0000000000aa";
const targetId = "cur_00000000-0000-4000-8000-0000000000bb";

function idleRoutine(): Routine {
  return Routine.assert({
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
}

function namedSessions(): Session[] {
  return [
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
}

describe("routineLabelInput idle display names", () => {
  it("source view: waiting for e2e target to go idle", () => {
    const labels = routineLabelInput(idleRoutine(), ownerId, namedSessions());
    expect(sessionIdleRoutineTitle(labels)).toBe("waiting for e2e target to go idle");
  });

  it("target view: will notify e2e source when idle", () => {
    const labels = routineLabelInput(idleRoutine(), targetId, namedSessions());
    expect(sessionIdleRoutineTitle(labels)).toBe("will notify e2e source when idle");
  });
});
