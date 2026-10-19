import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("unifies navigation and opens recent tasks without loading their histories up front", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
      import {createRoot} from 'react-dom/client';
      import {App} from './src/renderer/components/workbench/App';
      import {defaultPublicSettings} from './src/shared/schemas';
      import './src/renderer/styles/global.css';
      import './src/renderer/styles/workspace-theme.css';
      import './src/renderer/styles/settings-models.css';
      import './src/renderer/styles/sidebar-compact.css';
      const titles=['整理工作区的会话导航与快捷入口','检查部署日志，定位连接中断后恢复失败的具体原因','完善文件预览和变更对比','继续实现新的命令面板','较早的任务'];
      const sessions=titles.map((title,i)=>({version:1,id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),
        title,workspace:'/tmp/forge-navigation-project',model:'fixture/model',status:'completed',
        createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-'+String(18-i).padStart(2,'0')+'T08:00:00.000Z',
        messages:[{role:'user',content:'请继续这个任务。'},{role:'assistant',content:'已整理当前工作区。\\n\\n可以继续检查导航和最近任务。'}],events:[],changes:[]}));
      const archived={...sessions[0],id:'archived',title:'归档任务',archived:true,updatedAt:'2026-10-20T00:00:00.000Z'};
      const child={...sessions[0],id:'child',title:'内部子任务',parentSessionId:sessions[0].id,updatedAt:'2026-10-20T00:00:00.000Z'};
      let listener=()=>{};
      window.fixture={reads:[],sessions:[sessions[4],archived,sessions[2],child,sessions[0],sessions[3],sessions[1]],
        approve:()=>listener({runId:'22222222-2222-4222-8222-222222222222',event:{type:'approval_requested',
          sessionId:sessions[1].id,timestamp:'2026-10-18T09:00:00.000Z',request:{
            id:'33333333-3333-4333-8333-333333333333',sessionId:sessions[1].id,toolCallId:'call',
            toolName:'run_command',description:'检查工作区',permission:'workspace'}}})};
      window.forge={
        getSettings:async()=>({...defaultPublicSettings,isConfigured:true,theme:'light',model:'fixture/model'}),
        listSessions:async()=>window.fixture.sessions.map(({messages,events,changes,...summary})=>summary),
        getSession:async id=>{window.fixture.reads.push(id);return structuredClone(window.fixture.sessions.find(s=>s.id===id));},
        onEvent:callback=>{listener=callback;return()=>{listener=()=>{}}},
        listModels:async()=>['fixture/model'],chooseWorkspace:async()=>'/tmp/forge-navigation-project',
        getProjectContext:async()=>({instructionSources:[],skills:[],warnings:[],counts:{instructions:0,skills:0,warnings:0}}),
        listMcpServers:async()=>[],listCheckpoints:async()=>[],getDiagnostics:async()=>null
      };
      createRoot(document.getElementById('root')).render(<App/>);
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "navigation.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) =>
    file.path.endsWith(".css"),
  )?.text;
  if (!js || !css) throw new Error("Missing mounted bundle");
  const evidence = resolve(".build/navigation-home");
  await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://forge.test/**", (route) =>
      route.fulfill({
        body: '<html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
        contentType: "text/html",
      }),
    );
    await page.goto("http://forge.test");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    const tasks = page.locator(".welcome-task-title");
    await expect.poll(() => tasks.count()).toBe(4);
    expect(await tasks.allTextContents()).toEqual([
      "整理工作区的会话导航与快捷入口",
      "检查部署日志，定位连接中断后恢复失败的具体原因",
      "完善文件预览和变更对比",
      "继续实现新的命令面板",
    ]);
    const readCount = await page.evaluate(
      () => Reflect.get(window, "fixture").reads.length,
    );
    const header = page.locator(".workbench-task-header");
    const details = page.locator(".wb-details-toggle");
    for (const width of [1440, 834, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        if (width > 1000) {
          expect(
            await page.getByRole("button", { name: "设置", exact: true }).count(),
          ).toBe(1);
        }
        expect(await header.count()).toBe(1);
        expect(await page.locator(".wb-mobile-nav").count()).toBe(0);
        const headerBox = await header.boundingBox();
        expect(headerBox?.height).toBe(width <= 1000 ? 56 : 44);
        const intro = await page.locator(".wb-new-session-intro").boundingBox();
        const composer = await page.locator(".composer-fresh").boundingBox();
        if (!intro || !composer) throw new Error("Missing home bounds");
        expect(composer.y).toBeGreaterThanOrEqual(intro.y + intro.height);
        expect(composer.y + composer.height).toBeGreaterThanOrEqual(850);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          await header.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        if (width <= 1000) {
          const targets = await header
            .locator("button")
            .evaluateAll((nodes) =>
              nodes
                .filter((node) => node.getBoundingClientRect().width > 0)
                .map((node) => ({
                  width: node.getBoundingClientRect().width,
                  height: node.getBoundingClientRect().height,
                })),
            );
          expect(
            targets.every(
              (target) => target.width >= 44 && target.height >= 44,
            ),
          ).toBe(true);
        }
        await page.screenshot({
          path: `${evidence}/home-${width}-${theme}.png`,
        });
      }
    }
    expect(
      await page.evaluate(() => Reflect.get(window, "fixture").reads.length),
    ).toBe(readCount);
    await page.setViewportSize({ width: 390, height: 500 });
    await page.locator(".welcome-task").last().scrollIntoViewIfNeeded();
    expect(await page.locator("main").evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const shortComposer = await page.locator(".composer-fresh").boundingBox();
    expect(shortComposer && shortComposer.y + shortComposer.height).toBeGreaterThanOrEqual(480);
    expect((await header.boundingBox())?.y).toBe(0);
    await page.screenshot({ path: `${evidence}/home-390-short-scrolled.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("main").evaluate(el => { el.scrollTop = 0; });
    await page.locator(".welcome-task").first().click();
    await expect
      .poll(() => header.locator("h1").innerText())
      .toBe("整理工作区的会话导航与快捷入口");
    await page.locator(".message-assistant").waitFor();
    expect(
      await page.evaluate(() => Reflect.get(window, "fixture").reads.length),
    ).toBe(readCount + 1);
    expect(await page.locator(".workbench-main").isVisible()).toBe(true);
    await page.getByRole("button", { name: "收起详情", exact: true }).click();
    expect(await details.evaluate(el => el === document.activeElement)).toBe(true);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "打开会话列表" }).click();
    expect(await page.locator(".wb-session-actions").first().isVisible()).toBe(true);
    await page.getByRole("button", { name: "关闭侧边栏" }).click();
    await page.locator(".composer-textarea").fill("保留尚未发送的草稿");
    await details.click();
    expect(await page.locator(".workbench-main").isVisible()).toBe(false);
    expect(await header.isVisible()).toBe(true);
    expect(await details.getAttribute("aria-expanded")).toBe("true");
    await page.screenshot({ path: `${evidence}/details-320-dark.png` });
    await details.click();
    expect(await page.locator(".composer-textarea").inputValue()).toBe(
      "保留尚未发送的草稿",
    );
    await header.getByRole("button", { name: "命令 · Ctrl/Cmd K" }).click();
    await page.getByRole("dialog", { name: "命令与会话导航" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "打开会话列表" }).click();
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    expect(
      await page.locator(".workbench-sidebar").getAttribute("class"),
    ).not.toContain("is-open");
    await page.locator(".welcome-task").nth(1).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => header.locator("h1").innerText())
      .toContain("检查部署日志");
    await page.evaluate(() => Reflect.get(window, "fixture").approve());
    await expect
      .poll(() => details.getAttribute("aria-label"))
      .toContain("待批准 1 项");
    expect(await page.locator(".wb-header-pending").isVisible()).toBe(true);
    await details.click();
    expect(
      await page.locator(".workbench-inspector .wb-approval-row-inline").isVisible(),
    ).toBe(true);
    await page.getByRole("button", { name: "定位到消息流" }).click();
    expect(await page.locator(".workbench-main").isVisible()).toBe(true);
    expect(await page.locator(".approval-description").isVisible()).toBe(true);
    await page.screenshot({ path: `${evidence}/approval-320-dark.png` });
    await page.getByRole("button", { name: "打开会话列表" }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("region", { name: "设置工作区" }).waitFor();
    await page.getByRole("button", { name: "返回工作台" }).click();
    expect(await header.isVisible()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
