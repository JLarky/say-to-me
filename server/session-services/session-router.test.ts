import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-session-router-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { drizzleDb, drizzleSqlite } = await import("../db/index.ts");
const { paseoDeliveryJobs, t3DeliveryJobs } = await import("../db/drizzle-schema.ts");
const { insertMessageRow } = await import("../messages.ts");
const { enqueueDelivery } = await import("./session-router.ts");

describe("enqueueDelivery", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("routes T3 delivery through the durable T3 queue", async () => {
    const message = insertMessageRow({
      sessionId: "ses_e7629ddd9064axVSyjejHALLdN",
      text: "Timer fired",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    await Effect.runPromise(
      enqueueDelivery("t3_11111111-1111-4111-8111-111111111111", {
        messageId: message.id,
        messageSessionId: "ses_e7629ddd9064axVSyjejHALLdN",
        kind: "direct_user_message",
      }),
    );

    const jobs = drizzleDb.select().from(t3DeliveryJobs).all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      messageId: message.id,
      messageSessionId: "ses_e7629ddd9064axVSyjejHALLdN",
      t3SessionId: "t3_11111111-1111-4111-8111-111111111111",
      kind: "direct_user_message",
    });
  });

  it("routes Paseo delivery through the durable Paseo queue", async () => {
    const message = insertMessageRow({
      sessionId: "ses_e7629ddd9064axVSyjejHALLdN",
      text: "Timer fired for Paseo",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    await Effect.runPromise(
      enqueueDelivery("pa_11111111-1111-4111-8111-111111111111", {
        messageId: message.id,
        messageSessionId: "ses_e7629ddd9064axVSyjejHALLdN",
        kind: "direct_user_message",
      }),
    );
    expect(drizzleDb.select().from(paseoDeliveryJobs).all()).toContainEqual(
      expect.objectContaining({
        messageId: message.id,
        paseoSessionId: "pa_11111111-1111-4111-8111-111111111111",
      }),
    );
  });
});
