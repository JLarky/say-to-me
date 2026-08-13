import { type as arktype } from "arktype";
import { describe, expect, it } from "vite-plus/test";
import {
  hasFullGitSha,
  hasInlineHttpsLink,
  hasRawSessionId,
  hasTooManySpelledNumberWords,
  sayBodyKeys,
  sessionMessageBodyKeys,
} from "./validation.ts";

describe("message text safety validators", () => {
  it("detects inline https links", () => {
    expect(hasInlineHttpsLink("Read https://example.com instead")).toBe(true);
    expect(hasInlineHttpsLink("Read the attached link instead")).toBe(false);
  });

  it("detects raw session ids, including punctuation-delimited ids", () => {
    expect(hasRawSessionId("test do not reply ses_13740f21effeoQ4dMsB1PYxzOP test")).toBe(true);
    expect(hasRawSessionId("Main session is ses_12f94ae96ffepCN7Wdi3ZUA7zl.")).toBe(true);
    expect(hasRawSessionId("Use say-to-me(ses_13740f21effeoQ4dMsB1PYxzOP) instead")).toBe(false);
    expect(hasRawSessionId("short ses_notreal is not a real session id")).toBe(false);
  });

  it("detects full Git SHAs", () => {
    expect(hasFullGitSha("See commit d3152bae093ae41291ee91e80b1357b4849c75d3.")).toBe(true);
    expect(hasFullGitSha("Short commit d3152bae is okay here.")).toBe(false);
  });
});

describe("hasTooManySpelledNumberWords", () => {
  it("catches the shortened spoken number wording from message 16359", () => {
    expect(
      hasTooManySpelledNumberWords(
        "Issue three oh two references pull request two ninety nine as prior art.",
      ),
    ).toBe(true);
  });

  it("catches other common spoken number words", () => {
    expect(hasTooManySpelledNumberWords("Try steps zero, one, four, five, and ten next.")).toBe(
      true,
    );
  });

  it("allows up to two spelled-out number words", () => {
    expect(hasTooManySpelledNumberWords("Items six and seven need follow-up.")).toBe(false);
  });

  it("ignores digit-form numbers", () => {
    expect(hasTooManySpelledNumberWords("Items 6, 7, and 8 need follow-up.")).toBe(false);
  });

  it("allows idiomatic one or the other phrasing", () => {
    expect(hasTooManySpelledNumberWords("do we want to do one or the other")).toBe(false);
  });
});

describe("request body key schemas", () => {
  it("rejects unknown /say fields", () => {
    const result = sayBodyKeys({ text: "hi", txet: "typo" });

    expect(result).toBeInstanceOf(arktype.errors);
    if (!(result instanceof arktype.errors)) throw new Error("expected ArkType errors");
    expect(result.summary).toContain("txet");
  });

  it("rejects unknown session message fields", () => {
    const result = sessionMessageBodyKeys({ author: "agent", priority: "high", text: "hi" });

    expect(result).toBeInstanceOf(arktype.errors);
    if (!(result instanceof arktype.errors)) throw new Error("expected ArkType errors");
    expect(result.summary).toContain("priority");
  });

  it("allows supported session message fields", () => {
    expect(
      sessionMessageBodyKeys({
        author: "agent",
        extraMarkdown: "details",
        images: ["/tmp/shot.png"],
        links: ["https://example.com"],
        overflow: "force",
        sessions: [{ id: "ses_e4cc740e60b6gP57P5Rd9AJalb" }],
        text: "hi",
      }),
    ).toEqual({
      author: "agent",
      extraMarkdown: "details",
      images: ["/tmp/shot.png"],
      links: ["https://example.com"],
      overflow: "force",
      sessions: [{ id: "ses_e4cc740e60b6gP57P5Rd9AJalb" }],
      text: "hi",
    });
  });
});
