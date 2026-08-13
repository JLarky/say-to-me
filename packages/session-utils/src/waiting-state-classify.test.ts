import { describe, expect, it } from "vite-plus/test";
import { classifyWaitingState } from "./waiting-state-classify.ts";

const agent = (text: string) => ({
  author: "agent" as const,
  text,
  opencodeDeliveryStatus: null,
});
const user = (text: string, opencodeDeliveryStatus: string | null = null) => ({
  author: "user" as const,
  text,
  opencodeDeliveryStatus,
});

describe("classifyWaitingState", () => {
  it("returns unknown for an empty session", () => {
    expect(classifyWaitingState({ opencodeStatus: null, messages: [] })).toMatchObject({
      state: "unknown",
    });
  });

  it("returns blocked when the last user message failed to deliver", () => {
    for (const delivery of ["failed", "cli_timed_out"]) {
      expect(
        classifyWaitingState({ opencodeStatus: "idle", messages: [user("hi", delivery)] }),
      ).toMatchObject({ state: "blocked", action: "Retry delivery" });
    }
  });

  it("returns working while a user message is pending delivery or the agent is busy", () => {
    expect(
      classifyWaitingState({ opencodeStatus: "idle", messages: [user("hi", "pending")] }),
    ).toMatchObject({ state: "working" });
    expect(
      classifyWaitingState({ opencodeStatus: "pending", messages: [user("hi", "sent")] }),
    ).toMatchObject({ state: "working" });
    expect(
      classifyWaitingState({ opencodeStatus: "pending", messages: [agent("checking tests")] }),
    ).toMatchObject({ state: "working" });
  });

  it("returns needs_answer when the agent is idle after asking a question", () => {
    expect(
      classifyWaitingState({
        opencodeStatus: "idle",
        messages: [user("go", "sent"), agent("Done.\n\nShould I also update the docs?")],
      }),
    ).toMatchObject({ state: "needs_answer", action: "Answer question" });
  });

  it("returns can_continue when the agent is idle after a statement", () => {
    expect(
      classifyWaitingState({ opencodeStatus: "idle", messages: [agent("Tests pass.")] }),
    ).toMatchObject({ state: "can_continue", action: "Send please continue" });
  });

  it("returns working after a delivered user message while waiting on the agent", () => {
    expect(
      classifyWaitingState({ opencodeStatus: "idle", messages: [user("hi", "sent")] }),
    ).toMatchObject({ state: "working" });
  });

  it("returns unknown when OpenCode status is unavailable or unreachable", () => {
    expect(
      classifyWaitingState({ opencodeStatus: "unavailable", messages: [agent("Tests pass.")] }),
    ).toMatchObject({ state: "unknown" });
    expect(
      classifyWaitingState({ opencodeStatus: "unreachable", messages: [agent("Tests pass.")] }),
    ).toMatchObject({ state: "unknown" });
    // Unavailable overrides delivery status: no delivery state should produce working
    for (const delivery of ["sent", "pending", "failed", "cli_timed_out", null]) {
      expect(
        classifyWaitingState({ opencodeStatus: "unavailable", messages: [user("hi", delivery)] }),
      ).toMatchObject({ state: "unknown" });
      expect(
        classifyWaitingState({ opencodeStatus: "unreachable", messages: [user("hi", delivery)] }),
      ).toMatchObject({ state: "unknown" });
    }
  });

  it("infers can_continue from an agent message when OpenCode status is missing", () => {
    expect(
      classifyWaitingState({ opencodeStatus: null, messages: [agent("Tests pass.")] }),
    ).toMatchObject({ state: "can_continue", action: "Send please continue" });
  });

  it("returns needs_answer when OpenCode is pending and awaiting input", () => {
    expect(
      classifyWaitingState({
        opencodeStatus: "pending",
        activityStatus: "awaiting-input",
        messages: [agent("Which option?")],
      }),
    ).toMatchObject({ state: "needs_answer", action: "Answer question in OpenCode" });
  });
});
