import { describe, expect, it, beforeEach } from "vite-plus/test";
import {
  EXTRA_MARKDOWN_HTML_MEMO_CAPACITY,
  EXTRA_MARKDOWN_INPUT_CAP_BYTES,
  MARKDOWN_ALLOWED_TAGS,
} from "./markdown-config.ts";
import {
  _extraMarkdownHtmlRenderCountForTests,
  _resetExtraMarkdownHtmlMemoForTests,
  extraMarkdownHtmlField,
  renderExtraMarkdownHtml,
  truncateUtf8Bytes,
} from "./extra-markdown-html.ts";

describe("markdown config snapshot", () => {
  it("freezes allowlists and caps", () => {
    expect([...MARKDOWN_ALLOWED_TAGS]).toContain("table");
    expect(EXTRA_MARKDOWN_INPUT_CAP_BYTES).toBe(64 * 1024);
    expect(EXTRA_MARKDOWN_HTML_MEMO_CAPACITY).toBe(500);
  });
});

describe("renderExtraMarkdownHtml XSS corpus (satteri + sanitize-html)", () => {
  beforeEach(() => {
    _resetExtraMarkdownHtmlMemoForTests();
  });

  it("strips script, handlers, iframes, styles, and bad URIs while hardening anchors", () => {
    const html = renderExtraMarkdownHtml(
      [
        "**ok**",
        "",
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        '<iframe src="https://evil.example"></iframe>',
        "<style>body{display:none}</style>",
        "[docs](https://example.com/path)",
        "[js](javascript:alert(1))",
        "[data](data:text/html,hi)",
        "[protocol-relative](//evil.example/path)",
        "<shell_metadata>User aborted</shell_metadata>",
      ].join("\n\n"),
    );

    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("<iframe");
    expect(html.toLowerCase()).not.toContain("<style");
    expect(html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
    expect(html).not.toMatch(/href\s*=\s*["']?\s*data:/i);
    expect(html).not.toContain('href="//evil.example');
    expect(html).not.toContain("shell_metadata");
    expect(html.toLowerCase()).toContain("user aborted");
    expect(html).toMatch(/href="https:\/\/example\.com\/path"/);
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/rel="noopener noreferrer"/);
    expect(html).toMatch(/<strong>ok<\/strong>/i);
  });

  it("turns single newlines into hard breaks like marked breaks:true", () => {
    const html = renderExtraMarkdownHtml("line 1\nline 2");
    expect(html).toMatch(/line 1<br\s*\/?>\s*\n?line 2/i);
  });

  it("renders gfm tables", () => {
    const html = renderExtraMarkdownHtml("| A | B |\n|---|---|\n| true | false |");
    expect(html).toContain("<table");
    expect(html).toContain("<td");
  });

  it("caps pathological input on UTF-8 byte boundaries and memos identical markdown", () => {
    const emoji = "😀"; // 4 UTF-8 bytes
    const huge = `${emoji.repeat(EXTRA_MARKDOWN_INPUT_CAP_BYTES / 4 + 10)}`;
    expect(Buffer.byteLength(huge, "utf8")).toBeGreaterThan(EXTRA_MARKDOWN_INPUT_CAP_BYTES);
    const capped = renderExtraMarkdownHtml(huge);
    expect(capped.startsWith("<p>")).toBe(true);
    expect(Buffer.byteLength(capped.replace(/^<p>|<\/p>$/g, ""), "utf8")).toBeLessThanOrEqual(
      EXTRA_MARKDOWN_INPUT_CAP_BYTES,
    );
    expect(truncateUtf8Bytes(`${emoji}${emoji}`, 5)).toBe(emoji);

    const md = "| A | B |\n|---|---|\n| true | false |";
    const first = renderExtraMarkdownHtml(md);
    const countAfterFirst = _extraMarkdownHtmlRenderCountForTests();
    const second = renderExtraMarkdownHtml(md);
    expect(second).toBe(first);
    expect(_extraMarkdownHtmlRenderCountForTests()).toBe(countAfterFirst);
  });

  it("omits additive field when markdown absent", () => {
    expect(extraMarkdownHtmlField(null)).toEqual({});
    expect(extraMarkdownHtmlField("")).toEqual({});
    expect(extraMarkdownHtmlField("   ")).toEqual({});
    expect(extraMarkdownHtmlField("hi").extraMarkdownHtml).toContain("hi");
  });
});

describe("deserializeMessage extraMarkdownHtml wiring", () => {
  it("adds extraMarkdownHtml through deserializeMessage (shared list + SSE mapper)", async () => {
    const { createTestSession } = await import("../api.harness.ts");
    const { insertMessageRow, listMessages } = await import("../messages.ts");
    const sessionId = "ses_mdhtml02wire01deserialize01ok";
    await createTestSession(sessionId);
    insertMessageRow({
      sessionId,
      text: "spoken line",
      extraMarkdown: "**bold** and [link](https://example.com)",
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    const [message] = listMessages(sessionId);
    expect(message?.extraMarkdown).toContain("**bold**");
    expect(typeof message?.extraMarkdownHtml).toBe("string");
    expect(message?.extraMarkdownHtml).toMatch(/<strong>bold<\/strong>/i);
    expect(message?.extraMarkdownHtml).toMatch(/href="https:\/\/example\.com"/);
    expect(message?.extraMarkdownHtml).toMatch(/rel="noopener noreferrer"/);
    expect(message?.extraMarkdownHtml?.toLowerCase()).not.toContain("<script");
  }, 15_000);
});
