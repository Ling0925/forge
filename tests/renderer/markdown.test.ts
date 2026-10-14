import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Markdown,
  MARKDOWN_PARSE_LIMIT,
} from "../../src/renderer/components/workbench/Markdown";
const render = (source: string, highlight = false) =>
  renderToStaticMarkup(createElement(Markdown, { source, highlight }));
describe("safe rich Markdown", () => {
  it("renders GFM headings, nested/task lists, quotes, rules, emphasis and tables", () => {
    const html = render(
      "# Heading\n\n- one\n  - nested\n- [x] done\n\n1. ordered\n\n> quote\n\n---\n\n**bold** *italic* ~~gone~~\n\n| Name | Value |\n| --- | --- |\n| a | b |\n\n`inline`\n\n```ts\nconst x = 1;\n```",
    );
    for (const fragment of [
      "<h1>Heading</h1>",
      "<ul>",
      "<ol>",
      "<table>",
      "<blockquote>",
      "<hr/>",
      "<strong>bold</strong>",
      "<em>italic</em>",
      "<del>gone</del>",
      'type="checkbox"',
      'checked=""',
      "nested",
      "<code>inline</code>",
      "const x = 1;",
    ])
      expect(html).toContain(fragment);
  });
  it.each([
    "```\none\n```",
    "```\n```",
    "```mystery\none\n```",
    "```ts\nconst x = 1;",
    "    indented",
  ])("uses CodeBlock for block code: %s", (source) => {
    const html = render(source);
    expect(html).toContain('class="code-block"');
    expect(html).toContain('aria-label="复制全文"');
    expect(html).toContain('class="code-line-number"');
  });
  it("does not mistake multiline inline code for a block", () => {
    const html = render("a `one\ntwo` b");
    expect(html).toContain("<code>one two</code>");
    expect(html).not.toContain('class="code-block"');
  });
  it("skips HTML, unsafe/relative URLs and image fetching while retaining descriptions", () => {
    const html = render(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[unsafe](javascript:alert%281%29) [data](data:text/html,test) [mail](mailto:a@b.com) [relative](/local) [auth](https://user:pass@example.com)\n\n[safe](https://example.com) https://example.org\n\n![image description](https://example.com/track.png)',
    );
    for (const unsafe of [
      "<script",
      "<img",
      "javascript:",
      "data:",
      "mailto:",
      'href="/local"',
      "user:pass",
      'src="',
    ])
      expect(html).not.toContain(unsafe);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain("image description");
    expect(html).toContain("unsafe");
  });
  it("falls back to complete escaped plain text above the parsing ceiling", () => {
    const source = `<script>not executable</script>\n${"x".repeat(MARKDOWN_PARSE_LIMIT)}END`;
    const html = render(source);
    expect(html).toContain("长消息以纯文本显示");
    expect(html).toContain("&lt;script&gt;not executable&lt;/script&gt;");
    expect(html).toContain(`${"x".repeat(MARKDOWN_PARSE_LIMIT)}END`);
    expect(html).not.toContain("<script>");
  });
});
