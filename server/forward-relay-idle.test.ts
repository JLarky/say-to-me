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

  it("no-ops a second idle wait for the same owner and target", async () => {
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
      targetText: "duplicate wait must no-op",
      links: null,
      sourceSessionRefs: JSON.stringify([{ id: targetSessionId }]),
      targetSessionRefs: JSON.stringify([{ id: sourceSessionId }]),
      clientMessageId: null,
      notifyOnCompletion: true,
    });

    expect(findSessionIdleRoutineBySourceMessageId(first.sourceMessage.id)).toMatchObject({
      status: "active",
      trigger: { sourceMessageId: first.sourceMessage.id },
    });
    expect(findSessionIdleRoutineBySourceMessageId(second.sourceMessage.id)).toBeNull();
    expect(second.targetMessage.completionWatchStatus).toBeNull();
    expect(
      drizzleDb.select().from(routines).where(eq(routines.ownerSessionId, sourceSessionId)).all(),
    ).toHaveLength(1);
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
