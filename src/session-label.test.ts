import { describe, expect, it } from "vite-plus/test";

import { sessionListLabel, sessionProviderLabel, showSessionIdSubline } from "./session-label.ts";

describe("session-label", () => {
  it("delegates list and provider labels to session-display", () => {
    const input = {
      id: "cur_abc",
      alias: "My alias",
      opencodeTitle: "Provider title",
      cwd: "/tmp/say-to-me",
    };
    expect(sessionListLabel(input)).toBe("My alias");
    expect(sessionProviderLabel(input)).toBe("Provider title");
    expect(showSessionIdSubline(input)).toBe(true);
  });

  it("hides id subline when list label is the raw id", () => {
    expect(showSessionIdSubline({ id: "cur_abc" })).toBe(false);
  });
});
