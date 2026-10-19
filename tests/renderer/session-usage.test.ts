import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import {
  appendSessionEvent,
  sessionUsage,
} from "../../src/renderer/state/session-usage";
import { agentEventSchema } from "../../src/shared/schemas";

const base = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  timestamp: new Date().toISOString(),
};
const context = (
  promptTokens: number,
  cachedPromptTokens?: number,
  windowTokens: number | null = 10000,
) =>
  agentEventSchema.parse({
    ...base,
    type: "context_usage",
    usage: {
      promptTokens,
      completionTokens: 100,
      usedTokens: promptTokens + 100,
      windowTokens,
      estimated: true,
      basis: "request-with-output",
      ...(cachedPromptTokens === undefined ? {} : { cachedPromptTokens }),
      parts: {
        instructions: 0,
        memory: 0,
        conversation: promptTokens + 100,
        tools: 0,
      },
    },
  });
const finished = agentEventSchema.parse({
  ...base,
  type: "run_finished",
  status: "completed",
  turns: 1,
  toolCalls: 0,
  usage: {
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cachedPromptTokens: 900,
  },
  usageComplete: true,
});

it("reuses cached usage and processes only appended events without mutating previous totals", () => {
  let reads = 0;
  const oldEvent = new Proxy(context(1000, 900), {
    get(target, key, receiver) {
      reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const events = [oldEvent];
  const original = sessionUsage(events);
  reads = 0;
  expect(sessionUsage(events)).toBe(original);
  const next = appendSessionEvent(events, finished);
  expect(sessionUsage(next).total?.totalTokens).toBe(1100);
  expect(reads).toBe(0);
  expect(original.total?.totalTokens).toBe(1100);
  const irrelevant = appendSessionEvent(
    next,
    agentEventSchema.parse({
      ...base,
      type: "state_changed",
      status: "completed",
    }),
  );
  expect(sessionUsage(irrelevant)).toBe(sessionUsage(next));
  expect(sessionUsage([...next])).toEqual(sessionUsage(next));
  expect(sessionUsage([context(5000, 0)]).total?.totalTokens).toBe(5100);
});

it("separates context from session totals, replaces live usage on completion and preserves unknown cache", () => {
  const first = context(1000, 900);
  expect(sessionUsage([first]).total?.totalTokens).toBe(1100);
  expect(sessionUsage([first, finished]).total?.totalTokens).toBe(1100);
  expect(sessionUsage([finished]).cacheRead).toBe(900);
  expect(sessionUsage([finished]).latestCache).toBeUndefined();
  const result = sessionUsage([first, finished, context(2000)]);
  expect(result.total).toEqual({
    promptTokens: 3000,
    completionTokens: 200,
    totalTokens: 3200,
  });
  expect(result.context?.usedTokens).toBe(2000);
  expect(result.latestCache).toBeUndefined();
  expect(result.averageCache).toBe(0.9);
  expect(result.cachePartial).toBe(true);
  expect(sessionUsage([context(1000, 0)]).latestCache).toBe(0);
  expect(
    sessionUsage([context(1000, undefined, null)]).context?.windowTokens,
  ).toBeNull();
  expect(sessionUsage([]).total).toBeUndefined();
});

it("usage popover stays readable and dismissible on desktop/mobile in both themes", async () => {
  const events = [
    context(1000, 900),
    finished,
    context(486300, 474628, 1048576),
  ];
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
    import {createRoot} from 'react-dom/client';
    import {UsagePopover} from './src/renderer/components/workbench/UsagePopover';
    import './src/renderer/styles/global.css';
    import './src/renderer/components/workbench/app.css';
    import './src/renderer/styles/workspace-theme.css';
    const events = ${JSON.stringify(events)};
    if (location.search === '?unknown-window') {
      events.splice(0, events.length, ${JSON.stringify(context(61597, 58368, null))});
    } else {
      events.at(-1).usage.parts = { instructions: 20000, memory: 40000, conversation: 100000, tools: 326400 };
    }
    const snapshot = {version:1,id:events[0].sessionId,title:'test',workspace:'/tmp',model:'model',createdAt:events[0].timestamp,updatedAt:events.at(-1).timestamp,status:'completed',messages:[],changes:[],events};
    if (location.search === '?unknown-window') snapshot.status = 'running';
    const root = createRoot(document.getElementById('root'));
    const render = () => root.render(<div className="wb-app"><UsagePopover events={[...events]} snapshot={snapshot} /></div>);
    window.appendUsage = event => { events.push(event); snapshot.status = 'running'; render(); };
    render();
  `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "usage.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    const js = bundle.outputFiles.find((file) =>
      file.path.endsWith(".js"),
    )?.text;
    const css = bundle.outputFiles.find((file) =>
      file.path.endsWith(".css"),
    )?.text;
    if (!js || !css) throw new Error("Missing usage bundle");
    await page.route("http://usage.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<style>${css}.wb-app{height:650px!important;align-items:flex-end;justify-content:flex-end;padding:24px}</style><div id="root"></div><button id="outside">外部</button><script>${js.replaceAll("</script", "<\\/script")}</script>`,
      }),
    );
    await page.goto("http://usage.test/");
    for (const width of [1440, 390])
      for (const theme of ["dark", "light"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const trigger = page.getByLabel("上下文与用量", { exact: true });
        expect(await trigger.innerText()).toContain("CH 97.6%");
        expect(await trigger.innerText()).toContain("1M");
        const track = await page.locator(".usage-track").boundingBox();
        if (!track) throw new Error("Missing context track");
        expect(track.height).toBe(3);
        const segments = await page.locator(".usage-segment").evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, color: getComputedStyle(node).backgroundColor })));
        expect(new Set(segments.map(segment => segment.color)).size).toBe(4);
        expect(segments.reduce((sum, segment) => sum + segment.width, 0) / track.width).toBeCloseTo(486400 / 1048576, 2);
        const reserve = await page.locator(".usage-reserve").boundingBox();
        if (!reserve) throw new Error("Missing context reserve segment");
        expect(reserve.width / track.width).toBeCloseTo(0.2, 1);
        expect(await page.locator(".usage-reserve").getAttribute("title")).toContain("压缩预留区");
        await trigger.click();
        const panel = page.getByRole("region", { name: "用量详情" });
        expect(await panel.innerText()).toContain("46.4% / 486.3K");
        expect(await panel.innerText()).toContain("97.6%");
        expect(await panel.innerText()).toContain("压缩预留");
        for (const label of ["指令", "记忆", "对话", "工具"]) expect(await panel.innerText()).toContain(label);
        const panelSegments = await page.locator(".usage-panel-segment").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
        expect(new Set(panelSegments).size).toBe(4);
        expect(await page.locator(".usage-panel-reserve").count()).toBe(1);
        const rect = await panel.boundingBox();
        if (!rect) throw new Error("Missing usage panel");
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `/tmp/forge-usage-${width}-${theme}.png`,
        });
        await page.keyboard.press("Escape");
        expect(await panel.count()).toBe(0);
        await trigger.click();
        await page.locator("#outside").click();
        expect(await panel.count()).toBe(0);
      }
    const saved = await page.evaluate(() =>
      localStorage.getItem("forge-session-usage-v2"),
    );
    expect(saved).toContain('"eventCount":3');
    await page.reload();
    await page.getByLabel("上下文与用量", { exact: true }).click();
    expect(
      await page.getByRole("region", { name: "用量详情" }).innerText(),
    ).toContain("46.4% / 486.3K");
    expect(
      await page.evaluate(() => localStorage.getItem("forge-session-usage-v2")),
    ).toBe(saved);
    const projected = { ...base, type: "context_usage", usage: { windowTokens: 1048576, usedTokens: 120000, estimated: true, basis: "projected", parts: { instructions: 0, memory: 0, conversation: 120000, tools: 0 } } };
    await page.evaluate(event => Reflect.get(window, 'appendUsage')(event), projected);
    const detail = page.getByRole('region', { name: '用量详情' });
    await expect.poll(() => detail.innerText()).toContain('≈120K tokens');
    expect(await page.getByLabel('上下文与用量', { exact: true }).innerText()).toContain('1M');
    expect(await detail.innerText()).toContain('最近请求输入（实报）');
    await page.evaluate(event => Reflect.get(window, 'appendUsage')(event), { ...base, type: 'context_compacted', removedMessages: 10, beforeChars: 1000000, afterChars: 400000 });
    await page.evaluate(event => Reflect.get(window, 'appendUsage')(event), projected);
    await expect.poll(() => page.getByLabel('上下文与用量', { exact: true }).innerText()).toContain('1M');
    expect(await detail.innerText()).toContain('压缩后预估（待实报）');
    expect(await detail.innerText()).toContain('累计用量不清零');
    await page.goto("http://usage.test/?unknown-window");
    await page.getByText("61.6K tokens", { exact: true }).click();
    const unknownPanel = page.getByRole("region", { name: "用量详情" });
    expect(await unknownPanel.innerText()).toContain("61.6K tokens 已用");
    expect(await unknownPanel.innerText()).toContain("上下文窗口未知，暂不计算百分比");
    expect(await page.getByRole("progressbar", { name: "上下文占用" }).count()).toBe(0);
  } finally {
    await browser.close();
  }
}, 20000);
