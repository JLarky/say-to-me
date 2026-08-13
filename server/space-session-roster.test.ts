import { describe, expect, it } from "vite-plus/test";

import {
  compareSpaceRosterSessions,
  deriveSpaceRosterStatus,
  isInternalRosterNotice,
  pickLatestMeaningfulMessageFacts,
  sortSpaceRosterSessions,
  type SpaceRosterSession,
} from "./space-session-roster.ts";

function session(
  overrides: Partial<SpaceRosterSession> & Pick<SpaceRosterSession, "id" | "rosterStatus">,
): SpaceRosterSession {
  return {
    title: overrides.id,
    agent: "OpenCode",
    provider: "OpenCode",
    model: "gpt",
    status: "Attached",
    tone: "blue",
    rosterStatusLabel: overrides.rosterStatus.toUpperCase(),
    workspacePath: null,
    workspaceLabel: null,
    importedAt: null,
    latestSayMessage: null,
    latestSayAuthor: null,
    latestSayAt: null,
    latestDeliveryStatus: null,
    latestDeliveryError: null,
    latestActivityText: null,
    activityAt: null,
    cachedOpenCodeStatus: null,
    cachedActivityStatus: null,
    timerSummary: null,
    ...overrides,
  };
}

describe("space session roster derivation", () => {
  const nowMs = Date.parse("2026-07-19T12:00:00Z");

  it("maps delivery failure to error", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: "idle",
        cachedActivityStatus: null,
        latestDeliveryStatus: "failed",
        latestDeliveryError: "boom",
        nowMs,
      }),
    ).toEqual({ rosterStatus: "error", rosterStatusLabel: "ERROR" });
  });

  it("maps awaiting-input cache to attention", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: "pending",
        cachedActivityStatus: "awaiting-input",
        latestDeliveryStatus: "sent",
        latestDeliveryError: null,
        nowMs,
      }),
    ).toEqual({ rosterStatus: "attention", rosterStatusLabel: "NEEDS INPUT" });
  });

  it("maps pending cache to working", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: "pending",
        cachedActivityStatus: null,
        latestDeliveryStatus: null,
        latestDeliveryError: null,
        nowMs,
      }),
    ).toEqual({ rosterStatus: "working", rosterStatusLabel: "WORKING" });
  });

  it("maps idle cache to idle", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: "idle",
        cachedActivityStatus: null,
        latestDeliveryStatus: null,
        latestDeliveryError: null,
        nowMs,
      }),
    ).toEqual({ rosterStatus: "idle", rosterStatusLabel: "IDLE" });
  });

  it("maps OpenCode error status to ERROR ahead of stale idle activity", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: "error",
        cachedActivityStatus: "idle",
        latestDeliveryStatus: null,
        latestDeliveryError: null,
        nowMs,
      }),
    ).toEqual({ rosterStatus: "error", rosterStatusLabel: "ERROR" });
  });

  it("maps retrying with a reason to an inline retrying label", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: "retrying",
        cachedOpenCodeStatusReason: "Free usage exceeded, subscribe to Go",
        cachedActivityStatus: null,
        latestDeliveryStatus: null,
        latestDeliveryError: null,
        nowMs,
      }),
    ).toEqual({
      rosterStatus: "attention",
      rosterStatusLabel: "retrying (Free usage exceeded, subscribe to Go)",
    });
  });

  it("maps retrying without a reason to plain retrying", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: "retrying",
        cachedActivityStatus: null,
        latestDeliveryStatus: null,
        latestDeliveryError: null,
        nowMs,
      }),
    ).toEqual({ rosterStatus: "attention", rosterStatusLabel: "retrying" });
  });

  it("maps retrying activity to retrying when status cache is empty", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: null,
        cachedActivityStatus: "retrying",
        latestDeliveryStatus: null,
        latestDeliveryError: null,
        nowMs,
      }),
    ).toEqual({ rosterStatus: "attention", rosterStatusLabel: "retrying" });
  });

  it("infers working from a delivered user message when cache is empty", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: null,
        cachedActivityStatus: null,
        latestDeliveryStatus: "sent",
        latestDeliveryError: null,
        latestSayAuthor: "user",
        activityAt: "2026-07-19 00:00:00",
        nowMs,
      }),
    ).toEqual({ rosterStatus: "working", rosterStatusLabel: "WORKING" });
  });

  it("infers working vs idle from recent vs old agent messages when cache is empty", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: null,
        cachedActivityStatus: null,
        latestDeliveryStatus: "sent",
        latestDeliveryError: null,
        latestSayAuthor: "agent",
        activityAt: "2026-07-19 11:58:00",
        nowMs,
      }),
    ).toEqual({ rosterStatus: "working", rosterStatusLabel: "WORKING" });
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: null,
        cachedActivityStatus: null,
        latestDeliveryStatus: "sent",
        latestDeliveryError: null,
        latestSayAuthor: "agent",
        activityAt: "2026-07-19 11:00:00",
        nowMs,
      }),
    ).toEqual({ rosterStatus: "idle", rosterStatusLabel: "IDLE" });
  });

  it("keeps unknown when there is no message author and no cache", () => {
    expect(
      deriveSpaceRosterStatus({
        cachedOpenCodeStatus: null,
        cachedActivityStatus: null,
        latestDeliveryStatus: null,
        latestDeliveryError: null,
        nowMs,
      }),
    ).toEqual({ rosterStatus: "unknown", rosterStatusLabel: "UNKNOWN" });
  });

  it("sorts actionable before working before idle with stable id fallback", () => {
    const sorted = sortSpaceRosterSessions([
      session({ id: "b", rosterStatus: "idle", activityAt: "2026-01-02 00:00:00" }),
      session({ id: "a", rosterStatus: "error", activityAt: "2026-01-01 00:00:00" }),
      session({ id: "c", rosterStatus: "working", activityAt: "2026-01-03 00:00:00" }),
      session({ id: "d", rosterStatus: "working", activityAt: "2026-01-04 00:00:00" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "d", "c", "b"]);
  });

  it("compare is transitive for equal status by activity time", () => {
    const older = session({ id: "older", rosterStatus: "idle", activityAt: "2026-01-01 00:00:00" });
    const newer = session({ id: "newer", rosterStatus: "idle", activityAt: "2026-01-02 00:00:00" });
    expect(compareSpaceRosterSessions(newer, older)).toBeLessThan(0);
  });

  it("treats ui_only and idle system notices as internal", () => {
    expect(isInternalRosterNotice("hello", "ui_only")).toBe(true);
    expect(
      isInternalRosterNotice(
        "<say-to-me-system>ses_eeb39d7c36ddkBg335I61iPEwh is idle now</say-to-me-system>",
        "ui_only",
      ),
    ).toBe(true);
    expect(
      isInternalRosterNotice(
        "<say-to-me-system>ses_eeb39d7c36ddkBg335I61iPEwh is idle now</say-to-me-system>",
        null,
      ),
    ).toBe(true);
    expect(isInternalRosterNotice("ROSTER-LIVE-2026", "sent")).toBe(false);
    expect(isInternalRosterNotice("please check this", null)).toBe(false);
  });

  it("keeps an agent reply when a later idle notice arrives", () => {
    const picked = pickLatestMeaningfulMessageFacts([
      {
        text: "<say-to-me-system>ses_4ebc156019daRRZSPSb2UKOM4j is idle now</say-to-me-system>",
        author: "user",
        createdAt: "2026-07-18 03:00:00",
        deliveryStatus: "ui_only",
        deliveryError: null,
      },
      {
        text: "ROSTER-LIVE-2026",
        author: "agent",
        createdAt: "2026-07-18 02:59:00",
        deliveryStatus: "sent",
        deliveryError: null,
      },
    ]);
    expect(picked).toMatchObject({
      text: "ROSTER-LIVE-2026",
      author: "agent",
      deliveryStatus: "sent",
    });
  });
});
