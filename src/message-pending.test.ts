import { describe, expect, it } from "vite-plus/test";
import { payloadRevision, shouldApplyPayload } from "./use-session-sync.ts";
import {
  buildMessages,
  createPendingMessage,
  failPendingMessage,
  mergeMessagesWithPending,
  replacePendingMessage,
  upsertPendingMessage,
} from "./utils.ts";
import type { Message } from "./types.ts";

function message(overrides: Partial<Message>): Message {
  return {
    id: 1,
    text: "Long agent message",
    status: "speaking",
    author: "agent",
    sessionId: "default",
    ...overrides,
  };
}

describe("pending messages", () => {
  it("keeps pending messages above persisted messages", () => {
    const pending = createPendingMessage({
      id: "pending-test",
      author: "user",
      sessionId: "default",
      text: "optimistic message",
    });

    expect(buildMessages([message({ id: 10 }), pending]).map((item) => item.id)).toEqual([
      "pending-test",
      10,
    ]);
  });

  it("preserves pending messages across server refreshes", () => {
    const pending = createPendingMessage({
      id: "pending-test",
      author: "user",
      sessionId: "default",
      text: "optimistic message",
    });

    expect(mergeMessagesWithPending([message({ id: 11, text: "server" })], [pending])).toEqual([
      message({ id: 11, text: "server" }),
      pending,
    ]);
  });

  it("uses session revisions as metadata without dropping full snapshots", () => {
    expect(payloadRevision({ revision: 3 })).toBe(3);
    expect(
      payloadRevision({ session: { id: "ses_e946608d8f44iE5XvXLyK7tlO9", revision: 4 } }),
    ).toBe(4);
    expect(payloadRevision({ messages: [message({ id: 7 }), message({ id: 2 })] })).toBe(7);
    expect(shouldApplyPayload(5, { revision: 4 })).toBe(true);
    expect(shouldApplyPayload(5, { revision: 5 })).toBe(true);
    expect(shouldApplyPayload(5, { revision: 6 })).toBe(true);
  });

  it("drops a pending message when its server counterpart already arrived via SSE", () => {
    // Race: replacePendingMessage ran and added #12 to React state, but an SSE
    // push fires before the state update settles, so currentMessages still
    // contains the pending entry alongside #12.
    const pending = createPendingMessage({
      id: "pending-test",
      author: "user",
      sessionId: "default",
      text: "optimistic message",
    });
    const serverMessage = message({
      id: 12,
      author: "user",
      status: "received",
      text: "optimistic message",
    });

    // State after replacePendingMessage ran (pending removed, server message added)
    // but SSE fires concurrently with currentMessages still containing both.
    const currentMessages = [serverMessage, pending];
    const sseMessages = [message({ id: 10, text: "other" }), serverMessage];

    const merged = mergeMessagesWithPending(sseMessages, currentMessages);

    // pending must not appear — the server message is already present
    expect(merged.some((m) => m.pending)).toBe(false);
    expect(merged.map((m) => m.id)).toContain(12);
  });

  it("transitions optimistic messages through pending, failed, and replaced states", () => {
    const pending = createPendingMessage({
      id: "pending-test",
      author: "user",
      sessionId: "default",
      text: "optimistic message",
    });
    const serverMessage = message({
      id: 12,
      author: "user",
      status: "received",
      text: "optimistic message",
    });

    const withPending = upsertPendingMessage([message({ id: 10 })], pending);
    expect(withPending[0]).toBe(pending);

    const failed = failPendingMessage(withPending, "pending-test", "Unable to submit message.");
    expect(failed[0]).toMatchObject({ status: "failed", error: "Unable to submit message." });

    const retrying = upsertPendingMessage(failed, { ...failed[0], status: "pending", error: null });
    expect(retrying[0]).toMatchObject({ status: "pending", error: null });

    const replaced = replacePendingMessage(retrying, "pending-test", serverMessage);
    expect(replaced.map((item) => item.id)).toEqual([12, 10]);
  });
});
