/** @vitest-environment jsdom */
import { createRoot } from "solid-js";
import { describe, expect, it } from "vite-plus/test";
import { renderExtraMarkdownHtml } from "../../../markdown/extra-markdown-html.ts";
import { VoiceNoteMarkdown } from "./VoiceNoteMarkdown.tsx";

function semanticHtml(root: ParentNode): string {
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return `#${node.nodeValue ?? ""}`;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    // SAFETY: the DOM Node interface guarantees nodeType === ELEMENT_NODE only for Element
    // instances, and the guard above already ruled out every other nodeType.
    const element = node as Element;
    const attributes = [...element.attributes]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, value }) => `${name}=${value}`)
      .join(";");
    return `<${element.tagName.toLowerCase()} ${attributes}>${[...element.childNodes].map(visit).join("")}</${element.tagName.toLowerCase()}>`;
  };
  return [...root.childNodes].map(visit).join("");
}

const fixtures = [
  "paragraph with *emphasis* and **strong** and `inline code`",
  "# Heading\n\n- one\n- two\n\n> quote",
  "~~~ts\nconst value = 1;\n~~~",
  "| A | B |\n| --- | ---: |\n| 1 | 2 |",
  "line one\nline two",
  "[safe](https://example.com)",
];

describe("VoiceNoteMarkdown", () => {
  it("renders supported GFM semantics and preserves code wrapping hooks", () => {
    const markdown = fixtures.join("\n\n");
    const root = VoiceNoteMarkdown({ html: renderExtraMarkdownHtml(markdown) });
    expect(root.querySelector("h1")?.textContent).toBe("Heading");
    expect(root.querySelector("em")?.textContent).toBe("emphasis");
    expect(root.querySelector("strong")?.textContent).toBe("strong");
    expect(root.querySelector("code")?.textContent).toBe("inline code");
    expect(root.querySelector("pre code")?.textContent).toContain("const value = 1;");
    expect(root.querySelector("table")).not.toBeNull();
    expect(root.querySelector("blockquote")?.textContent?.trim()).toBe("quote");
    expect(root.querySelector("a")?.target).toBe("_blank");
    expect(root.querySelector("a")?.rel).toBe("noopener noreferrer");
  });

  it("removes scripts, event handlers, and unsafe URLs while retaining safe raw markup", () => {
    const root = VoiceNoteMarkdown({
      html: '<div onclick="alert(1)"><span>safe</span><script>alert(1)</script></div><a href="javascript:alert(1)">bad</a><a href="mailto:test@example.com">good</a>',
    });
    expect(root.textContent).toContain("safe");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("[onclick]")).toBeNull();
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(root.querySelector<HTMLAnchorElement>('a[href="mailto:test@example.com"]')?.target).toBe(
      "_blank",
    );
  });

  it("omits blank and null content and returns a Solid-compatible element", () => {
    expect(VoiceNoteMarkdown({ html: null }).childNodes).toHaveLength(0);
    expect(VoiceNoteMarkdown({ html: "   " }).childNodes).toHaveLength(0);
    const root = createRoot(() => VoiceNoteMarkdown({ html: null }));
    expect(root.textContent).toBe("");
    expect(root).toBeInstanceOf(HTMLElement);
  });

  it("preserves titled links from the server HTML projection", () => {
    const serverHtml = renderExtraMarkdownHtml('[docs](https://example.com "Documentation")');
    const link = VoiceNoteMarkdown({ html: serverHtml }).querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("title")).toBe("Documentation");
  });

  it("is idempotent over representative server HTML and hostile Markdown fixtures", () => {
    const markdownFixtures = [
      '[docs](https://example.com "Documentation")',
      "| A | B |\n|---|---|\n| true | false |\n\n```ts\nconst value = 1;\n```",
      "line one\nline two",
      "<script>alert(1)</script><img src=x onerror=alert(1)> [bad](javascript:alert(1)) [proto](//evil.example)",
    ];
    for (const markdown of markdownFixtures) {
      const serverHtml = renderExtraMarkdownHtml(markdown);
      const serverRoot = new DOMParser().parseFromString(
        `<body>${serverHtml}</body>`,
        "text/html",
      ).body;
      const clientRoot = VoiceNoteMarkdown({ html: serverHtml });
      expect(semanticHtml(clientRoot)).toBe(semanticHtml(serverRoot));
      expect(clientRoot.querySelector("script")).toBeNull();
      expect(clientRoot.querySelector("[onerror]")).toBeNull();
      expect(clientRoot.querySelector('a[href^="javascript:"]')).toBeNull();
    }
  });

  it("renders the server HTML projection without parsing raw Markdown", () => {
    const serverHtml = renderExtraMarkdownHtml("**bold** and [safe](https://example.com)");
    const rendered = VoiceNoteMarkdown({ html: serverHtml });
    expect(rendered.querySelector("strong")?.textContent).toBe("bold");
    expect(rendered.querySelector<HTMLAnchorElement>("a")?.target).toBe("_blank");
    expect(rendered.querySelector<HTMLAnchorElement>("a")?.rel).toBe("noopener noreferrer");
    expect(VoiceNoteMarkdown({ html: "**raw markdown is not parsed**" }).textContent).toBe(
      "**raw markdown is not parsed**",
    );
  });
});
