import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHarness } from "../../src/core/harness";
import { openSessionStore } from "../../src/store/sessions";
import { createUsageStatsService } from "../../src/core/usage-stats";
import { createModelPricingService, type ModelPricingService } from "../../src/core/model-pricing";
import type { SessionStore } from "../../src/shared/contracts";
import type { UsageFilter } from "../../src/shared/ipc";
import { sessionIdSchema, type AgentEvent, type SessionSnapshot } from "../../src/shared/schemas";

let browser: Browser;
let js: string;
let css: string;
const now = Date.now();
const stamp = (hours: number) => new Date(now + hours * 3600000).toISOString();
const sessionA = sessionIdSchema.parse("00000000-0000-0000-0000-000000000001");
const sessionB = sessionIdSchema.parse("00000000-0000-0000-0000-000000000002");
const event = (outcome: "started" | "succeeded" | "failed", hours: number, step: number, extra = {}): AgentEvent => ({
  type: "provider_attempt", sessionId: sessionA, timestamp: stamp(hours), turn: 1, step,
  selection: { sourceId: "source-a", model: "source:vendor/gpt-6-astra", credentialId: "default", groupId: "r1",
    apiMode: "responses", reason: "order:first", attempt: 1, timestamp: stamp(hours), outcome, ...extra },
});
const makeSnapshot = (events: readonly AgentEvent[], overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  version: 1, id: sessionA, title: "会话 A", workspace: "/workspace/a", model: "gpt-6-astra", status: "running",
  createdAt: stamp(-240), updatedAt: stamp(0), messages: [], changes: [], events, ...overrides,
});
const fixtures = [
  makeSnapshot([
    event("started", -2, 1, { reasoningEffort: "high" }), event("succeeded", -2 + 2 / 3600, 1, {
      reasoningEffort: "high", usage: { promptTokens: 120, completionTokens: 80, cachedPromptTokens: 30, totalTokens: 200 },
    }),
    event("started", -1, 2, { reasoningEffort: "none" }),
    event("failed", -1 + 1 / 3600, 2, { reasoningEffort: "none", errorCode: "rate_limit" }),
    event("started", -0.5, 3, { reasoningEffort: "default" }),
  ]),
  makeSnapshot([event("succeeded", -192, 1, {
    sourceId: "deleted-source", credentialId: "old-key", groupId: undefined, model: "old/model",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  })], { id: sessionB, title: "会话 B", workspace: "/workspace/b", status: "completed" }),
];

beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {UsageDashboard} from './src/renderer/components/workbench/UsageDashboard';
      import {TestProvider} from './src/renderer/state/workbench-context';
      import './src/renderer/styles/global.css';
      window.filters=[]; window.selected=[];
      window.forge={getUsageStats:async filter=>{
        window.filters.push(filter);
        if(window.failNext){window.failNext=false;throw new Error('fixture load failed');}
        const data=await window.fixtureStats(filter);
        if(window.bulk){data.requests=Array.from({length:55},(_,i)=>({...data.requests[0],id:'bulk-'+i}));}
        if(window.legacy){delete data.requests;}
        if(window.metricSamples){
          const {tokensPerSecond,estimatedCostUsd,...base}=data.requests.find(request=>request.usage?.completionTokens>0);
          data.requests=[
            {...base,id:'sample-normal',tokensPerSecond:0,estimatedCostUsd:1.234},
            {...base,id:'sample-tiny',tokensPerSecond:1234.56,estimatedCostUsd:0.00001},
            {...base,id:'sample-legacy'},
          ];
        }
        if(window.richSummary){
          const today=data.requests[0]?.timestamp?.slice(0,10)||'2026-10-21';
          data.totalPromptTokens=18400;
          data.totalCompletionTokens=6200;
          data.totalCachedTokens=11200;
          data.totalTokens=24600;
          data.averageCacheRate=11200/18400;
          data.totalRuns=14;
          data.daily=[
            {date:'2026-10-18',promptTokens:3200,completionTokens:1100,cachedTokens:1800,totalTokens:4300,runCount:3},
            {date:'2026-10-19',promptTokens:5400,completionTokens:1900,cachedTokens:3600,totalTokens:7300,runCount:4},
            {date:'2026-10-20',promptTokens:4100,completionTokens:1400,cachedTokens:2500,totalTokens:5500,runCount:3},
            {date:today,promptTokens:5700,completionTokens:1800,cachedTokens:3300,totalTokens:7500,runCount:4},
          ];
          data.models=[
            {model:'source:vendor/gpt-6-astra',promptTokens:14200,completionTokens:4800,cachedTokens:9200,totalTokens:19000,runCount:10,sessionCount:1},
            {model:'old/model',promptTokens:4200,completionTokens:1400,cachedTokens:2000,totalTokens:5600,runCount:4,sessionCount:1},
          ];
        }
        if(window.holdSeven&&filter.days===7){await new Promise(resolve=>{window.releaseSeven=resolve;});}
        return data;
      }};
      createRoot(document.getElementById('root')).render(<TestProvider><UsageDashboard/></TestProvider>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "usage-requests.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "usage-state", setup(api) {
      api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
        resolveDir: resolve("."), loader: "tsx", contents: `
          import {createContext,useContext,useState} from 'react';
          const C=createContext(null);export const useWorkbench=()=>useContext(C);
          export function TestProvider({children}){
            const [open,setOpen]=useState(true);
            const state={isUsageDashboardOpen:open,sessions:[{workspace:'/workspace/a'},{workspace:'/workspace/b'}],settings:{
              reasoningEffort:'max',
              providerSources:[{id:'source-a',label:'供应商 A',credentials:[{id:'default',label:'主密钥'}]}],
              routeGroups:[{id:'r1',label:'路由 A'}]}};
            return <C.Provider value={{state,openUsageDashboard:setOpen,selectSession:async id=>{window.selected.push(id)}}}>{children}</C.Provider>;
          }
        `,
      }));
    } }],
  });
  js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  browser = await chromium.launch({ headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE } : {}),
  });
}, 30000);

afterAll(async () => { await browser?.close(); });

async function mount(snapshots: readonly SessionSnapshot[] = fixtures, pricingService?: ModelPricingService): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  const store = {
    list: async () => snapshots,
    get: async (id: string) => snapshots.find(snapshot => snapshot.id === id),
  } as unknown as SessionStore;
  const pricing = pricingService ?? createModelPricingService({ fetch: async () => Response.json({ vendor: { models: {
    "gpt-6-astra": { cost: { input: 3, output: 15, cache_read: 0.3 } },
    "model": { cost: { input: 3, output: 15 } },
  } } }) });
  const service = createUsageStatsService(store, pricing);
  await page.exposeFunction("fixtureStats", (filter: UsageFilter) => service.getUsageStats(filter));
  await page.route("https://forge.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://forge.test/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await expect.poll(() => page.locator(".usage-summary").count()).toBe(1);
  return page;
}

