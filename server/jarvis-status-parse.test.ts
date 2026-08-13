import { describe, expect, it } from "vite-plus/test";
import { parseExtended, parseLimit, parseSince, parseStatusWait } from "./jarvis-status.ts";

describe("jarvis status query parsers", () => {
  it("rejects wait requests over five minutes", () => {
    expect(parseStatusWait("5min")).toEqual({ ok: true, waitMs: 300_000 });
    expect(parseStatusWait("10min")).toEqual({ ok: false });
    expect(parseStatusWait("999sec")).toEqual({ ok: false });
    expect(parseStatusWait("300sec")).toEqual({ ok: true, waitMs: 300_000 });
  });

  it("rejects invalid limits", () => {
    expect(parseLimit(null)).toEqual({ ok: true, limit: 3 });
    expect(parseLimit("50")).toEqual({ ok: true, limit: 50 });
    expect(parseLimit("0")).toEqual({ ok: false });
    expect(parseLimit("51")).toEqual({ ok: false });
    expect(parseLimit("1.5")).toEqual({ ok: false });
  });

  it("parses extended cursor values", () => {
    expect(parseExtended(null)).toEqual({ ok: true, extended: false });
    expect(parseExtended("")).toEqual({ ok: true, extended: true });
    expect(parseExtended("true")).toEqual({ ok: true, extended: true });
    expect(parseExtended("false")).toEqual({ ok: true, extended: false });
    expect(parseExtended("maybe")).toEqual({ ok: false });
  });

  it("parses since cursors", () => {
    expect(parseSince(null)).toEqual({ ok: true, since: null });
    expect(parseSince("12")).toEqual({ ok: true, since: 12 });
    expect(parseSince("-1")).toEqual({ ok: false });
    expect(parseSince("1.5")).toEqual({ ok: false });
  });
});
