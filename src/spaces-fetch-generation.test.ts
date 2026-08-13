import { describe, expect, it } from "vite-plus/test";

import { createSpacesFetchGate } from "./spaces-fetch-generation.ts";
import { archivePrototypeSession, type PrototypeSpacesState } from "./new-space-prototype.ts";

describe("createSpacesFetchGate", () => {
  it("invalidates earlier tokens when a newer fetch begins", () => {
    const gate = createSpacesFetchGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("keeps the latest token current until the next begin", () => {
    const gate = createSpacesFetchGate();
    const token = gate.begin();
    expect(gate.isCurrent(token)).toBe(true);
    expect(gate.current).toBe(token);
  });

  it("models the archive race: stale apply is skipped after begin", () => {
    const gate = createSpacesFetchGate();
    const staleToken = gate.begin();
    // Optimistic archive + invalidate in-flight GETs
    gate.begin();
    let state: PrototypeSpacesState = {
      selectedSpaceId: "space-a",
      spaces: [
        {
          id: "space-a",
          name: "A",
          parentId: null,
          archived: false,
          context: "",
          repos: [],
          sessions: [
            {
              id: "ses_82c41693cb14xpTRmGfTDe4Qs6",
              title: "One",
              agent: "OpenCode",
              provider: "opencode",
              model: "x",
              status: "Attached",
              tone: "blue",
              archived: false,
            },
          ],
        },
      ],
    };
    state = archivePrototypeSession(state, "ses_82c41693cb14xpTRmGfTDe4Qs6");
    expect(state.spaces[0]?.sessions[0]?.archived).toBe(true);
    // Stale fetch must not apply
    expect(gate.isCurrent(staleToken)).toBe(false);
  });
});
