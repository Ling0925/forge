import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../src/renderer/components/workbench/Markdown";
describe("safe rich Markdown", () => {
  it("renders headings, lists, tables, inline and fenced code", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        source:
          "# Heading\n\n- one\n- two\n\n| Name | Value |\n| --- | --- |\n| a | b |\n\n`inline`\n\n```ts\nconst x = 1;\n```",
      }),
    );
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain("const x = 1;");
  });
  it("does not interpret HTML or javascript URLs", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        source:
          "<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n[safe](https://example.com)",
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
  });
});
