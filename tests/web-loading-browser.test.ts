import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { expect, it } from "vitest";
import { createHarness } from "../src/core/harness";
import { createRuntimeHub } from "../src/desktop/runtime";
import { startLanServer } from "../src/web/lan";

async function loadingMetrics(page: Page) {
  await page.locator(".composer-textarea").waitFor();
  await page.waitForFunction(() => !!window.forge);
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const assets = resources.filter((entry) => new URL(entry.name).pathname.startsWith("/assets/"));
    return {
      readyMs: Math.round(performance.now()),
      assetRequests: assets.length,
      transferredBytes: assets.reduce((sum, entry) => sum + entry.transferSize, 0),
      encodedBytes: assets.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      decodedBytes: assets.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      scripts: assets.filter((entry) => entry.name.endsWith(".js")).map((entry) => new URL(entry.name).pathname),
    };
  });
}

// Requires `node scripts/build-web.mjs`. Uses an isolated stateDir and a fixture
// provider, never the user's FORGE_HOME, credentials or an external model.
it("loads the production workbench over a slow link and opens secondary panels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forge-loading-browser-"));
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  await new Promise<void>((done) => reservation.close(() => done()));
  const service = await createHarness({
    stateDir: join(directory, "state"),
    providerFactory: () => ({
      listModels: async () => ["fixture"],
      complete: async () => ({ message: { role: "assistant", content: "fixture" } }),
    }),
  });
  await service.updateSettings({ settings: { baseUrl: "http://localhost:1234/v1", model: "fixture" } });
  const runtime = createRuntimeHub(service);
  const server = await startLanServer({
    runtime, host: "127.0.0.1", port: address.port,
    workspace: directory, rendererRoot: resolve("dist/renderer"),
    trustedLan: true, stateDir: join(directory, "state"),
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: 150, downloadThroughput: 192_000, uploadThroughput: 96_000,
    });
    await page.goto(server.origin);
    const cold = await loadingMetrics(page);
    expect(cold.scripts.some((path) => /Settings-|UsageDashboard-|PrimitiveShowcase-/.test(path))).toBe(false);
    expect(cold.encodedBytes).toBeLessThan(cold.decodedBytes / 2);
    expect(cold.transferredBytes).toBeLessThan(500_000);
    await page.locator(".composer-textarea").fill("Draft survives opening settings");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "外观", exact: true }).click();
    await page.getByRole("button", { name: "执行与权限", exact: true }).click();
    expect(await page.getByLabel("工具调用预算", { exact: true }).count()).toBe(0);
    await page.getByLabel("请求空闲超时（毫秒）", { exact: true }).fill("30000");
    await page.getByLabel("搜索设置", { exact: true }).fill("超时");
    await page.getByRole("button", { name: "返回工作台", exact: true }).click();
    expect(await page.locator(".composer-textarea").inputValue()).toBe("Draft survives opening settings");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    expect(await page.getByLabel("搜索设置", { exact: true }).inputValue()).toBe("超时");
    expect(await page.getByLabel("请求空闲超时（毫秒）", { exact: true }).inputValue()).toBe("30000");
    await page.getByRole("button", { name: "返回工作台", exact: true }).click();
    await page.getByRole("button", { name: "用量看板", exact: true }).click();
    await page.getByRole("dialog", { name: "用量看板", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.reload();
    const warm = await loadingMetrics(page);
    console.log("Production loading (150ms latency, 1.536Mbps):", JSON.stringify({ cold, warm }));
    expect(warm.transferredBytes).toBe(0);
    expect(warm.scripts.some((path) => /Settings-|UsageDashboard-|PrimitiveShowcase-/.test(path))).toBe(false);
    await page.evaluate(() => { location.hash = "showcase"; });
    await page.getByRole("heading", { name: "Forge 原语工坊", exact: true }).waitFor();
    expect(errors).toEqual([]);

    // A failed optional chunk must not take down the conversation or its draft.
    // Use a separate context: routing disables cache, invalidating warm metrics.
    const failingContext = await browser.newContext();
    const failing = await failingContext.newPage();
    await failing.route("**/assets/Settings-*.js", (route) => route.abort());
    await failing.goto(server.origin);
    await failing.locator(".composer-textarea").fill("Keep this draft after a chunk failure");
    await failing.getByRole("button", { name: "设置", exact: true }).click();
    await failing.getByRole("alert").filter({ hasText: "设置加载失败" }).waitFor();
    await failing.getByRole("button", { name: "返回工作台", exact: true }).click();
    expect(await failing.locator(".composer-textarea").inputValue()).toBe("Keep this draft after a chunk failure");
    await failing.unroute("**/assets/Settings-*.js");
    await failing.getByRole("button", { name: "设置", exact: true }).click();
    await failing.getByRole("navigation", { name: "设置分类" }).waitFor({ timeout: 5000 });
    await failing.getByRole("button", { name: "返回工作台", exact: true }).click();
    expect(await failing.locator(".composer-textarea").inputValue()).toBe("Keep this draft after a chunk failure");
    await failingContext.close();

    // Android uses this same renderer in a WebView. Retry both script and CSS
    // failures, including repeated failures and closing/reopening a failed panel.
    for (const extension of ["js", "css", "*"]) {
      const mobileContext = await browser.newContext({
        viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
        userAgent: "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36 ForgeMobile/1",
      });
      const mobile = await mobileContext.newPage();
      mobile.setDefaultTimeout(5000);
      let chunkAttempts = 0;
      let failChunk = true;
      await mobile.route(`**/assets/UsageDashboard-*.${extension}`, (route) => {
        chunkAttempts += 1;
        return failChunk ? route.abort() : route.continue();
      });
      await mobile.goto(server.origin);
      await mobile.locator(".composer-textarea").fill("用量失败后保留手机草稿");
      const timeOrigin = await mobile.evaluate(() => performance.timeOrigin);
      const openUsage = async () => {
        await mobile.getByRole("button", { name: "打开会话列表" }).click();
        await mobile.getByRole("button", { name: "用量看板", exact: true }).click();
      };
      const alert = mobile.getByRole("alert").filter({ hasText: "用量看板加载失败" });
      await openUsage();
      await alert.waitFor();
      expect(chunkAttempts).toBeGreaterThan(0);
      let failedAttempts = chunkAttempts;
      await mobile.getByRole("button", { name: "重试", exact: true }).click();
      await alert.waitFor();
      expect(chunkAttempts).toBeGreaterThan(failedAttempts);
      failedAttempts = chunkAttempts;
      await mobile.getByRole("button", { name: "返回工作台", exact: true }).click();
      expect(await mobile.locator(".composer-textarea").inputValue()).toBe("用量失败后保留手机草稿");
      await openUsage();
      await alert.waitFor();
      expect(chunkAttempts).toBeGreaterThan(failedAttempts);
      for (const theme of ["light", "dark"]) {
        await mobile.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const refresh = await mobile.getByRole("button", { name: "刷新页面", exact: true }).boundingBox();
        expect(refresh && refresh.y + refresh.height).toBeLessThanOrEqual(852);
      }
      failedAttempts = chunkAttempts;
      failChunk = false;
      if (extension === "js") {
        await mobile.getByRole("button", { name: "返回工作台", exact: true }).click();
        await openUsage();
      } else {
        await mobile.getByRole("button", { name: "重试", exact: true }).click();
      }
      await mobile.getByRole("dialog", { name: "用量看板", exact: true }).waitFor();
      expect(chunkAttempts).toBeGreaterThan(failedAttempts);
      expect(await mobile.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
      expect(await mobile.locator(".usage-dashboard-overlay").evaluate(el => getComputedStyle(el).position)).toBe("fixed");
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mobile.getByLabel("时间周期筛选").selectOption("7");
      await mobile.getByRole("button", { name: "关闭看板", exact: true }).click();
      expect(await mobile.locator(".composer-textarea").inputValue()).toBe("用量失败后保留手机草稿");
      await openUsage();
      expect(await mobile.getByLabel("时间周期筛选").inputValue()).toBe("7");
      await mobileContext.close();
    }

    // A stale deployment/missing chunk also has an actionable page reload,
    // rather than instructions Android's toolbar-less WebView cannot follow.
    const staleContext = await browser.newContext();
    const stale = await staleContext.newPage();
    stale.setDefaultTimeout(5000);
    await stale.route("**/assets/UsageDashboard-*.js", route => route.fulfill({ status: 404, body: "Not found" }));
    await stale.goto(server.origin);
    await stale.locator(".composer-textarea").fill("刷新前的草稿");
    await stale.getByRole("button", { name: "用量看板", exact: true }).click();
    await stale.getByRole("alert").filter({ hasText: "用量看板加载失败" }).waitFor();
    await stale.unroute("**/assets/UsageDashboard-*.js");
    await Promise.all([
      stale.waitForEvent("load"),
      stale.getByRole("button", { name: "刷新页面", exact: true }).click(),
    ]);
    await stale.locator(".composer-textarea").waitFor();
    expect(await stale.locator(".composer-textarea").inputValue()).toBe("刷新前的草稿");
    await stale.getByRole("button", { name: "用量看板", exact: true }).click();
    await stale.getByRole("dialog", { name: "用量看板", exact: true }).waitFor();
    await staleContext.close();
  } finally {
    await browser.close();
    await server.close();
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
