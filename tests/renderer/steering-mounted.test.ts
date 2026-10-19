import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("uses pinned sources, retains unacknowledged drafts and runs only confirmed session queues", async () => {
  const bundle = await build({ stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import {createRoot} from 'react-dom/client';
    import {Composer} from './src/renderer/components/workbench/Composer';
    import {WorkbenchProvider,useWorkbench} from './src/renderer/state/workbench-context';
    import {defaultPublicSettings} from './src/shared/schemas';
    import './src/renderer/styles/global.css';
    import './src/renderer/components/workbench/app.css';
    import './src/renderer/styles/workspace-theme.css';
    import './src/renderer/styles/settings-models.css';
    const a='11111111-1111-4111-8111-111111111111';
    const b='22222222-2222-4222-8222-222222222222';
    const snapshots=Object.fromEntries([a,b].map(id=>[id,{version:1,id,title:id===a?'A':'B',workspace:'/tmp',model:'a-model',providerSourceId:'a',
      status:'idle',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',messages:[],events:[],changes:[]}]));
    const listeners=new Set(); const live=new Map(); const pending=new Map(); let counter=0;
    const emit=(runId,event)=>{for(const listener of listeners)listener({runId,event:{timestamp:new Date().toISOString(),...event}});};
    const fixture=window.fixture={starts:[],catalogues:[],pending:()=>pending.size,
      apply:()=>{for(const [id,item] of pending){snapshots[item.sessionId].messages.push({role:'user',content:item.prompt});item.resolve();pending.delete(id);}},
      finish:(sessionId,status)=>{const runId=live.get(sessionId);live.delete(sessionId);snapshots[sessionId].status=status;
        for(const [id,item]of pending)if(item.sessionId===sessionId){item.reject(Error('未写入，草稿已保留'));pending.delete(id);}
        emit(runId,{type:'run_finished',sessionId,status,turns:1,toolCalls:0});}};
    window.forge={getSettings:async()=>({...defaultPublicSettings,isConfigured:true,baseUrl:'https://b.invalid/v1',model:'b-model',activeSourceId:'b',
      providerSources:[{id:'a',label:'Source A',baseUrl:'https://a.invalid/v1',model:'a-model',hasApiKey:false},{id:'b',label:'Source B',baseUrl:'https://b.invalid/v1',model:'b-model',hasApiKey:false}]}),
      listSessions:async()=>Object.values(snapshots),getSession:async id=>structuredClone(snapshots[id]),
      listModels:async source=>{fixture.catalogues.push(source);return [source+'-model', 'shared-model'];},
      onEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
      startRun:async input=>{fixture.starts.push(input);const runId='33333333-3333-4333-8333-'+String(++counter).padStart(12,'0');
        const snapshot=snapshots[input.sessionId];snapshot.messages.push({role:'user',content:input.prompt});snapshot.status='running';
        if(input.providerSourceId)snapshot.providerSourceId=input.providerSourceId;if(input.model)snapshot.model=input.model;
        live.set(input.sessionId,runId);setTimeout(()=>emit(runId,{type:'run_started',sessionId:input.sessionId,model:snapshot.model,permission:input.permission??'workspace'}),0);
        return {runId,sessionId:input.sessionId};},
      steerRun:(runId,prompt)=>new Promise((resolve,reject)=>{const sessionId=[...live].find(([,id])=>id===runId)?.[0];
        if(!sessionId){reject(Error('stale run'));return;}pending.set(runId,{sessionId,prompt,resolve,reject});}),
      cancelRun:async runId=>{const sessionId=[...live].find(([,id])=>id===runId)?.[0];if(sessionId)fixture.finish(sessionId,'cancelled');},
      chooseWorkspace:async()=>null,setRunPermission:async(_id,permission)=>permission};
    function Harness(){const {selectSession,state}=useWorkbench();return <>
      <button onClick={()=>selectSession(a)}>打开 A</button><button onClick={()=>selectSession(b)}>打开 B</button>
      <output id="selected">{state.activeSessionId}</output><div className="wb-app"><Composer/></div></>}
    createRoot(document.getElementById('root')).render(<WorkbenchProvider><Harness/></WorkbenchProvider>);
  ` }, bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "steering.js", loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' } });
  const browser = await chromium.launch({ headless: true, ...(process.env.FORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, isMobile: true });
    page.setDefaultTimeout(3000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://forge.test/**", route => route.fulfill({ body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>', contentType: "text/html" }));
    await page.goto("http://forge.test");
    const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
    if (!js) throw new Error("Missing mounted bundle");
    const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
    await page.addStyleTag({ content: css });
    await page.addStyleTag({ content: ".wb-app{height:auto!important;padding-top:400px}body,#root{overflow:auto!important}" });
    await page.addScriptTag({ content: js });
    await page.getByRole("button", { name: "打开 A", exact: true }).click();
    const input = page.locator("textarea.composer-textarea");
    expect(await page.getByRole("button", { name: "思考等级", exact: true }).count()).toBe(0);
    const modelSummary = page.locator(".composer-model-summary");
    await modelSummary.click();
    const effortSlider = page.getByRole("slider", { name: "思考等级", exact: true });
    await effortSlider.waitFor();
    expect(await effortSlider.isVisible()).toBe(true);
    expect(await page.locator('.composer-model-source-area').count()).toBe(0);
    expect(await page.getByRole('group', { name: 'Source A', exact: true }).getByRole('button', { pressed: true }).innerText()).toContain('a-model');
    expect(await page.getByRole('group', { name: 'Source B', exact: true }).getByRole('button', { pressed: true }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "fixture").catalogues.includes("a"))).toBe(true);
    await input.fill("initial"); await input.press("Enter");
    await expect.poll(() => input.inputValue()).toBe("");
    expect(await page.locator(".composer-cancel").count()).toBe(1);
    expect(await page.locator(".composer-submit").count()).toBe(0);
    expect(await page.locator(".composer-live-hints").count()).toBe(0);
    expect(await page.locator(".composer-queue").count()).toBe(0);
    expect(await input.getAttribute("title")).toBe("Enter 排队，Alt+Enter 插话");
    await input.fill("/queue"); await input.press("Enter");
    await expect.poll(() => input.inputValue()).toBe("");
    expect(await page.locator(".composer-slash-message").count()).toBe(0);
    expect(await page.locator(".composer-queue").count()).toBe(0);
    await input.fill("change direction\nsecond line");
    expect(await page.locator(".composer-cancel").count()).toBe(1);
    expect(await page.locator(".composer-submit").count()).toBe(1);
    expect(await page.locator(".composer-submit-col.is-dual").count()).toBe(1);
    const cancelAnim = await page.evaluate(() => {
      const el = document.querySelector(".composer-cancel");
      return el ? window.getComputedStyle(el).animationName : "";
    });
    expect(cancelAnim).toContain("composer-cancel-shift-left");
    const sendAnim = await page.evaluate(() => {
      const el = document.querySelector(".composer-dual-send-wrap");
      return el ? window.getComputedStyle(el).animationName : "";
    });
    expect(sendAnim).toContain("composer-dual-send-in");
    const steerBtn = page.locator(".composer-btn-steer-hold");
    await steerBtn.dispatchEvent("pointerdown", { button: 0 });
    await expect.poll(() => page.locator(".composer-longpress-tip").innerText()).toContain("松开立即插话");
    await steerBtn.dispatchEvent("pointerup");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "fixture").pending())).toBe(1);
    expect(await input.inputValue()).toBe("change direction\nsecond line");
    const inputRect1 = await input.boundingBox();
    const actRect = await page.locator(".composer-activity").boundingBox();
    if (!inputRect1 || !actRect) throw new Error("Missing rects for live status check");
    expect(await page.locator(".composer-live-actions").count()).toBe(0);
    expect(await page.getByRole("button", { name: "运行中消息", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "发送插话", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "加入待发队列", exact: true }).count()).toBe(0);
    expect(actRect.y + actRect.height).toBeLessThanOrEqual(inputRect1.y);
    await page.evaluate(() => Reflect.get(window, "fixture").apply());
    await expect.poll(() => input.inputValue()).toBe("");
    await expect.poll(() => page.locator(".composer-submit-col.is-dual").count()).toBe(0);
    const reboundAnim = await page.evaluate(() => {
      const col = document.querySelector(".composer-submit-col");
      const btn = document.querySelector(".composer-cancel");
      return {
        colClass: col?.className ?? "",
        btnAnim: btn ? window.getComputedStyle(btn).animationName : "",
      };
    });
    expect(reboundAnim.colClass).toContain("is-rebounding");
    expect(reboundAnim.btnAnim).toContain("composer-cancel-shift-right");
    await input.fill("follow one");
    await page.locator(".composer-btn-steer-hold").click();
    await expect.poll(() => input.inputValue()).toBe("");
    expect(await page.locator(".composer-queue").innerText()).toBe("待发 1 条：follow one");
    expect(await page.locator(".composer-queue-hint").count()).toBe(0);
    expect(await page.locator(".composer-slash-message").count()).toBe(0);
    await input.fill("follow two\nsecond line"); await input.press("Control+Enter");
    await expect.poll(() => input.inputValue()).toBe("");
    await page.evaluate(() => Reflect.get(window, "fixture").finish('11111111-1111-4111-8111-111111111111', 'cancelled'));
    await expect.poll(() => page.locator(".composer-status").innerText()).toContain("已暂停");
    const inputRect2 = await input.boundingBox();
    const queueStatusRect = await page.locator(".composer-status").boundingBox();
    if (!inputRect2 || !queueStatusRect) throw new Error("Missing rects for queue status check");
    expect(queueStatusRect.y + queueStatusRect.height).toBeLessThanOrEqual(inputRect2.y);
    expect(await page.evaluate(() => Reflect.get(window, "fixture").starts.length)).toBe(1);
    await input.fill("/queue run"); await input.press("Enter");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "fixture").starts.length)).toBe(2);
    await expect.poll(() => page.locator(".composer-status").innerText()).toContain("待发 1 条");
    await page.getByRole("button", { name: "打开 B", exact: true }).click();
    expect(await page.getByRole("button", { name: "清空队列", exact: true }).count()).toBe(0);
    await page.evaluate(() => Reflect.get(window, "fixture").finish('11111111-1111-4111-8111-111111111111', 'completed'));
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "fixture").starts.length)).toBe(3);
    expect(await page.locator("#selected").innerText()).toBe("22222222-2222-4222-8222-222222222222");
    expect(await page.evaluate(() => Reflect.get(window, "fixture").starts.map((item: { prompt: string }) => item.prompt))).toEqual(["initial", "follow one", "follow two\nsecond line"]);
    expect(await page.evaluate(() => Reflect.get(window, "fixture").starts[2].providerSourceId)).toBe("a");
    await page.getByRole("button", { name: "打开 A", exact: true }).click();
    await input.fill("retain on cancellation"); await input.press("Alt+Enter");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "fixture").pending())).toBe(1);
    await page.evaluate(() => Reflect.get(window, "fixture").finish('11111111-1111-4111-8111-111111111111', 'cancelled'));
    await expect.poll(() => page.getByRole("alert").last().innerText()).toContain("草稿已保留");
    const inputRect3 = await input.boundingBox();
    const alertRect = await page.getByRole("alert").last().boundingBox();
    if (!inputRect3 || !alertRect) throw new Error("Missing rects for alert check");
    expect(alertRect.y + alertRect.height).toBeLessThanOrEqual(inputRect3.y);
    expect(await input.inputValue()).toBe("retain on cancellation");
    await modelSummary.click();
    await page.getByRole('group', { name: 'Source B', exact: true }).getByRole('button', { name: 'shared-model shared-model', exact: true }).click();
    await modelSummary.click();
    expect(await page.getByRole('group', { name: 'Source B', exact: true }).getByRole('button', { pressed: true }).innerText()).toContain('shared-model');
    expect(await page.getByRole('group', { name: 'Source A', exact: true }).getByRole('button', { pressed: true }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await input.fill("explicit source change"); await page.getByRole("button", { name: "运行", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "fixture").starts.at(-1).providerSourceId)).toBe("b");
    await input.fill("/queue add keep across reload\nsecond line"); await input.press("Enter");
    await expect.poll(() => input.inputValue()).toBe("");
    await mkdir(resolve(".build/design-fixes-ui"), { recursive: true });
    for (const width of [320, 360, 390, 430, 1440]) for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.screenshot({ path: resolve(`.build/design-fixes-ui/steering-${width}-${theme}.png`), animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const promptBox = await page.locator(".composer-prompt").boundingBox();
      const actionBox = await page.locator(".composer-action").boundingBox();
      const toolbarBox = await page.locator(".composer-toolbar").boundingBox();
      if (!promptBox || !actionBox || !toolbarBox) throw new Error("Missing composer layout");
      expect(actionBox.x).toBeGreaterThanOrEqual(promptBox.x + promptBox.width);
      expect(actionBox.y).toBeLessThan(promptBox.y + promptBox.height);
      expect(actionBox.y + actionBox.height).toBeGreaterThan(promptBox.y);
      expect(actionBox.width).toBeGreaterThanOrEqual(44);
      expect(actionBox.height).toBeGreaterThanOrEqual(44);
      expect(toolbarBox.height).toBeLessThanOrEqual(48);
      expect(Math.abs(promptBox.height - actionBox.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(promptBox.y - actionBox.y)).toBeLessThanOrEqual(1);
      const iconSizes = await page.locator(
        '.composer-action svg, .composer-toolbar-start button svg, .composer-model-summary > svg',
      ).evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }));
      expect(iconSizes.length).toBe(6);
      const imageTriggerBox = await page.getByRole("button", { name: "添加图片", exact: true }).boundingBox();
      expect(imageTriggerBox?.width).toBe(44);
      expect(imageTriggerBox?.height).toBe(44);
      for (const icon of iconSizes) {
        expect(icon.width).toBeGreaterThanOrEqual(16);
        expect(icon).toEqual(iconSizes[0]);
      }
      const modelFont = await modelSummary.evaluate(node => getComputedStyle(node).fontSize);
      expect(modelFont).toBe(await input.evaluate(node => getComputedStyle(node).fontSize));
      const modelAlignment = await modelSummary.evaluate(node => {
        const edge = node.closest(".composer-toolbar-end")?.getBoundingClientRect().right;
        const caret = node.querySelector("svg:last-child")?.getBoundingClientRect().right;
        const style = getComputedStyle(node);
        return { edge, caret, inset: Number.parseFloat(style.paddingRight) + Number.parseFloat(style.borderRightWidth) };
      });
      if (modelAlignment.edge === undefined || modelAlignment.caret === undefined) throw new Error("Missing model alignment anchors");
      expect(Math.abs(modelAlignment.edge - modelAlignment.caret - modelAlignment.inset)).toBeLessThanOrEqual(1);
      for (const name of ["运行模式", "执行权限"]) {
        const box = await page.getByRole("button", { name, exact: true }).boundingBox();
        if (!box) throw new Error(`Missing ${name}`);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(Math.abs(box.height - toolbarBox.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.y - toolbarBox.y)).toBeLessThanOrEqual(1);
      }
      expect(await page.locator(".composer-queue-actions").count()).toBe(0);
      expect(await page.locator('.composer-toolbar [aria-label="会话模型来源"]').count()).toBe(0);
    }
    await modelSummary.click();
    await page.locator(".composer-model-panel").waitFor();
    for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.screenshot({ path: resolve(`.build/design-fixes-ui/steering-model-panel-${width}-${theme}.png`), animations: "disabled" });
    }
    await page.keyboard.press("Escape");
    await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
    await page.getByRole("button", { name: "打开 A", exact: true }).click();
    await expect.poll(() => page.locator(".composer-status").innerText()).toContain("已暂停");
    expect(await page.evaluate(() => Reflect.get(window, "fixture").starts.length)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
