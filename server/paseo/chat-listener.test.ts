import { describe, expect, it } from "vite-plus/test";
import {
  filterInboundPaseoChatMessages,
  parsePaseoChatMessages,
  selectPaseoChatHydrationRows,
} from "./chat-listener.ts";

describe("Paseo chat listener message boundary", () => {
  it("parses messages including STM-originated rows", () => {
    const rows = parsePaseoChatMessages(
      JSON.stringify([
        {
          id: "human",
          body: "hello",
          author: "manual",
          authorName: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        { id: "stm", body: "echo", author: "say-to-me", createdAt: "2026-01-01T00:01:00Z" },
      ]),
    );
    expect(rows.map((row) => row.id)).toEqual(["human", "stm"]);
  });

  it("filters STM-originated messages without filtering human manual messages", () => {
    const rows = filterInboundPaseoChatMessages(
      parsePaseoChatMessages(
        JSON.stringify([
          {
            id: "human",
            body: "hello",
            author: "manual",
            authorName: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
          { id: "stm", body: "echo", author: "say-to-me", createdAt: "2026-01-01T00:01:00Z" },
        ]),
      ),
    );
    expect(rows.map((row) => row.id)).toEqual(["human"]);
  });

  it("reports the invalid field when the Paseo payload shape changes", () => {
    expect(() =>
      parsePaseoChatMessages(JSON.stringify([{ id: "broken", body: "hello", authorName: 42 }])),
    ).toThrow(/authorName/);
  });

  it("selects only the newest configured hydration window", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1),
      body: String(index + 1),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    const selected = selectPaseoChatHydrationRows(rows, 50);
    expect(selected).toHaveLength(50);
    expect(selected[0]?.id).toBe("51");
    expect(selected.at(-1)?.id).toBe("100");
  });
});
