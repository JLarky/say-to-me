import { describe, expect, it } from "vite-plus/test";
import { prefixedUuidSessionId, stripPrefixedUuid } from "./prefixed-session.ts";
import { CLAUDE_SESSION, CURSOR_SESSION } from "../session-id.ts";

describe("prefixed uuid session helpers", () => {
  const uuid = "5c708e22-807e-4579-807a-b56d8e4341e1";

  it("builds and recognizes prefixed ids", () => {
    expect(prefixedUuidSessionId(CLAUDE_SESSION, uuid)).toBe(`cc_${uuid}`);
    expect(prefixedUuidSessionId(CURSOR_SESSION, uuid)).toBe(`cur_${uuid}`);
    expect(prefixedUuidSessionId(CURSOR_SESSION, `cur_${uuid}`)).toBe(`cur_${uuid}`);
    expect(prefixedUuidSessionId(CLAUDE_SESSION, "not-a-uuid")).toBe(null);
  });

  it("strips prefixes for on-disk lookups", () => {
    expect(stripPrefixedUuid("cc_", `cc_${uuid}`)).toBe(uuid);
    expect(stripPrefixedUuid("cur_", `cur_${uuid}`)).toBe(uuid);
  });
});
