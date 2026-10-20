import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { createHarness } from "../src/core/harness";
import type { Message } from "../src/shared/schemas";
import { createWebHost } from "../src/web/server";
import { image } from "./fixtures/image";

it("sends selected and pasted images through the real Web bridge, preserves drafts and renders saved images", async () => {
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, "127.0.0.1", done));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  await new Promise<void>(done => reservation.close(() => done()));
  const directory = await mkdtemp(join(tmpdir(), "forge-web-images-"));
  const requests: (readonly Message[])[] = [];
  let hold = false;
  let release = () => {};
  const service = await createHarness({
    stateDir: join(directory, "state"),
    providerFactory: () => ({
      listModels: async () => ["vision-fixture"],
      complete: async (messages, _tools, options) => {
        requests.push(messages);
        if (hold) await new Promise<void>(done => { release = done; });
        options.onText("图片已收到");
        return { message: { role: "assistant", content: "图片已收到" } };
      },
    }),
  });
  await service.updateSettings({ settings: { baseUrl: "http://localhost:1234/v1", model: "vision-fixture" } });
  const a = await service.createSession({ workspace: directory, title: "A" });
  const b = await service.createSession({ workspace: directory, title: "B" });
  const web = await createWebHost({ trustedLan: true, service, workspace: directory, host: "127.0.0.1", port: address.port });
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {Composer} from './src/renderer/components/workbench/Composer';
      import {StoredTranscript} from './src/renderer/components/workbench/Transcript';
      import {WorkbenchProvider,useWorkbench} from './src/renderer/state/workbench-context';
      import {installWebHost} from './src/renderer/web-host';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/styles/workspace-theme.css';
      import './src/renderer/styles/settings-models.css';
      await installWebHost();
      function Harness(){const {state,selectSession}=useWorkbench();return <div className="wb-app"><section className="workbench-main"><header>
        <button onClick={()=>selectSession(${JSON.stringify(a.id)})}>打开 A</button>
        <button onClick={()=>selectSession(${JSON.stringify(b.id)})}>打开 B</button>
        <output id="selected">{state.activeSessionId}</output>
        <output id="error">{state.alertError}</output>
        </header><div className="workbench-conversation-scroll"><div className="conversation-inner">{state.activeSnapshot&&<StoredTranscript snapshot={state.activeSnapshot}/>}</div></div><Composer/></section></div>}
      createRoot(document.getElementById('root')).render(<WorkbenchProvider><Harness/></WorkbenchProvider>);
    ` },
    bundle: true, write: false, format: "esm", target: "es2022", jsx: "automatic", outfile: "images.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  if (!js) throw new Error("Missing browser bundle");
  web.server.on("request", (request, response) => {
    void web.handle(request, response, () => {
      if (request.url === "/images.js") { response.setHeader("Content-Type", "text/javascript"); response.end(js); }
      else if (request.url === "/images.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
      else {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end('<!doctype html><html lang="zh-CN" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/images.css"></head><body><div id="root"></div><script type="module" src="/images.js"></script></body></html>');
      }
    });
  });
  await new Promise<void>(done => web.server.listen(address.port, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.FORGE_BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome-stable" });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(web.origin);
    expect(await page.getByLabel("访问口令").count()).toBe(0);
    await page.getByRole("button", { name: "打开 A", exact: true }).click();
    const prompt = page.locator("textarea.composer-textarea");
    const picker = page.locator('input[type="file"]');
    const preview = page.locator(".composer-image-attachments img");
    const file = { name: image.name, mimeType: "image/png", buffer: Buffer.from(image.dataUrl.split(",")[1] ?? "", "base64") };
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "添加图片", exact: true }).click()]);
    await chooser.setFiles(file);
    await expect.poll(() => preview.count()).toBe(1);
    expect(await preview.evaluateAll(elements => elements.every(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0))).toBe(true);
    await picker.setInputFiles(Array.from({ length: 5 }, (_, index) => ({ ...file, name: `extra-${index}.png` })));
    await expect.poll(() => page.locator(".composer-status").innerText()).toMatch(/4|数量|最多/);
    expect(await preview.count()).toBe(1);
    await page.getByRole("button", { name: "打开 B", exact: true }).click();
    await expect.poll(() => preview.count()).toBe(0);
    await page.getByRole("button", { name: "打开 A", exact: true }).click();
    await expect.poll(() => preview.count()).toBe(1);
    await page.getByRole("button", { name: /删除图片/ }).click();
    await expect.poll(() => preview.count()).toBe(0);
    await picker.setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect.poll(() => page.locator(".composer-status").innerText()).toMatch(/图片|格式|支持/);
    expect(await preview.count()).toBe(0);
    await picker.setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    await expect.poll(() => page.locator(".composer-status").innerText()).toMatch(/2|过大|大小/);
    await picker.setInputFiles(file);
    await expect.poll(() => preview.count()).toBe(1);
    await page.route("**/api/rpc", async route => {
      if (route.request().postDataJSON().method === "startRun") await route.fulfill({ status: 503, body: "offline" });
      else await route.continue();
    });
    await page.getByRole("button", { name: "运行", exact: true }).click();
    await expect.poll(() => page.locator(".composer-status").innerText()).toContain("草稿已保留");
    expect(await preview.count()).toBe(1);
    expect(requests).toHaveLength(0);
    await page.unroute("**/api/rpc");
    await page.getByRole("button", { name: "运行", exact: true }).click();
    await expect.poll(() => preview.count()).toBe(0);
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]?.filter(message => message.role === "user")).toEqual([{ role: "user", content: "", images: [image] }]);
    await expect.poll(() => page.locator(".message-user img").count()).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "打开 A", exact: true }).click();
    await expect.poll(() => page.locator(".message-user img").count()).toBe(1);
    await page.getByRole("button", { name: /查看.*pixel.png/ }).click();
    expect(await page.getByRole("dialog").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("dialog").isVisible()).toBe(false);
    await prompt.evaluate((element, dataUrl) => {
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1] ?? ""), char => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, image.dataUrl);
    await expect.poll(() => preview.count()).toBe(1);
    hold = true;
    await prompt.fill("排队前一轮");
    await prompt.press("Enter");
    await expect.poll(() => requests.length).toBe(2);
    await expect.poll(() => preview.count()).toBe(0);
    await picker.setInputFiles(file);
    await expect.poll(() => preview.count()).toBe(1);
    await prompt.fill("图片跟进");
    await prompt.press("Enter");
    await expect.poll(() => preview.count()).toBe(0);
    expect(requests).toHaveLength(2);
    hold = false; release();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2]?.filter(message => message.role === "user").at(-1)).toEqual({ role: "user", content: "图片跟进", images: [image] });
    await expect.poll(() => page.getByRole("button", { name: "运行", exact: true }).isVisible()).toBe(true);
    hold = true;
    await prompt.fill("插话前一轮"); await prompt.press("Enter");
    await expect.poll(() => requests.length).toBe(4);
    await picker.setInputFiles(file);
    await expect.poll(() => preview.count()).toBe(1);
    await prompt.press("Alt+Enter");
    expect(await preview.count()).toBe(1);
    hold = false; release();
    await expect.poll(() => requests.length).toBe(5);
    await expect.poll(() => preview.count()).toBe(0);
    expect(requests[4]?.filter(message => message.role === "user").at(-1)).toEqual({ role: "user", content: "", images: [image] });
    await expect.poll(() => page.getByRole("button", { name: "运行", exact: true }).isVisible()).toBe(true);
    hold = true;
    await prompt.fill("存储测试前一轮"); await prompt.press("Enter");
    await expect.poll(() => requests.length).toBe(6);
    await picker.setInputFiles(file);
    await expect.poll(() => preview.count()).toBe(1);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Reflect.set(window, "restoreQueueStorage", () => { Storage.prototype.setItem = original; });
      Storage.prototype.setItem = function(key, value) {
        if (key === "forge-pending-inputs") throw new DOMException("Full", "QuotaExceededError");
        original.call(this, key, value);
      };
    });
    await prompt.press("Enter");
    await expect.poll(() => page.locator("#error").innerText()).toContain("存储空间不足");
    expect(await preview.count()).toBe(1);
    expect(requests).toHaveLength(6);
    await page.evaluate(() => { const restore = Reflect.get(window, "restoreQueueStorage"); if (typeof restore === "function") restore(); });
    await prompt.fill("/model"); await prompt.press("Enter");
    await expect.poll(() => page.locator(".composer-error").innerText()).toContain("图片请直接发送");
    expect(await preview.count()).toBe(1);
    await page.getByRole("button", { name: /删除图片/ }).click();
    await prompt.fill("");
    hold = false; release();
    await expect.poll(() => page.getByRole("button", { name: "运行", exact: true }).isVisible()).toBe(true);
    await prompt.fill("继续"); await prompt.press("Enter");
    await expect.poll(() => requests.length).toBe(7);
    await expect.poll(() => page.getByRole("button", { name: "运行", exact: true }).isVisible()).toBe(true);
    await mkdir(resolve(".build/image-input"), { recursive: true });
    const visualData = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 200;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing canvas context");
      context.fillStyle = "#55684d"; context.fillRect(0, 0, 320, 200);
      context.fillStyle = "#eaf0e6"; context.font = "32px sans-serif"; context.fillText("IMAGE INPUT", 40, 110);
      return canvas.toDataURL("image/png");
    });
    const visualFile = { name: "图片输入示例.png", mimeType: "image/png", buffer: Buffer.from(visualData.split(",")[1] ?? "", "base64") };
    for (const width of [320, 390, 768, 1440]) for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
      await picker.setInputFiles(visualFile);
      await expect.poll(() => preview.count()).toBe(1);
      const inputBox = await prompt.boundingBox();
      const sendBox = await page.locator(".composer-submit-col .btn").boundingBox();
      const removeBox = await page.getByRole("button", { name: /删除图片/ }).boundingBox();
      if (!inputBox || !sendBox || !removeBox) throw new Error("Missing composer geometry");
      expect(sendBox.width).toBe(44); expect(sendBox.height).toBe(44);
      expect(removeBox.width).toBe(44); expect(removeBox.height).toBe(44);
      expect(sendBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".workbench-composer").screenshot({ path: resolve(`.build/image-input/${width}-${theme}.png`), animations: "disabled" });
      await page.getByRole("button", { name: /删除图片/ }).click();
    }
    expect(errors).toEqual([]);
  } finally {
    hold = false; release();
    await browser.close();
    await web.dispose();
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
