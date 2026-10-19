import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { createHarness } from "../src/core/harness";
import { createWebHost } from "../src/web/server";

it("selects a workspace by browsing server folders, preserves cancellation and uses the native picker on desktop", async () => {
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, "127.0.0.1", done));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  await new Promise<void>(done => reservation.close(() => done()));
  const directory = await mkdtemp(join(tmpdir(), "forge-workspace-picker-"));
  const project = join(directory, "中文 project");
  await mkdir(join(project, "src"), { recursive: true });
  const service = await createHarness({
    stateDir: join(directory, "state"),
    providerFactory: () => ({
      listModels: async () => ["test-model"],
      complete: async () => ({ message: { role: "assistant", content: "done" } }),
    }),
  });
  await service.updateSettings({ settings: { baseUrl: "http://localhost:1234/v1", model: "test-model" } });
  const web = await createWebHost({ service, workspace: directory, host: "127.0.0.1", port: address.port, restrictWorkspace: false });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const bundle = await build({
      stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
        import {createRoot} from 'react-dom/client';
        import {useState} from 'react';
        import {Composer} from './src/renderer/components/workbench/Composer';
        import {WorkspacePicker} from './src/renderer/components/workbench/WorkspacePicker';
        import {WorkbenchProvider,useWorkbench} from './src/renderer/state/workbench-context';
        import {installWebHost,hostCapabilities} from './src/renderer/web-host';
        import './src/renderer/styles/global.css';
        import './src/renderer/components/workbench/app.css';
        import './src/renderer/components/workbench/new-session.css';
        await installWebHost();
        function Harness(){const {state}=useWorkbench();return <div className="wb-app"><output id="selected">{state.activeSnapshot?.workspace}</output><Composer isNew/></div>}
        function Native(){const [path,setPath]=useState('/old');return <div className="wb-app"><output id="selected">{path}</output><WorkspacePicker workspace={path} onChange={setPath} onDone={()=>{}} chooseWorkspace={async()=>{window.nativeCalls=(window.nativeCalls||0)+1;return new URLSearchParams(location.search).has('cancel')?null:'/native project'}}/></div>}
        if(location.pathname==='/native'){hostCapabilities.web=false;createRoot(document.getElementById('root')).render(<Native/>)}
        else createRoot(document.getElementById('root')).render(<WorkbenchProvider><Harness/></WorkbenchProvider>);
      ` },
      bundle: true, write: false, format: "esm", target: "es2022", jsx: "automatic", outfile: "picker.js",
      loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
    });
    const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
    const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
    if (!js) throw new Error("Missing browser bundle");
    web.server.on("request", (request, response) => {
      void web.handle(request, response, () => {
        if (request.url === "/picker.js") { response.setHeader("Content-Type", "text/javascript"); response.end(js); }
        else if (request.url === "/picker.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
        else {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end('<!doctype html><html lang="zh-CN" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/picker.css"></head><body><div id="root"></div><script type="module" src="/picker.js"></script></body></html>');
        }
      });
    });
    await new Promise<void>(done => web.server.listen(address.port, "127.0.0.1", done));
    browser = await chromium.launch({ headless: true, executablePath: process.env.FORGE_BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome-stable" });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(web.origin);
    const trigger = page.getByRole("button", { name: "选择工作区", exact: true });
    await expect.poll(() => trigger.getAttribute("title")).toBe(directory);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "选择服务器工作区" });
    await page.getByRole("button", { name: "中文 project", exact: true }).click();
    await expect.poll(() => page.getByLabel("当前浏览目录").innerText()).toBe(project);
    await page.getByRole("button", { name: "上一级", exact: true }).click();
    await expect.poll(() => page.getByLabel("当前浏览目录").innerText()).toBe(directory);
    await page.getByRole("button", { name: "中文 project", exact: true }).click();
    await expect.poll(() => page.getByLabel("当前浏览目录").innerText()).toBe(project);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(await trigger.getAttribute("title")).toBe(directory);
    await trigger.click();
    await expect.poll(() => page.getByRole("button", { name: "中文 project", exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "中文 project", exact: true }).click();
    await expect.poll(() => page.getByLabel("当前浏览目录").innerText()).toBe(project);
    await page.getByRole("button", { name: "选择此目录", exact: true }).click();
    await expect.poll(() => trigger.getAttribute("title")).toBe(project);
    await trigger.click();
    await expect.poll(() => page.getByLabel("当前浏览目录").innerText()).toBe(project);
    const bounds = await dialog.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844).toBe(true);
    await page.getByRole("button", { name: "选择此目录", exact: true }).focus();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });
    const desktopBounds = await dialog.boundingBox();
    expect(desktopBounds && desktopBounds.x >= 0 && desktopBounds.x + desktopBounds.width <= 1280 && desktopBounds.y >= 0 && desktopBounds.y + desktopBounds.height <= 800).toBe(true);
    await page.keyboard.press("Escape");
    expect(await dialog.count()).toBe(0);
    expect(await trigger.evaluate(element => document.activeElement === element)).toBe(true);

    // A failed directory read must not silently change the selected workspace.
    await page.route("**/api/workspaces/browse", route => route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"denied"}' }));
    await trigger.click();
    await expect.poll(() => dialog.getByRole("alert").count()).toBe(1);
    expect(await page.getByRole("button", { name: "选择此目录", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(await trigger.getAttribute("title")).toBe(project);
    await page.unroute("**/api/workspaces/browse");
    await page.locator("textarea.composer-textarea").fill("test selected workspace");
    await page.getByRole("button", { name: "发送并开始会话", exact: true }).click();
    await expect.poll(() => page.locator("#selected").innerText()).toBe(project);
    expect((await service.listSessions())[0]?.workspace).toBe(project);

    await page.goto(`${web.origin}/native`);
    await trigger.click();
    await expect.poll(() => page.locator("#selected").innerText()).toBe("/native project");
    expect(await dialog.count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { nativeCalls: number }).nativeCalls)).toBe(1);
    await page.goto(`${web.origin}/native?cancel`);
    await trigger.click();
    expect(await page.locator("#selected").innerText()).toBe("/old");
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await web.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
