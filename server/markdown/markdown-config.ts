/** Shared allowlists for server-rendered `extraMarkdownHtml`. */

export const MARKDOWN_ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

export const MARKDOWN_ALLOWED_ATTR = {
  a: ["href", "name", "target", "rel", "title"],
} as const;

export const MARKDOWN_ALLOWED_SCHEMES = ["http", "https", "mailto"] as const;

/** Over-size markdown is never fed to the parser on the SSE/read path. */
export const EXTRA_MARKDOWN_INPUT_CAP_BYTES = 64 * 1024;

export const EXTRA_MARKDOWN_HTML_MEMO_CAPACITY = 500;

/** Turn shell_metadata XML wrappers into fenced text (UI parity). */
export function normalizeShellMetadata(markdown: string): string {
  return markdown.replace(
    /<shell_metadata>([\s\S]*?)<\/shell_metadata>/g,
    (_match, metadata: string) => `\n\n\`\`\`text\n${metadata.trim()}\n\`\`\`\n\n`,
  );
}

/**
 * Match marked `{ breaks: true }`: single newlines become GFM hard breaks
 * outside fenced code blocks (satteri has no breaks toggle).
 */
export function enableSoftLineBreaks(markdown: string): string {
  const chunks = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  return chunks
    .map((chunk, index) => {
      if (index % 2 === 1) return chunk;
      return chunk.replace(/([^\n])\n(?!\n)/g, "$1  \n");
    })
    .join("");
}
