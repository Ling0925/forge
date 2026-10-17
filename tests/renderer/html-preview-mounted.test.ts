import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { HTML_PREVIEW_CSP } from "../../src/shared/html-preview";

// The preview needs a real same-origin document URL: srcdoc/blob:/data: frames
// are refused by the workbench CSP. This test therefore serves both the page
// and the preview document, then asserts what the frame can and cannot do.
it("renders a sandboxed preview document without parent or network access", async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import {CodeBlock} from './src/renderer/components/primitives/CodeBlock';
        import {DiffViewer} from './src/renderer/components/primitives/DiffViewer';
        import {createDiffPatch} from './src/shared/diff';
        const root = createRoot(document.getElementById('root'));
        window.renderPreview = () => flushSync(() => root.render(
          React.createElement(React.Fragment, null,
            React.createElement(CodeBlock, {code: '<h1 id=inline>inline preview</h1><script>document.title="ran-inline"<\\/script>', language: 'html', previewHtml: true}),
            React.createElement(DiffViewer, {change: {path: 'page.html', kind: 'modified', patch: createDiffPatch('a', 'b')}, isSuggested: false}),
          )
        ));
      `,
      resolveDir: resolve("."),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty" },
  });
  const script = bundle.outputFiles[0]?.text ?? "";
  const documents = new Map<string, string>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/preview/document") {
      const html = documents.get(url.searchParams.get("id") ?? "");
      if (html === undefined) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": HTML_PREVIEW_CSP,
        "X-Frame-Options": "SAMEORIGIN",
      });
      response.end(html);
      return;
    }
    if (url.pathname === "/preview/file") {
      // Mirrors the host: an HTML file is read and parked behind a URL.
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ url: `/preview/document?id=${"f".repeat(48)}` }),
      );
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self';",
    });
    response.end(
      `<!doctype html><html><body><div id="root"></div><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  let fetches = 0;
  server.on("request", (request) => {
    if (request.url?.startsWith("/network-probe")) fetches += 1;
  });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(`
      window.previewCalls = [];
      window.forge = {
        previewHtml: async (html) => {
          window.previewCalls.push(['inline', html.length]);
          return {url: '/preview/document?id=${"a".repeat(48)}'};
        },
        previewFile: async (path) => {
          window.previewCalls.push(['file', path]);
          return {url: '/preview/document?id=${"f".repeat(48)}'};
        },
      };
    `);
    await page.goto(origin);
    // The host parks documents by id; seed both after the page is live.
    documents.set(
      "a".repeat(48),
      `<h1 id=inline>inline preview</h1><script>
        document.title = 'ran-inline';
        try { parent.document.body.dataset.pwned = 'yes'; } catch (error) { window.parentBlocked = error.name; }
        fetch('/network-probe').catch(() => {});
      </script>`,
    );
    documents.set("f".repeat(48), "<p id=file>file preview</p>");
    await page.evaluate("window.renderPreview()");
    expect(await page.evaluate("window.previewCalls")).toEqual([]);

    await page.getByRole("button", { name: "预览", exact: true }).click();
    const frame = page.frameLocator(".html-preview-frame");
    await expect.poll(() => frame.locator("#inline").count()).toBe(1);
    expect(await page.evaluate("window.previewCalls")).toEqual([
      ["inline", expect.any(Number)],
    ]);
    // Scripts run inside the preview, but only inside its opaque origin.
    const framePage = page.frames()[1];
    expect(await framePage?.title()).toBe("ran-inline");
    expect(await framePage?.evaluate("window.parentBlocked ?? ''")).not.toBe(
      "",
    );
    expect(await page.evaluate("document.body.dataset.pwned ?? ''")).toBe("");
    expect(await page.locator("h1#inline").count()).toBe(0);
    // The document CSP blocks network access from inside the frame.
    await page.waitForTimeout(400);
    expect(fetches).toBe(0);
    // Closing restores the reading view; the frame is unmounted.
    await page.getByRole("button", { name: "关闭 HTML 预览" }).click();
    await expect
      .poll(() => page.locator(".html-preview-frame").count())
      .toBe(0);
    expect(errors).toEqual([]);

    // A changed HTML file offers the file-scoped preview instead.
    await page.evaluate("window.renderPreview()");
    await page.getByRole("button", { name: "预览 HTML" }).click();
    const fileFrame = page.frameLocator(".html-preview-frame");
    await expect.poll(() => fileFrame.locator("#file").count()).toBe(1);
    expect(await page.evaluate("window.previewCalls")).toContainEqual([
      "file",
      "page.html",
    ]);
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
