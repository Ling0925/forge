import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("shows a session-weighted average through pauses, completion, reload and session switches", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."), loader: "tsx", contents: `
        import {createRoot} from 'react-dom/client';
        import {useState} from 'react';
        import {OutputSpeed} from './src/renderer/components/workbench/OutputSpeed';
        import './src/renderer/components/workbench/composer-activity.css';
        function Harness(){
          const [state,setState]=useState({run:{sessionId:'a',status:'running',unreportedOutputTokens:40},
            events:[{type:'run_started',timestamp:'2026-10-17T00:00:00Z'}],key:0});
          window.fixture={update:patch=>setState(old=>({...old,...patch}))};
          return <OutputSpeed key={state.key} run={state.run} events={state.events}/>;
        }
        createRoot(document.getElementById('root')).render(<Harness/>);
      `,
    },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "speed.js",
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  if (!js) throw new Error("Missing speed bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(3000);
    await page.clock.install({ time: new Date("2026-10-17T00:00:04Z") });
    await page.clock.pauseAt(new Date("2026-10-17T00:00:04Z"));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: js });
    const speed = page.locator(".composer-output-speed");
    const text = () => speed.innerText();
    const update = async (patch: object) => page.evaluate(
      patch => Reflect.get(window, "fixture").update(patch), patch,
    );
    await expect.poll(text).toBe("平均 ≈ 10 tok/s");
    await page.clock.runFor(4000);
    await expect.poll(text).toBe("平均 ≈ 5.0 tok/s");
    expect(await speed.getAttribute("title")).toContain("不含两次提问间的空闲");
    await update({ run: { sessionId: "a", status: "awaiting_approval", unreportedOutputTokens: 40 } });
    await expect.poll(text).toBe("平均 ≈ 5.0 tok/s");
    const events = [
      { type: "run_started", timestamp: "2026-10-17T00:00:00Z" },
      { type: "run_finished", timestamp: "2026-10-17T00:00:08Z", usage: { promptTokens: 900, completionTokens: 80, totalTokens: 980 }, usageComplete: true },
      { type: "run_started", timestamp: "2026-10-17T01:00:00Z" },
      { type: "run_finished", timestamp: "2026-10-17T01:00:02Z", usage: { promptTokens: 900, completionTokens: 120, totalTokens: 1020 }, usageComplete: true },
    ];
    await update({ run: undefined, events });
    await expect.poll(text).toBe("平均 20 tok/s"); // 200 / 10s, not (10 + 60) / 2
    await page.clock.runFor(60000);
    await expect.poll(text).toBe("平均 20 tok/s");
    await update({ key: 1 }); // a fresh mount restores from persisted events
    await expect.poll(text).toBe("平均 20 tok/s");
    await update({ events: [], run: { sessionId: "b", status: "running" } });
    await expect.poll(text).toBe("平均 — tok/s");
    expect(await text()).not.toMatch(/NaN|Infinity/);
  } finally {
    await browser.close();
  }
});
