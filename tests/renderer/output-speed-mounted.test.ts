import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

const stamp = (seconds: number) => new Date(Date.UTC(2026, 9, 17) + seconds * 1000).toISOString();
const start = (seconds: number) => ({ type: "run_started", timestamp: stamp(seconds) });
const finish = (seconds: number, completionTokens: number) => ({
  type: "run_finished", timestamp: stamp(seconds), turns: 2,
  usage: { promptTokens: 900, completionTokens, totalTokens: 900 + completionTokens }, usageComplete: true,
});
const attempt = (seconds: number, outcome: string, completionTokens?: number) => ({
  type: "provider_attempt", timestamp: stamp(seconds),
  selection: { sourceId: "test", model: "test", apiMode: "responses", attempt: 0, reason: "direct", outcome, timestamp: stamp(seconds),
    ...(completionTokens === undefined ? {} : { usage: { promptTokens: 900, completionTokens, totalTokens: 900 + completionTokens } }),
  },
});

it("averages only request time and freezes through tools, approvals, completion, reload and session switches", async () => {
  const initialEvents = [start(0), attempt(2, "started")];
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."), loader: "tsx", contents: `
        import {createRoot} from 'react-dom/client';
        import {useState} from 'react';
        import {OutputSpeed} from './src/renderer/components/workbench/OutputSpeed';
        import './src/renderer/components/workbench/composer-activity.css';
        function Harness(){
          const [state,setState]=useState({run:{sessionId:'a',status:'running',unreportedOutputTokens:40},
            events:${JSON.stringify(initialEvents)},key:0});
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
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(3000);
    await page.clock.install({ time: new Date(stamp(6)) });
    await page.clock.pauseAt(new Date(stamp(6)));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: js });
    const speed = page.locator(".composer-output-speed");
    const text = () => speed.innerText();
    const update = async (patch: object) => page.evaluate(
      patch => Reflect.get(window, "fixture").update(patch), patch,
    );
    await expect.poll(text).toBe("平均 ≈ 10 tok/s"); // 40 / 4s, not the 6s since run start
    await page.clock.runFor(4000);
    await expect.poll(text).toBe("平均 ≈ 5.0 tok/s");
    expect(await speed.getAttribute("title")).toContain("请求总耗时");
    expect(await speed.getAttribute("title")).toContain("不含工具执行、审批、重试间隔");

    const afterFirst = [...initialEvents, attempt(10, "succeeded", 80), { type: "tool_started", timestamp: stamp(10) }];
    await update({ events: afterFirst }); // authoritative usage replaces, never adds to the stale estimate
    await expect.poll(text).toBe("平均 10 tok/s");
    await page.clock.runFor(60000); // tool / wait_agents work
    expect(await text()).toBe("平均 10 tok/s");
    await update({ run: { sessionId: "a", status: "awaiting_approval" } });
    await page.clock.runFor(60000);
    expect(await text()).toBe("平均 10 tok/s");

    const nextRequest = [...afterFirst, attempt(130, "started")];
    await update({ events: nextRequest, run: { sessionId: "a", status: "running", unreportedOutputTokens: 40 } });
    await page.clock.runFor(1000);
    await expect.poll(text).toBe("平均 ≈ 13 tok/s"); // (80 + 40) / (8 + 1)s
    await page.clock.runFor(1000);
    const afterSecond = [...nextRequest, attempt(132, "succeeded", 120)];
    await update({ events: afterSecond, run: { sessionId: "a", status: "running", unreportedOutputTokens: 0 } });
    await expect.poll(text).toBe("平均 20 tok/s"); // 200 / 10s, not (10 + 60) / 2
    await page.clock.runFor(60000);
    expect(await text()).toBe("平均 20 tok/s");
    const completed = [...afterSecond, finish(192, 200)];
    await update({ run: undefined, events: completed });
    await expect.poll(text).toBe("平均 20 tok/s");

    const events = [...completed, start(3600), attempt(3605, "started"), attempt(3615, "succeeded", 300), finish(3620, 300)];
    await update({ events });
    await expect.poll(text).toBe("平均 25 tok/s"); // (200 + 300) / (10 + 10)s
    await page.clock.runFor(60000);
    expect(await text()).toBe("平均 25 tok/s");
    await update({ key: 1 }); // fresh mount restores paired requests from persisted events
    await expect.poll(text).toBe("平均 25 tok/s");
    await update({ events: [...events, start(4000), attempt(4001, "started")], run: { sessionId: "a", status: "interrupted" } });
    await page.clock.runFor(86400000);
    expect(await text()).toBe("平均 25 tok/s"); // unmatched inactive requests never count days of idle time
    await update({ events: [start(0), finish(100, 1000)], run: undefined });
    await expect.poll(text).toBe("平均 — tok/s"); // legacy wall time is not request time
    await update({ events: [], run: { sessionId: "b", status: "running" } });
    await expect.poll(text).toBe("平均 — tok/s");
    expect(await text()).not.toMatch(/NaN|Infinity/);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
