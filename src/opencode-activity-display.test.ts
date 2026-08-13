import { describe, expect, it } from "vite-plus/test";
import {
  buildOpenCodeActivityCards,
  openCodeStatusAlertMessage,
  openCodeStatusRawMessage,
} from "./opencode-activity-display.ts";
import type { OpenCodeActivity } from "./types.ts";

describe("openCodeStatusAlertMessage", () => {
  it("returns the retry message from statusRaw", () => {
    const activity: OpenCodeActivity = {
      status: "retrying",
      statusRaw: { type: "retry", attempt: 6, message: "The usage limit has been reached" },
      latestOutputSnippet: "The usage limit has been reached",
      recentItems: [{ kind: "message", snippet: "older assistant output" }],
    };
    expect(openCodeStatusAlertMessage(activity)).toBe("The usage limit has been reached");
  });

  it("returns null for busy sessions", () => {
    expect(openCodeStatusAlertMessage({ status: "busy" })).toBeNull();
  });
});

describe("buildOpenCodeActivityCards", () => {
  it("prepends a status alert ahead of recent output", () => {
    const activity: OpenCodeActivity = {
      status: "retrying",
      statusRaw: { type: "retry", message: "The usage limit has been reached" },
      recentItems: [{ kind: "message", snippet: "I'll send the pricing comparison" }],
    };
    const cards = buildOpenCodeActivityCards({
      activity,
      recentItems: activity.recentItems ?? [],
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]?.snippet).toBe("The usage limit has been reached");
    expect(cards[1]?.snippet).toBe("I'll send the pricing comparison");
  });
});

describe("openCodeStatusRawMessage", () => {
  it("ignores non-object status payloads", () => {
    expect(openCodeStatusRawMessage(null)).toBeNull();
    expect(openCodeStatusRawMessage("retrying")).toBeNull();
  });
});
