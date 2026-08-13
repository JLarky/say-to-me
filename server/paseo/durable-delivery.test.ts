import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { PaseoCommandError } from "./client.ts";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-paseo-delivery-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { drizzleDb, drizzleSqlite } = await import("../db/index.ts");
const { paseoDeliveryJobs } = await import("../db/drizzle-schema.ts");
const { insertMessageRow } = await import("../messages.ts");
const {
  enqueuePaseoDeliveryJob,
  ensurePaseoDeliveryJobForMessage,
  getPaseoDeliveryJob,
  resumePaseoDeliveryWorkers,
  shouldRetryPaseoDelivery,
  stopPaseoDeliveryWorker,
} = await import("./durable-delivery.ts");

describe("Paseo durable delivery", () => {
  beforeEach(() => {
    drizzleDb.delete(paseoDeliveryJobs).run();
  });

  afterAll(async () => {
    await stopPaseoDeliveryWorker();
    drizzleSqlite.close();
    rmSync(testDbDir, { recursive: true, force: true });
  });

  it("does not reset terminal jobs during startup reconciliation", () => {
    const message = insertMessageRow({
      sessionId: "pa_11111111-1111-4111-8111-111111111111",
      text: "do not replay",
      author: "user",
      status: "received",
      extraMarkdown: null,
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueuePaseoDeliveryJob({
      messageId: message.id,
      messageSessionId: message.sessionId,
      paseoSessionId: message.sessionId,
      kind: "direct_user_message",
    });
    drizzleDb.update(paseoDeliveryJobs).set({ status: "failed", attemptCount: 3 }).run();
    resumePaseoDeliveryWorkers();
    expect(getPaseoDeliveryJob(message.id, "direct_user_message")).toMatchObject({
      status: "failed",
      attemptCount: 3,
    });
  });

  it("allows an explicit client retry to reset a failed job", () => {
    const message = insertMessageRow({
      sessionId: "pa_22222222-2222-4222-8222-222222222222",
      text: "retry me",
      author: "user",
      status: "received",
      extraMarkdown: null,
      links: null,
      sessionRefs: null,
      clientMessageId: "retry-key",
    });
    enqueuePaseoDeliveryJob({
      messageId: message.id,
      messageSessionId: message.sessionId,
      paseoSessionId: message.sessionId,
      kind: "direct_user_message",
    });
    drizzleDb.update(paseoDeliveryJobs).set({ status: "failed", attemptCount: 3 }).run();
    ensurePaseoDeliveryJobForMessage(message.id, { retryFailed: true });
    expect(getPaseoDeliveryJob(message.id, "direct_user_message")).toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
  });

  it("does not retry acceptance-ambiguous failures", () => {
    expect(shouldRetryPaseoDelivery(new PaseoCommandError("acceptance unknown", false), 1, 3)).toBe(
      false,
    );
    expect(shouldRetryPaseoDelivery(new PaseoCommandError("spawn failed", true), 1, 3)).toBe(true);
  });

  it("does not reset an ambiguous job on explicit retry", () => {
    const message = insertMessageRow({
      sessionId: "pa_33333333-3333-4333-8333-333333333333",
      text: "possibly accepted",
      author: "user",
      status: "received",
      extraMarkdown: null,
      links: null,
      sessionRefs: null,
      clientMessageId: "ambiguous-key",
    });
    enqueuePaseoDeliveryJob({
      messageId: message.id,
      messageSessionId: message.sessionId,
      paseoSessionId: message.sessionId,
      kind: "direct_user_message",
    });
    drizzleDb.update(paseoDeliveryJobs).set({ status: "ambiguous", attemptCount: 1 }).run();
    ensurePaseoDeliveryJobForMessage(message.id, { retryFailed: true });
    expect(getPaseoDeliveryJob(message.id, "direct_user_message")).toMatchObject({
      status: "ambiguous",
      attemptCount: 1,
    });
  });
});
