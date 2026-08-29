import { describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createForwardRelayWithOptionalIdleWait } from "./forward-relay-idle.ts";
import { createTestSession } from "./api.harness.ts";
import { drizzleDb } from "./db/index.ts";
import { messages, routines } from "./db/drizzle-schema.ts";
import { findSessionIdleRoutineBySourceMessageId } from "./routines.ts";

describe("forward relay + session_idle atomic create", () => {
  it("creates messages and routine together when notifyOnCompletion is true", async () => {
    const sourceSessionId = "ses_atomicOwnerA1WaitOk001";
    const targetSessionId = "ses_atomicTargetB1WaitOk01";
    await createTestSession(sourceSessionId);
    await createTestSession(targetSessionId);

    const { sourceMessage, targetMessage } = createForwardRelayWithOptionalIdleWait({
      sessionId: sourceSessionId,
      targetSessionId,
      sourceText: "<say-to-me-system>relay</say-to-me-system>",
      targetText: "please handle this",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });

    expect(targetMessage.completionWatchStatus).toBe("watching");
    expect(findSessionIdleRoutineBySourceMessageId(sourceMessage.id)).toMatchObject({
      status: "active",
      ownerSessionId: sourceSessionId,
      trigger: {
        kind: "session_idle",
        targetSessionId,
        sourceMessageId: sourceMessage.id,
      },
    });
  });

  it("rebinds an existing idle wait to the new source instead of stacking duplicates", async () => {
    const sourceSessionId = "ses_atomicOwnerA3WaitDup03";
    const targetSessionId = "ses_atomicTargetB3WaitDup3";
    await createTestSession(sourceSessionId);
    await createTestSession(targetSessionId);

    const first = createForwardRelayWithOptionalIdleWait({
      sessionId: sourceSessionId,
      targetSessionId,
      sourceText: "<say-to-me-system>relay 1</say-to-me-system>",
      targetText: "first wait",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });
    const second = createForwardRelayWithOptionalIdleWait({
      sessionId: sourceSessionId,
      targetSessionId,
      sourceText: "<say-to-me-system>relay 2</say-to-me-system>",
      armedSourceText:
        "<say-to-me-system>relay 2. You will be notified once the session is idle.</say-to-me-system>",
      targetText: "duplicate wait must rebind",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });

    expect(first.idleWaitArmed).toBe(true);
    expect(second.idleWaitArmed).toBe(true);
    expect(findSessionIdleRoutineBySourceMessageId(first.sourceMessage.id)).toBeNull();
    expect(findSessionIdleRoutineBySourceMessageId(second.sourceMessage.id)).toMatchObject({
      status: "active",
      trigger: { sourceMessageId: second.sourceMessage.id, targetSessionId },
    });
    expect(first.targetMessage.completionWatchStatus).toBe("watching");
    const firstTargetAfter = drizzleDb
      .select()
      .from(messages)
      .where(eq(messages.id, first.targetMessage.id))
      .get();
    expect(firstTargetAfter?.completionWatchStatus).toBe("cancelled");
    expect(second.targetMessage.completionWatchStatus).toBe("watching");
    expect(second.sourceMessage.text).toContain("You will be notified once the session is idle");
    expect(
      drizzleDb.select().from(routines).where(eq(routines.ownerSessionId, sourceSessionId)).all(),
    ).toHaveLength(1);
  });

  it("rebinding a stuck active wait lets a later relay arm a fresh watch", async () => {
    // Voice/none targets never complete work_seen; without rebind the first wait
    // would permanently swallow later notify relays to the same target.
    const sourceSessionId = "ses_atomicOwnerA5WaitStuck5";
    const targetSessionId = "ses_atomicTargetB5WaitStuck";
    await createTestSession(sourceSessionId);
    await createTestSession(targetSessionId);

    const stuck = createForwardRelayWithOptionalIdleWait({
      sessionId: sourceSessionId,
      targetSessionId,
      sourceText: "<say-to-me-system>stuck wait</say-to-me-system>",
      targetText: "voice target never idles after work",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });
    expect(stuck.idleWaitArmed).toBe(true);
    expect(stuck.targetMessage.completionWatchStatus).toBe("watching");

    const later = createForwardRelayWithOptionalIdleWait({
      sessionId: sourceSessionId,
      targetSessionId,
      sourceText: "<say-to-me-system>later relay</say-to-me-system>",
      armedSourceText:
        "<say-to-me-system>later relay. You will be notified once the session is idle.</say-to-me-system>",
      targetText: "must not be blocked by stuck wait",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });

    expect(later.idleWaitArmed).toBe(true);
    expect(later.targetMessage.completionWatchStatus).toBe("watching");
    expect(later.targetMessage.completionSourceMessageId).toBe(later.sourceMessage.id);
    expect(findSessionIdleRoutineBySourceMessageId(stuck.sourceMessage.id)).toBeNull();
    expect(findSessionIdleRoutineBySourceMessageId(later.sourceMessage.id)).toMatchObject({
      status: "active",
      trigger: { sourceMessageId: later.sourceMessage.id },
    });
    const stuckTarget = drizzleDb
      .select()
      .from(messages)
      .where(eq(messages.id, stuck.targetMessage.id))
      .get();
    expect(stuckTarget?.completionWatchStatus).toBe("cancelled");
  });

  it("still creates a distinct idle wait for a different target", async () => {
    const sourceSessionId = "ses_atomicOwnerA4WaitFan04";
    const targetOne = "ses_atomicTargetB4WaitFan41";
    const targetTwo = "ses_atomicTargetB4WaitFan42";
    await createTestSession(sourceSessionId);
    await createTestSession(targetOne);
    await createTestSession(targetTwo);

    createForwardRelayWithOptionalIdleWait({
      sessionId: sourceSessionId,
      targetSessionId: targetOne,
      sourceText: "<say-to-me-system>relay a</say-to-me-system>",
      targetText: "wait a",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetOne }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });
    const second = createForwardRelayWithOptionalIdleWait({
      sessionId: sourceSessionId,
      targetSessionId: targetTwo,
      sourceText: "<say-to-me-system>relay b</say-to-me-system>",
      targetText: "wait b",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetTwo }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });

    expect(findSessionIdleRoutineBySourceMessageId(second.sourceMessage.id)).toMatchObject({
      status: "active",
      trigger: { targetSessionId: targetTwo },
    });
    expect(
      drizzleDb.select().from(routines).where(eq(routines.ownerSessionId, sourceSessionId)).all(),
    ).toHaveLength(2);
  });

  it("rolls back watching target when routine create fails", async () => {
    const sourceSessionId = "ses_atomicOwnerA2WaitFail02";
    const targetSessionId = "ses_atomicTargetB2WaitFail2";
    await createTestSession(sourceSessionId);
    await createTestSession(targetSessionId);

    const beforeMessages = drizzleDb.select().from(messages).all().length;
    const beforeRoutines = drizzleDb.select().from(routines).all().length;

    expect(() =>
      createForwardRelayWithOptionalIdleWait(
        {
          sessionId: sourceSessionId,
          targetSessionId,
          sourceText: "<say-to-me-system>relay fail</say-to-me-system>",
          targetText: "orphan must not remain",
          links: null,
          sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
          targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
          clientMessageId: "atomic-fail-client-1",
          notifyOnCompletion: true,
        },
        {
          failBeforeRoutineCommit: () => {
            throw new Error("forced routine create failure");
          },
        },
      ),
    ).toThrow(/forced routine create failure/);

    expect(drizzleDb.select().from(messages).all()).toHaveLength(beforeMessages);
    expect(drizzleDb.select().from(routines).all()).toHaveLength(beforeRoutines);
    expect(
      drizzleDb
        .select()
        .from(messages)
        .where(eq(messages.clientMessageId, "atomic-fail-client-1"))
        .all(),
    ).toHaveLength(0);
    expect(
      drizzleDb.select().from(messages).where(eq(messages.text, "orphan must not remain")).all(),
    ).toHaveLength(0);
  });
});
