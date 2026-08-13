/**
 * Server-side markdown → sanitized HTML (satteri + sanitize-html). No jsdom.
 * Used for message `extraMarkdownHtml` and activity snippet HTML.
 */
import { createHash } from "node:crypto";
import { markdownToHtml } from "satteri";
import sanitizeHtml from "sanitize-html";
import {
  EXTRA_MARKDOWN_HTML_MEMO_CAPACITY,
  EXTRA_MARKDOWN_INPUT_CAP_BYTES,
  MARKDOWN_ALLOWED_ATTR,
  MARKDOWN_ALLOWED_SCHEMES,
  MARKDOWN_ALLOWED_TAGS,
  enableSoftLineBreaks,
  normalizeShellMetadata,
} from "./markdown-config.ts";

let renderCount = 0;
const memo = new Map<string, string>();

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Truncate to max UTF-8 bytes without splitting a multibyte code unit. */
export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, "utf8");
  if (buf.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString("utf8");
}

function escapeAsPlainParagraph(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<p>${escaped}</p>`;
}

function memoGet(key: string): string | undefined {
  const hit = memo.get(key);
  if (hit === undefined) return undefined;
  memo.delete(key);
  memo.set(key, hit);
  return hit;
}

function memoSet(key: string, value: string): void {
  if (memo.has(key)) memo.delete(key);
  memo.set(key, value);
  while (memo.size > EXTRA_MARKDOWN_HTML_MEMO_CAPACITY) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
}

function renderUncached(markdown: string): string {
  renderCount += 1;
  if (utf8ByteLength(markdown) > EXTRA_MARKDOWN_INPUT_CAP_BYTES) {
    return escapeAsPlainParagraph(truncateUtf8Bytes(markdown, EXTRA_MARKDOWN_INPUT_CAP_BYTES));
  }
  const normalized = enableSoftLineBreaks(normalizeShellMetadata(markdown));
  const { html } = markdownToHtml(normalized, {
    features: { gfm: true, frontmatter: false },
  });
  return sanitizeHtml(html, {
    allowedTags: [...MARKDOWN_ALLOWED_TAGS],
    allowedAttributes: {
      a: [...MARKDOWN_ALLOWED_ATTR.a],
    },
    allowedSchemes: [...MARKDOWN_ALLOWED_SCHEMES],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer",
      }),
    },
  });
}

/**
 * Convert markdown to sanitized HTML. Caps pathological input; memos by content.
 * Empty / whitespace-only input yields empty string (caller should omit the field).
 */
export function renderExtraMarkdownHtml(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";
  const key =
    trimmed.length < 256
      ? `raw:${trimmed}`
      : `sha:${createHash("sha256").update(trimmed, "utf8").digest("hex")}`;
  const cached = memoGet(key);
  if (cached !== undefined) return cached;
  const html = renderUncached(trimmed);
  memoSet(key, html);
  return html;
}

/** Additive helper for message serializers. */
export function extraMarkdownHtmlField(
  extraMarkdown: string | null | undefined,
): { extraMarkdownHtml: string } | Record<string, never> {
  if (typeof extraMarkdown !== "string" || !extraMarkdown.trim()) return {};
  return { extraMarkdownHtml: renderExtraMarkdownHtml(extraMarkdown) };
}

/** Attach `snippetHtml` for OpenCode activity cards. */
export function withActivitySnippetHtml<T extends { snippet: string }>(
  items: T[],
): Array<T & { snippetHtml: string }> {
  return items.map((item) => ({
    ...item,
    snippetHtml: renderExtraMarkdownHtml(item.snippet),
  }));
}

/** External CLI activity: tool lines render as inline code (UI parity with former client). */
export function externalCliItemMarkdown(item: { kind?: unknown; text?: unknown }): string {
  const text = typeof item.text === "string" ? item.text : "";
  if (item.kind !== "tool") return text;
  // Multi-line tool payloads (CreatePlan, AskQuestion) are already markdown.
  if (text.includes("\n")) return text;
  return `\`${text}\``;
}

export function withExternalCliItemHtml<T extends { kind?: unknown; text?: unknown }>(
  items: readonly T[],
): Array<T & { html: string }> {
  return items.map((item) => ({
    ...item,
    html: renderExtraMarkdownHtml(externalCliItemMarkdown(item)),
  }));
}

export function _extraMarkdownHtmlRenderCountForTests(): number {
  return renderCount;
}

export function _resetExtraMarkdownHtmlMemoForTests(): void {
  memo.clear();
  renderCount = 0;
}
