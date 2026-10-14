import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("routes links through the host, preserves copy text, throttles streams and measures a long reply", async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import {Markdown} from './src/renderer/components/workbench/Markdown';
        import {StreamingMarkdown} from './src/renderer/components/workbench/StreamingMarkdown';
        window.opened = [];
        window.copied = [];
        window.forge = {openExternal: async url => {window.opened.push(url);}};
        Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => {window.copied.push(text);}}, configurable: true});
        const root = createRoot(document.getElementById('root'));
        window.renderMarkdown = (source, streaming = false, id = 'a') => flushSync(() => root.render(
          streaming ? <StreamingMarkdown key={id} source={source}/> : <Markdown source={source}/>
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
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    const script = bundle.outputFiles[0]?.text;
    if (!script) throw Error("Missing test bundle");
    await page.addScriptTag({ content: script });
    await page.evaluate(
      `window.renderMarkdown('[safe](https://example.com) [bad](javascript:alert%281%29) [relative](/local)')`,
    );
    expect(await page.locator("a").count()).toBe(1);
    await page.getByRole("link", { name: "safe" }).click();
    await page.getByRole("link", { name: "safe" }).click({ button: "middle" });
    await page.getByRole("link", { name: "safe" }).focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate("window.opened")).toEqual(
      Array(3).fill("https://example.com"),
    );
    expect(page.url()).toBe("about:blank");
    const code = 'const text = "<script>";\n\nreturn text;';
    const source = `\`\`\`ts\n${code}\n\`\`\``;
    await page.evaluate(`window.renderMarkdown(${JSON.stringify(source)})`);
    expect(await page.locator(".code-token-keyword").count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "复制全文" }).click();
    expect(await page.evaluate("window.copied")).toEqual([code]);
    expect(await page.locator("script").count()).toBe(1); // only the test bundle

    await page.clock.install();
    await page.evaluate("window.renderMarkdown('# first', true)");
    await page.evaluate("window.renderMarkdown('# second', true)");
    expect(await page.locator("h1").textContent()).toBe("first");
    await page.clock.runFor(40);
    await page.evaluate("window.renderMarkdown('# latest', true)");
    await page.clock.runFor(45);
    expect(await page.locator("h1").textContent()).toBe("latest");
    await page.evaluate("window.renderMarkdown('# pending old', true)");
    await page.evaluate("window.renderMarkdown('# new session', true, 'b')");
    await page.clock.runFor(100);
    expect(await page.locator("h1").textContent()).toBe("new session");
    await page.evaluate("window.renderMarkdown('# pending final', true, 'b')");
    await page.evaluate("window.renderMarkdown('# committed final')");
    await page.clock.runFor(100);
    expect(await page.locator("h1").textContent()).toBe("committed final");

    // A separate real-clock run measures DOM updates and animation-frame gaps.
    const perf = await browser.newPage();
    await perf.setContent('<div id="root" style="max-width:760px"></div>');
    await perf.addScriptTag({ content: script });
    const metrics = await perf.evaluate<{
      characters: number;
      mutations: number;
      renderedBeforeFinish: number;
      headings: number;
      frames: number;
    }>(String.raw`(async () => {
      const source = ('## Section\n\n' + '- **item** with inline code and 中文内容.\n'.repeat(8) + '\n').repeat(35);
      window.renderMarkdown('', true);
      let mutations = 0; const gaps = []; let last = performance.now(); let running = true;
      const observer = new MutationObserver(() => {mutations++;});
      observer.observe(document.getElementById('root'), {subtree: true, childList: true, characterData: true});
      const frame = time => {gaps.push(time - last); last = time; if (running) requestAnimationFrame(frame);};
      requestAnimationFrame(frame);
      const start = performance.now();
      for (let i = 1; i <= 300; i++) {
        window.renderMarkdown(source.slice(0, Math.ceil(source.length * i / 300)), true);
        await new Promise(resolve => setTimeout(resolve, 4));
      }
      await new Promise(resolve => setTimeout(resolve, 160));
      const renderedBeforeFinish = document.querySelectorAll('h2').length;
      window.renderMarkdown(source);
      await new Promise(resolve => requestAnimationFrame(resolve));
      running = false; observer.disconnect(); gaps.sort((a,b) => a-b);
      return {characters: source.length, deltas: 300, mutations, durationMs: performance.now()-start,
        frames: gaps.length, p95FrameMs: gaps[Math.floor(gaps.length*0.95)], maxFrameMs: Math.max(...gaps),
        renderedBeforeFinish, headings: document.querySelectorAll('h2').length};
    })()`);
    console.log(
      "Markdown streaming browser measurement",
      JSON.stringify(metrics),
    );
    expect(metrics.characters).toBeGreaterThan(10000);
    expect(metrics.mutations).toBeLessThan(100);
    expect(metrics.renderedBeforeFinish).toBe(35);
    expect(metrics.headings).toBe(35);
    expect(metrics.frames).toBeGreaterThan(10);
    expect(errors).toEqual([]);
    await perf.close();
  } finally {
    await browser.close();
  }
}, 30000);
