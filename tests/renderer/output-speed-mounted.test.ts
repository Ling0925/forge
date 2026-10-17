import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("measures only fresh streamed output and clears speed across pauses, retries and runs", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
      import {createRoot} from 'react-dom/client';
      import {useState} from 'react';
      import {OutputSpeed} from './src/renderer/components/workbench/OutputSpeed';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/composer-activity.css';
      function Harness(){
        const [run,setRun]=useState({runId:'run-a',sessionId:'session-a',status:'running',streamingText:'',streamingTurn:0});
        window.fixture={update:patch=>setRun(old=>({...old,...patch}))};
        return <div className="composer-activity"><span>正在执行</span><OutputSpeed run={run}/></div>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "speed.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  if (!js) throw new Error("Missing speed bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.clock.install({ time: new Date("2026-10-17T00:00:00Z") });
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({
      content:
        bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ??
        "",
    });
    await page.addScriptTag({ content: js });
    const speed = page.locator(".composer-output-speed");
    const text = async () => ((await speed.count()) ? speed.innerText() : "");
    const rate = async () =>
      Number((await text()).match(/≈\s*([\d.]+)/)?.[1] ?? 0);
    const update = async (patch: object) =>
      page.evaluate(
        (patch) => Reflect.get(window, "fixture").update(patch),
        patch,
      );
    await page.waitForFunction(() => Boolean(Reflect.get(window, "fixture")));
    await page.clock.runFor(30_000);
    await update({ streamingText: "x".repeat(40) });
    await expect.poll(text).not.toContain("≈");
    await page.clock.runFor(1000);
    await update({ streamingText: "x".repeat(80) });
    await expect.poll(rate).toBeGreaterThanOrEqual(8);
    expect(await rate()).toBeLessThanOrEqual(12);
    expect(await speed.getAttribute("title")).toContain("估算");
    expect(await text()).toContain("tok/s");
    await page.clock.runFor(1000);
    await update({ streamingReasoning: "思".repeat(30) });
    await expect.poll(rate).toBeGreaterThanOrEqual(15);
    expect(await rate()).toBeLessThanOrEqual(35);
    expect(await text()).not.toMatch(/Infinity|NaN/);
    await page.clock.runFor(6000);
    await expect.poll(rate).toBe(0);
    await update({ providerRetry: 1 });
    await expect.poll(() => speed.count()).toBe(0);
    await update({
      providerRetry: undefined,
      streamingTurn: 1,
      streamingText: "",
      streamingReasoning: "",
    });
    await expect.poll(rate).toBe(0);
    await update({ runId: "run-b", streamingText: "x".repeat(120_000) });
    await expect.poll(text).not.toContain("≈");
    await page.clock.runFor(1000);
    await update({ streamingText: "x".repeat(120_040) });
    await expect.poll(rate).toBeGreaterThanOrEqual(8);
    expect(await rate()).toBeLessThanOrEqual(12);
    for (const patch of [
      { status: "awaiting_approval" },
      { status: "running", isCancelling: true },
      { status: "completed", isCancelling: false },
    ]) {
      await update(patch);
      await expect.poll(() => speed.count()).toBe(0);
    }
  } finally {
    await browser.close();
  }
}, 20_000);
