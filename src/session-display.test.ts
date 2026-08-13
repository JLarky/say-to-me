import { describe, expect, it } from "vite-plus/test";

import {
  resolveListDisplayName,
  resolveProviderTitleLabel,
  resolveSessionPageIdentityLabel,
  workspaceBasename,
} from "./session-display.ts";
import { sessionMentionToken } from "./session-mentions.ts";

describe("session-display", () => {
  it("resolves workspace basename from cwd", () => {
    expect(workspaceBasename("/Users/me/projects/say-to-me")).toBe("say-to-me");
    expect(workspaceBasename("  ")).toBe(null);
  });

  it("uses alias first for list and identity labels", () => {
    const input = {
      id: "cc_f35534e6-426c-454f-b2ac-55c560f8f2d0",
      alias: "claude review bot fable",
      opencodeTitle: "Review checkout flow",
      cwd: "/tmp/say-to-me",
    };
    expect(resolveListDisplayName(input)).toBe("claude review bot fable");
    expect(resolveSessionPageIdentityLabel(input)).toBe("claude review bot fable");
  });

  it("falls back through provider title, cwd, and id", () => {
    expect(
      resolveListDisplayName({
        id: "cur_abc",
        opencodeTitle: "Fix organize page",
        cwd: "/tmp/say-to-me",
      }),
    ).toBe("Fix organize page");
    expect(
      resolveListDisplayName({
        id: "cur_abc",
        cwd: "/tmp/say-to-me",
      }),
    ).toBe("say-to-me");
    expect(resolveListDisplayName({ id: "cur_abc" })).toBe("cur_abc");
  });

  it("resolves provider title line with cwd fallback", () => {
    expect(
      resolveProviderTitleLabel({
        id: "cur_abc",
        alias: "my alias",
        cwd: "/tmp/say-to-me",
      }),
    ).toBe("say-to-me");
    expect(
      resolveProviderTitleLabel({
        id: "cur_abc",
        opencodeTitle: "Provider name",
        cwd: "/tmp/say-to-me",
      }),
    ).toBe("Provider name");
  });
});

describe("sessionMentionToken", () => {
  it("formats mention tokens with and without alias", () => {
    expect(sessionMentionToken("cc_f35534e6-426c-454f-b2ac-55c560f8f2d0")).toBe(
      "say-to-me(cc_f35534e6-426c-454f-b2ac-55c560f8f2d0)",
    );
    expect(
      sessionMentionToken("cc_f35534e6-426c-454f-b2ac-55c560f8f2d0", "claude review bot fable"),
    ).toBe("say-to-me(cc_f35534e6-426c-454f-b2ac-55c560f8f2d0, claude review bot fable)");
  });
});