it("moves individual request metadata into a tab with details and session navigation", async () => {
  const page = await mount();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const summary = page.getByRole("tab", { name: "用量统计", exact: true });
    const requests = page.getByRole("tab", { name: "请求记录", exact: true });
    expect(await summary.getAttribute("aria-selected")).toBe("true");
    expect(await page.locator(".usage-dashboard-subtitle").count()).toBe(0);
    expect(await page.locator(".usage-request-row").count()).toBe(0);
    await requests.click();
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(4);
    expect(await page.getByRole("columnheader", { name: "Token 速度", exact: true }).count()).toBe(1);
    expect(await page.getByRole("columnheader", { name: "预估费用 (USD)", exact: true }).count()).toBe(1);
    expect(await page.locator(".usage-summary").count()).toBe(0);
    const rows = page.locator(".usage-request-row");
    expect(await rows.nth(0).innerText()).toContain("请求中");
    expect(await rows.nth(0).locator("td").nth(8).innerText()).toBe("—");
    expect(await rows.nth(0).locator("td").nth(9).innerText()).toBe("—");
    expect(await rows.nth(1).innerText()).toContain("失败");
    expect(await rows.nth(1).innerText()).toContain("rate_limit");
    expect(await rows.nth(1).locator("td").nth(6).innerText()).toBe("—");
    expect(await rows.nth(1).locator("td").nth(8).innerText()).toBe("—");
    expect(await rows.nth(1).locator("td").nth(9).innerText()).toBe("—");
    expect(await rows.nth(2).innerText()).toContain("供应商 A");
    expect(await rows.nth(2).innerText()).toContain("gpt-6-astra");
    expect(await rows.nth(2).innerText()).toContain("主密钥");
    expect(await rows.nth(2).innerText()).toContain("成功");
    expect(await page.getByRole("columnheader", { name: "缓存", exact: true }).count()).toBe(0);
    expect(await page.getByRole("columnheader", { name: "思考等级", exact: true }).count()).toBe(1);
    expect(await rows.nth(2).locator(".usage-request-tokens > span").first().innerText()).toBe("120 / 80");
    expect(await rows.nth(2).locator(".usage-request-cache").innerText()).toBe("缓存 30");
    expect(await rows.nth(1).locator(".usage-request-cache").innerText()).toBe("缓存 —");
    expect(await rows.locator(".usage-request-reasoning").allTextContents()).toEqual(["模型默认", "none", "high", "未记录"]);
    expect(await rows.nth(3).locator(".usage-request-reasoning").getAttribute("title")).toContain("旧版 Web/CLI 需更新并重启");
    expect(await rows.nth(2).locator("td").nth(7).innerText()).toBe("2.00 s");
    expect(await rows.nth(2).locator("td").nth(8).innerText()).toBe("40.0 tok/s");
    expect(await rows.nth(2).locator("td").nth(9).innerText()).toBe("$0.0015");
    expect(await rows.nth(3).innerText()).toContain("deleted-source");
    expect(await rows.nth(3).locator("td").nth(6).innerText()).toBe("0");
    expect(await rows.nth(3).locator("td").nth(7).innerText()).toBe("—");
    expect(await rows.nth(3).locator("td").nth(8).innerText()).toBe("—");
    expect(await rows.nth(3).locator("td").nth(9).innerText()).toBe("$0.00");

    await rows.nth(2).getByRole("button", { name: "详情", exact: true }).click();
    const detail = page.locator(".usage-request-details");
    await expect.poll(() => detail.count()).toBe(1);
    expect(await page.locator(".usage-request-detail-row td").getAttribute("colspan")).toBe("11");
    const text = await detail.innerText();
    expect(await detail.locator("div").filter({ has: page.getByText("思考等级", { exact: true }) }).locator("dd").innerText()).toBe("high");
    for (const value of ["source-a", "default", "路由 A (r1)", "responses", "order:first", "/workspace/a"]) {
      expect(text).toContain(value);
    }
    await mkdir(".build/usage-requests/browser", { recursive: true });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
        const bounds = await page.getByRole("dialog").boundingBox();
        expect(bounds?.width).toBeLessThanOrEqual(width);
        const cacheLayout = await rows.nth(2).locator(".usage-request-tokens").evaluate(cell => {
          const first = cell.children[0]!;
          const cache = cell.children[1]!;
          return { firstBottom: first.getBoundingClientRect().bottom, cacheTop: cache.getBoundingClientRect().top,
            firstColor: getComputedStyle(first).color, cacheColor: getComputedStyle(cache).color,
            cacheDisplay: getComputedStyle(cache).display };
        });
        expect(cacheLayout.cacheTop).toBeGreaterThanOrEqual(cacheLayout.firstBottom);
        expect(cacheLayout.cacheDisplay).toBe("block");
        expect(cacheLayout.cacheColor).not.toBe(cacheLayout.firstColor);
        if (width === 390) {
          const overflow = await page.locator(".usage-table-wrapper").evaluate(element => ({
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          }));
          expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
        }
        await page.screenshot({ path: `.build/usage-requests/browser/${theme}-${width}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await requests.focus();
    await requests.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect.poll(() => summary.getAttribute("aria-selected")).toBe("true");
    await requests.click();
    await rows.nth(2).getByRole("button", { name: "详情", exact: true }).click();
    await detail.getByRole("button", { name: "会话 A", exact: true }).click();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { selected: string[] }).selected)).toEqual([sessionA]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("shows every reasoning level, distinguishes default from unrecorded, and keeps zero cache visible", async () => {
  const efforts = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max", undefined];
  const page = await mount([makeSnapshot(efforts.map((reasoningEffort, index) =>
    event("succeeded", -9 + index, index + 1, {
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 },
    })), { status: "completed" })]);
  try {
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    const rows = page.locator(".usage-request-row");
    await expect.poll(() => rows.count()).toBe(9);
    expect(await rows.locator(".usage-request-reasoning").allTextContents())
      .toEqual(["未记录", "MAX", "xhigh", "high", "medium", "low", "minimal", "none", "模型默认"]);
    expect(await rows.locator(".usage-request-cache").allTextContents()).toEqual(Array(9).fill("缓存 0"));
    expect(await rows.nth(0).locator("td").count()).toBe(11);
    await rows.nth(0).getByRole("button", { name: "详情", exact: true }).click();
    expect(await page.locator(".usage-request-details div").filter({ has: page.getByText("思考等级", { exact: true }) }).locator("dd").innerText()).toBe("未记录");
  } finally { await page.close(); }
});

it("shows download failures in both tabs and retries prices immediately from the refresh button", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(Response.json({ lab: { models: { "gpt-6-astra": { cost: { input: 3, output: 15 } } } } }));
  const page = await mount(fixtures, createModelPricingService({ fetch: fetcher }));
  try {
    expect(await page.getByRole("status").innerText()).toBe("价格加载失败");
    expect(await page.locator(".usage-model-cost-tag").allTextContents()).toContain("价格未加载");
    await page.setViewportSize({ width: 390, height: 900 });
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    expect(await page.getByRole("status").innerText()).toBe("价格加载失败");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "刷新统计数据", exact: true }).click();
    await expect.poll(() => page.getByRole("status").count()).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await page.evaluate(() => (window as unknown as { filters: UsageFilter[] }).filters.at(-1)))
      .toMatchObject({ refreshPrices: true });
    expect(await page.locator(".usage-request-row").nth(2).locator("td").nth(9).innerText()).toBe("$0.0016");
    await page.getByRole("tab", { name: "用量统计", exact: true }).click();
    expect(await page.locator(".usage-model-cost-tag").allTextContents()).not.toContain("价格未加载");
    expect(await page.locator(".usage-model-cost-tag").allTextContents()).toContain("费用未知");
  } finally { await page.close(); }
});

it("labels stale prices without hiding still-usable estimates", async () => {
  let now = Date.now();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ lab: { models: { "gpt-6-astra": { cost: { input: 3, output: 15 } } } } }))
    .mockRejectedValue(new Error("offline"));
  const pricing = createModelPricingService({ fetch: fetcher, now: () => now });
  await pricing.getPrices();
  now += 24 * 3600000;
  const page = await mount(fixtures, pricing);
  try {
    expect(await page.getByRole("status").innerText()).toBe("使用缓存价格");
    expect(await page.locator(".usage-model-cost-tag").allTextContents()).toContain("预估 $0.0016（部分）");
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    expect(await page.locator(".usage-request-row").nth(2).locator("td").nth(9).innerText()).toBe("$0.0016");
  } finally { await page.close(); }
});

it("renders effort from a real HTTP request after event persistence rather than current UI settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-usage-wire-"));
  const sentEfforts: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.url?.endsWith("/models")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "gpt-6-astra", context_window: 100000 }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    sentEfforts.push(body.reasoning_effort);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  let service: Awaited<ReturnType<typeof createHarness>> | undefined;
  let page: Page | undefined;
  try {
    service = await createHarness({ stateDir: join(root, "home"), toolFactory: async () => ({
      definitions: [], execute: async () => ({ content: "", isError: false }), dispose: async () => {},
    }) });
    await service.updateSettings({ settings: { reasoningEffort: "high" } });
    await service.updateSettings({ source: { type: "save", apiKey: "", source: {
      id: "wire", label: "Wire fixture", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "gpt-6-astra", apiMode: "chat-completions",
    } } });
    const session = await service.createSession({ workspace: root, title: "Wire fixture", providerSourceId: "wire" });
    const result = await service.run({ sessionId: session.id, prompt: "hello", permission: "readonly" },
      () => {}, async () => false, new AbortController().signal);
    expect(result.status).toBe("completed");
    expect(sentEfforts).toEqual(["high"]);
    await service.updateSettings({ settings: { reasoningEffort: "max" } });
    const persisted = await (await openSessionStore(join(root, "home"))).get(session.id);
    page = await mount([persisted]);
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    await expect.poll(() => page!.locator(".usage-request-row").count()).toBe(1);
    expect(await page.locator(".usage-request-reasoning").innerText()).toBe("high");
    await page.getByRole("button", { name: "详情", exact: true }).click();
    expect(await page.locator(".usage-request-details div").filter({ has: page.getByText("思考等级", { exact: true }) }).locator("dd").innerText()).toBe("high");
  } finally {
    await page?.close();
    await service?.dispose();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("formats zero speed, ordinary and tiny costs, and older rows without metrics", async () => {
  const page = await mount();
  try {
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    await page.evaluate(() => { (window as unknown as { metricSamples: boolean }).metricSamples = true; });
    await page.getByRole("button", { name: "刷新统计数据", exact: true }).click();
    const rows = page.locator(".usage-request-row");
    await expect.poll(() => rows.count()).toBe(3);
    expect(await rows.nth(0).locator("td").nth(8).innerText()).toBe("0.0 tok/s");
    expect(await rows.nth(0).locator("td").nth(9).innerText()).toBe("$1.23");
    expect(await rows.nth(1).locator("td").nth(8).innerText()).toBe("1234.6 tok/s");
    expect(await rows.nth(1).locator("td").nth(9).innerText()).toBe("<$0.0001");
    expect(await rows.nth(2).locator("td").nth(8).innerText()).toBe("—");
    expect(await rows.nth(2).locator("td").nth(9).innerText()).toBe("—");
  } finally { await page.close(); }
});

it("shares time/workspace filters and ignores an older response arriving late", async () => {
  const page = await mount();
  try {
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    await page.getByLabel("时间周期筛选").selectOption("7");
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(3);
    await page.getByLabel("工作区筛选").selectOption("/workspace/b");
    await expect.poll(() => page.getByText("暂无请求记录", { exact: true }).count()).toBe(1);
    await page.getByLabel("时间周期筛选").selectOption("");
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(1);
    await page.getByLabel("工作区筛选").selectOption("");
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(4);
    await page.evaluate(() => { (window as unknown as { holdSeven: boolean }).holdSeven = true; });
    await page.getByLabel("时间周期筛选").selectOption("7");
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseSeven?: () => void }).releaseSeven)).toBe("function");
    await page.getByLabel("时间周期筛选").selectOption("");
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(4);
    await page.evaluate(async () => {
      (window as unknown as { releaseSeven: () => void }).releaseSeven();
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(await page.locator(".usage-request-row").count()).toBe(4);
    expect(await page.getByRole("tab", { name: "请求记录", exact: true }).getAttribute("aria-selected")).toBe("true");
  } finally { await page.close(); }
});

it("refreshes, retries failures, paginates without dropping records and handles older empty responses", async () => {
  const page = await mount();
  try {
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    await page.evaluate(() => { (window as unknown as { failNext: boolean }).failNext = true; });
    await page.getByRole("button", { name: "刷新统计数据", exact: true }).click();
    await expect.poll(() => page.getByText("fixture load failed", { exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => page.getByText("fixture load failed", { exact: true }).count()).toBe(0);
    expect(await page.locator(".usage-request-row").count()).toBe(4);
    await page.evaluate(() => { (window as unknown as { bulk: boolean }).bulk = true; });
    await page.getByRole("button", { name: "刷新统计数据", exact: true }).click();
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(50);
    expect(await page.getByRole("button", { name: "上一页", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(5);
    expect(await page.getByRole("button", { name: "下一页", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(50);
    await page.evaluate(() => { (window as unknown as { legacy: boolean }).legacy = true; });
    await page.getByRole("button", { name: "刷新统计数据", exact: true }).click();
    await expect.poll(() => page.getByText("暂无请求记录", { exact: true }).count()).toBe(1);
  } finally { await page.close(); }
});

it("renders full-screen usage dashboard charts, cost mode switch, and back button", async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { (window as unknown as { richSummary: boolean }).richSummary = true; });
    await page.getByRole("button", { name: "刷新统计数据", exact: true }).click();
    await expect.poll(() => page.locator(".usage-donut-svg").count()).toBe(1);

    expect(await page.getByText("Token 结构与缓存效率", { exact: true }).count()).toBe(1);
    expect(await page.getByText("模型速度与耗时对比", { exact: true }).count()).toBe(1);
    expect(await page.getByText("请求活跃时段与状态分布 (24h)", { exact: true }).count()).toBe(1);
    expect(await page.getByText("预估总费用 (USD)", { exact: true }).count()).toBe(1);
    expect(await page.getByText("平均输出速度", { exact: true }).count()).toBe(1);

    await page.getByRole("button", { name: "费用与请求", exact: true }).click();
    expect(await page.getByText("预估费用 (USD)", { exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "Token 构成", exact: true }).click();

    await mkdir(".build/usage-requests/browser", { recursive: true });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1080 });
        expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `.build/usage-requests/browser/summary-${theme}-${width}.png` });
      }
    }

    await page.getByRole("button", { name: "返回工作台", exact: true }).click();
    expect(await page.getByRole("dialog").count()).toBe(0);
  } finally { await page.close(); }
}, 30000);

it("prices legacy-only model distribution with labelled base estimates, matching totals and daily costs", async () => {
  const models = ["cx/gpt-6-astra[1m]", "ag/gemini-3.8-flash", "cx/gpt-6.1-sol", "wb/global:deepseek-v4.1-flash"];
  const hours = [-240, -4, -3, -2];
  const tokens = { promptTokens: 1000000, completionTokens: 2000, cachedPromptTokens: 900000, totalTokens: 1002000 };
  const events: AgentEvent[] = models.flatMap((model, index) => [
    { type: "run_started", sessionId: sessionA, model, permission: "readonly", timestamp: stamp(hours[index]!) },
    { type: "run_finished", sessionId: sessionA, status: "completed", turns: 1, toolCalls: 0,
      timestamp: stamp(hours[index]! + 0.1), usage: tokens },
  ]);
  const pricing = createModelPricingService({ fetch: async () => Response.json({ lab: { models: {
    "gpt-6-astra": { cost: { input: 3, output: 15, cache_read: 0.3, context_over_200k: { input: 30, output: 150, cache_read: 3 } } },
    "gemini-3.8-flash": { cost: { input: 1, output: 2, cache_read: 0.1 } },
    "gpt-6.1-sol": { cost: { input: 1, output: 2, cache_read: 0.1 } },
    "deepseek-v4.1-flash": { cost: { input: 1, output: 2, cache_read: 0.1 } },
  } } }) });
  const page = await mount([makeSnapshot(events, { status: "completed" })], pricing);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const rows = page.locator(".usage-model-item");
    expect(await rows.count()).toBe(4);
    expect(await rows.locator(".usage-model-name").allTextContents()).toEqual(models);
    expect(await rows.locator(".usage-model-cost-tag").allTextContents()).toEqual([
      "预估 $0.60（汇总估算）", "预估 $0.19（汇总估算）", "预估 $0.19（汇总估算）", "预估 $0.19（汇总估算）",
    ]);
    const costCard = page.locator(".usage-kpi-card").filter({ hasText: "预估总费用 (USD)" });
    expect(await costCard.innerText()).toContain("$1.18");
    expect(await costCard.innerText()).toContain("含历史汇总估算");
    await page.getByRole("button", { name: "费用与请求", exact: true }).click();
    const dailyTitles = await page.locator(".usage-daily-chart .usage-bar-stack").evaluateAll(nodes => nodes.map(node => node.getAttribute("title")));
    expect(dailyTitles.every(title => title?.includes("请求明细：0 次") && title.includes("未还原上下文阶梯价"))).toBe(true);
    expect(dailyTitles.some(title => title?.includes("预估 $0.60"))).toBe(true);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1080 });
        await rows.first().scrollIntoViewIfNeeded();
        expect(await rows.first().locator(".usage-model-cost-tag").isVisible()).toBe(true);
        expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `.build/usage-requests/browser/legacy-cost-${theme}-${width}.png` });
      }
    }
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    expect(await page.locator(".usage-request-row").count()).toBe(0); // Never invent requests.
    await page.getByRole("tab", { name: "用量统计", exact: true }).click();
    await page.getByLabel("时间周期筛选").selectOption("7");
    await expect.poll(() => rows.count()).toBe(3);
    expect(await costCard.innerText()).toContain("$0.58");
    await page.getByRole("button", { name: "刷新统计数据", exact: true }).click();
    await expect.poll(() => rows.count()).toBe(3);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("shows all historical and actual models with exact cost subtotals, unknown prices and partial coverage", async () => {
  const tokens = { promptTokens: 120, completionTokens: 80, cachedPromptTokens: 30, totalTokens: 200 };
  const page = await mount([makeSnapshot([
    { type: "run_started", sessionId: sessionA, model: "gpt-6-astra", permission: "readonly", timestamp: stamp(-240) },
    { type: "run_finished", sessionId: sessionA, status: "completed", turns: 1, toolCalls: 0, timestamp: stamp(-239), usage: tokens },
    { type: "run_started", sessionId: sessionA, model: "route-group", permission: "readonly", timestamp: stamp(-3) },
    event("succeeded", -2, 1, { usage: tokens }),
    event("succeeded", -1.9, 2, { usage: tokens }),
    event("failed", -1.8, 3, { errorCode: "rate_limit" }),
    event("succeeded", -1.7, 4, { model: "relay:vendor/gpt-6-astra", usage: {
      promptTokens: 360, completionTokens: 240, cachedPromptTokens: 90, totalTokens: 600,
    } }),
    event("succeeded", -1.6, 5, { model: "unpriced-model", usage: tokens }),
    event("succeeded", -1.5, 6, { model: "old/model", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
  ], { model: "latest-unused-model", status: "completed" })]);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const rows = page.locator(".usage-model-item");
    await expect.poll(() => rows.count()).toBe(5);
    const row = (model: string) => rows.filter({ has: page.locator(`.usage-model-name[title="${model}"]`) });
    expect(await row("source:vendor/gpt-6-astra").locator(".usage-model-cost-tag").innerText()).toBe("预估 $0.0030（部分）");
    expect(await row("source:vendor/gpt-6-astra").locator(".usage-model-cost-tag").getAttribute("title")).toContain("2 / 3 次请求");
    expect(await row("relay:vendor/gpt-6-astra").locator(".usage-model-cost-tag").innerText()).toBe("预估 $0.0044");
    expect(await row("gpt-6-astra").locator(".usage-model-cost-tag").innerText()).toBe("预估 $0.0015（汇总估算）");
    expect(await row("gpt-6-astra").locator(".usage-model-cost-tag").getAttribute("title")).toContain("未还原上下文阶梯价");
    expect(await row("unpriced-model").locator(".usage-model-cost-tag").innerText()).toBe("费用未知");
    expect(await row("old/model").locator(".usage-model-cost-tag").innerText()).toBe("预估 $0.00");
    expect(await row("latest-unused-model").count()).toBe(0);
    expect(await row("route-group").count()).toBe(0);
    expect(await page.locator(".usage-kpi-card").filter({ hasText: "预估总费用 (USD)" }).innerText()).toContain("$0.0089");
    expect(await page.locator(".usage-kpi-card").filter({ hasText: "预估总费用 (USD)" }).innerText()).toContain("含历史汇总估算");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      await row("source:vendor/gpt-6-astra").scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.build/usage-requests/browser/model-accounting-${width}.png` });
    }
    await page.getByLabel("时间周期筛选").selectOption("7");
    await expect.poll(() => rows.count()).toBe(4);
    expect(await row("gpt-6-astra").count()).toBe(0);
    expect(await row("source:vendor/gpt-6-astra").locator(".usage-model-cost-tag").innerText()).toBe("预估 $0.0030（部分）");
    await page.getByRole("tab", { name: "请求记录", exact: true }).click();
    await expect.poll(() => page.locator(".usage-request-row").count()).toBe(6);
    await page.getByRole("tab", { name: "用量统计", exact: true }).click();
    await page.getByRole("button", { name: "刷新统计数据", exact: true }).click();
    await expect.poll(() => rows.count()).toBe(4);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);
