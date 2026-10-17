import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeBlock } from "../../src/renderer/components/primitives/CodeBlock";
import { DiffViewer } from "../../src/renderer/components/primitives/DiffViewer";
import { Markdown } from "../../src/renderer/components/workbench/Markdown";
import { createDiffPatch } from "../../src/shared/diff";
import {
  HTML_PREVIEW_CSP,
  isHtmlLanguage,
  isHtmlPath,
} from "../../src/shared/html-preview";

// Server rendering has no window.forge: the preview action must disappear
// rather than emit a dead control, which is also the desktop-host behaviour.
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);

describe("HTML preview detection", () => {
  it("recognises HTML file paths and fenced languages", () => {
    for (const path of [
      "a.html",
      "dir/page.HTM",
      "src/x/y.Html?x=1",
      "a.html#top",
    ])
      expect(isHtmlPath(path)).toBe(true);
    for (const path of [
      "a.htmlx",
      "a.ts",
      "dir.html/a.ts",
      "a.xhtml",
      "a.htm.txt",
      "noextension",
    ])
      expect(isHtmlPath(path)).toBe(false);
    for (const language of ["html", "HTML", " htm ", "xhtml"])
      expect(isHtmlLanguage(language)).toBe(true);
    for (const language of ["text", "xml", "htmlx", ""])
      expect(isHtmlLanguage(language)).toBe(false);
  });

  it("keeps the preview document unable to run top-level or reach the network", () => {
    expect(HTML_PREVIEW_CSP).toContain("default-src 'none'");
    expect(HTML_PREVIEW_CSP).toContain("script-src 'unsafe-inline'");
    expect(HTML_PREVIEW_CSP).toContain("style-src 'unsafe-inline'");
    expect(HTML_PREVIEW_CSP).toContain("connect-src 'none'");
    expect(HTML_PREVIEW_CSP).toContain("form-action 'none'");
    expect(HTML_PREVIEW_CSP).toContain("sandbox allow-scripts");
    expect(HTML_PREVIEW_CSP).not.toContain("allow-same-origin");
    expect(HTML_PREVIEW_CSP).not.toContain("allow-top-navigation");
  });
});

describe("HTML preview actions", () => {
  it("offers no dead control when the host has no preview endpoint", () => {
    const code = render(
      createElement(CodeBlock, {
        code: "<h1>hi</h1>",
        language: "html",
        previewHtml: true,
      }),
    );
    expect(code).toContain("hi");
    expect(code).not.toContain("预览");
    const diff = render(
      createElement(DiffViewer, {
        change: {
          path: "page.html",
          kind: "modified",
          patch: createDiffPatch("a", "b"),
        },
        isSuggested: false,
      }),
    );
    expect(diff).not.toContain("预览 HTML");
  });

  it("renders an html fenced block as a normal code block", () => {
    const html = render(
      createElement(Markdown, { source: "```html\n<h1>title</h1>\n```" }),
    );
    expect(html).toContain('class="code-block"');
    expect(html).toContain("title");
    // The markup is still shown as inert text, never injected as elements.
    expect(html).not.toContain("<h1>");
  });
});
