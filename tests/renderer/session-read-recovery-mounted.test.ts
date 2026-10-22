import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
let browser: Browser;
let page: Page;
let js = "";
let css = "";
let errors: string[];

beforeAll(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."), loader: "tsx",
      contents: `
        import {StrictMode} from 'react';
        import {createRoot} from 'react-dom/client';
        import {WorkbenchProvider,useWorkbench} from './src/renderer/state/workbench-context';
        import {createTransportBridge} from './src/shared/bridge';
        import {defaultPublicSettings} from './src/shared/schemas';
        import {paginateSession} from './src/shared/session-page';
        import {ErrorState} from './src/renderer/components/primitives/ErrorState';
        import {Button} from './src/renderer/components/primitives/Button';
        import './src/renderer/styles/global.css';
        const first='${first}', second='${second}';
        const snapshots=[first,second].map((id,index)=>({version:1,id,title:index?'Session B':'Session A',
          workspace:'/tmp/forge-read-fixture',model:'fixture',status:'idle',
          createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:01.000Z',
          messages:[{role:'user',content:'persisted transcript'}],events:[],changes:[]}));
        let receive=()=>{};
        const fixture=window.fixture={snapshots,scenarios:{},reads:[],writes:[],alerts:[],emit:event=>receive(event)};
        window.forge=createTransportBridge({
          onEvent:callback=>{receive=callback;},
          request:async input=>{
            const ok=result=>({id:input.id,method:input.method,ok:true,result});
            const fail=(code,message,retryable)=>({id:input.id,method:input.method,ok:false,error:{code,message,retryable}});
            if(input.method==='getSettings') return ok({...defaultPublicSettings,isConfigured:true,baseUrl:'https://example.invalid',theme:'light',model:'fixture'});
            if(input.method==='listSessions') return ok(snapshots.map(({messages,events,changes,...s})=>s));
            if(input.method==='getSession'||input.method==='getSessionPage'){
              fixture.reads.push(input.sessionId);
              const script=fixture.scenarios[input.sessionId]??[];
              const mode=script.length>1?script.shift():script[0];
              if(mode==='conflict') return fail('storage','Session changed while being read. Try again.',true);
              if(mode==='corrupt') return fail('storage','Stored data could not be safely accessed.',false);
              if(mode==='not_found') return fail('not_found','Stored record was not found.',true);
              if(mode==='network') throw new Error('Network failure');
              const snapshot=structuredClone(snapshots.find(s=>s.id===input.sessionId));
              if(mode==='hold') await new Promise(resolve=>{fixture.release=resolve;});
              return ok(input.method==='getSessionPage'?paginateSession(snapshot,input.page):snapshot);
            }
            fixture.writes.push(input.method);
            return fail('storage','Write failed; inspect before retrying.',true);
          }
        });
        function Harness(){
          const c=useWorkbench(); window.controller=c;
          return <main>
            <Button onClick={()=>c.selectSession(first)}>选择 A</Button>
            <Button onClick={()=>c.selectSession(second)}>选择 B</Button>
            <Button onClick={()=>c.refreshActiveSession()}>再次读取</Button>
            <Button onClick={()=>c.startRun('execute once')}>开始任务</Button>
            <div data-testid="title">{c.state.activeSnapshot?.title??'not loaded'}</div>
            <div data-testid="transcript">{c.state.activeSnapshot?.messages[0]?.content??''}</div>
            <div data-testid="loading">{String(c.state.isSnapshotLoading)}</div>
            {c.state.alertError&&<ErrorState title="操作未完成" error={c.state.alertError}
              actions={<Button onClick={()=>{c.clearAlert();void c.refreshActiveSession();}}>刷新 / 重试</Button>}/>}
          </main>;
        }
        new MutationObserver(()=>{
          const text=document.querySelector('[role="alert"]')?.textContent;
          if(text)fixture.alerts.push(text);
        }).observe(document.getElementById('root'),{childList:true,subtree:true});
        const root=createRoot(document.getElementById('root'));
        fixture.unmount=()=>root.unmount();
        root.render(<StrictMode><WorkbenchProvider><Harness/></WorkbenchProvider></StrictMode>);
      `,
    },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "session-recovery.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
  });
  js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  browser = await chromium.launch({ headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE } : {}) });
}, 30000);

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.setDefaultTimeout(5000);
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://forge.test/**", route => route.fulfill({
    body: '<html lang="zh-CN"><body><div id="root"></div></body></html>', contentType: "text/html",
  }));
  await page.goto("http://forge.test");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() => Reflect.get(window, "controller")?.state.settings?.isConfigured);
});
afterEach(async () => {
  try { expect(errors).toEqual([]); }
  finally { await page?.close(); }
});
afterAll(async () => { await browser?.close(); });

async function script(id: string, modes: string[]) {
  await page.evaluate(({ id, modes }) => { Reflect.get(window, "fixture").scenarios[id] = modes; }, { id, modes });
}
async function readCount() {
  return page.evaluate(() => Reflect.get(window, "fixture").reads.length);
}
async function title(value: string) {
  await expect.poll(() => page.getByTestId("title").innerText()).toBe(value);
}

it("recovers transient read conflicts without ever showing a global error or replaying effects", async () => {
  await script(first, ["conflict", "conflict", "ok"]);
  await page.getByRole("button", { name: "选择 A" }).click();
  await title("Session A");
  expect(await readCount()).toBe(3);
  expect(await page.getByTestId("transcript").innerText()).toBe("persisted transcript");
  expect(await page.getByRole("alert").count()).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, "fixture").alerts)).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, "fixture").writes)).toEqual([]);
});

it("bounds persistent conflicts, keeps the transcript and automatically clears only its recovered read error", async () => {
  await page.getByRole("button", { name: "选择 A" }).click();
  await title("Session A");
  await script(first, ["conflict"]);
  await page.getByRole("button", { name: "再次读取" }).click();
  await page.getByRole("alert").waitFor();
  expect(await readCount()).toBe(4);
  expect(await page.getByTestId("loading").innerText()).toBe("false");
  expect(await page.getByTestId("transcript").innerText()).toBe("persisted transcript");
  await page.waitForTimeout(500);
  expect(await readCount()).toBe(4);
  const evidence = resolve(".build/session-read-recovery");
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/bounded-conflict.png` });
  await script(first, ["ok"]);
  // Unlike the manual dismiss action, this does not clear the alert first.
  await page.getByRole("button", { name: "再次读取" }).click();
  await expect.poll(() => page.getByRole("alert").count()).toBe(0);
  expect(await readCount()).toBe(5);
  await page.screenshot({ path: `${evidence}/recovered.png` });
});

it.each(["corrupt", "not_found", "network"])("does not retry or hide a %s failure", async mode => {
  await script(first, [mode]);
  await page.getByRole("button", { name: "选择 A" }).click();
  await page.getByRole("alert").waitFor();
  expect(await page.getByTestId("loading").innerText()).toBe("false");
  await page.waitForTimeout(500);
  expect(await readCount()).toBe(1);
  expect(await page.getByRole("alert").isVisible()).toBe(true);
});

it("does not retry a failed startRun or dismiss its error when the automatic read succeeds", async () => {
  await page.getByRole("button", { name: "选择 A" }).click();
  await title("Session A");
  await page.getByRole("button", { name: "开始任务" }).click();
  await expect.poll(readCount).toBe(2);
  expect(await page.getByRole("alert").innerText()).toContain("Write failed; inspect before retrying.");
  await page.getByRole("button", { name: "再次读取" }).click();
  await expect.poll(readCount).toBe(3);
  expect(await page.getByRole("alert").isVisible()).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, "fixture").writes)).toEqual(["startRun"]);
});

it("does not clear another session's read error and clears it when that session recovers", async () => {
  await script(first, ["corrupt"]);
  await page.getByRole("button", { name: "选择 A" }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "选择 B" }).click();
  await title("Session B");
  expect(await page.getByRole("alert").isVisible()).toBe(true);
  await script(first, ["ok"]);
  await page.getByRole("button", { name: "选择 A" }).click();
  await title("Session A");
  expect(await page.getByRole("alert").count()).toBe(0);
});

it("coalesces pending refreshes and still reads the newest snapshot after an invalidation", async () => {
  await script(first, ["hold", "ok"]);
  await page.getByRole("button", { name: "选择 A" }).click();
  await page.waitForFunction(() => Reflect.get(window, "fixture").release);
  await page.getByRole("button", { name: "再次读取" }).click();
  await page.getByRole("button", { name: "再次读取" }).click();
  expect(await readCount()).toBe(1);
  await page.evaluate(() => {
    const fixture = Reflect.get(window, "fixture");
    fixture.snapshots[0].title = "Newest snapshot";
    fixture.snapshots[0].updatedAt = "2026-10-01T00:00:02.000Z";
    fixture.release();
  });
  await title("Newest snapshot");
  expect(await readCount()).toBe(2);
  expect(await page.getByRole("alert").count()).toBe(0);
});

it("cancels pending retry timers when the workbench unmounts", async () => {
  await script(first, ["conflict"]);
  await page.getByRole("button", { name: "选择 A" }).click();
  await expect.poll(readCount).toBe(1);
  await page.evaluate(() => Reflect.get(window, "fixture").unmount());
  await page.waitForTimeout(500);
  expect(await readCount()).toBe(1);
  expect(await page.getByRole("alert").count()).toBe(0);
});

it("loads only a tail page, coalesces history requests and ignores stale history after A-B-A navigation", async () => {
  await page.evaluate(() => {
    Reflect.get(window, "fixture").snapshots[0].messages = [1, 2, 3].flatMap(turn => [
      { role: "user", content: `question-${turn}` }, { role: "assistant", content: `answer-${turn}` },
    ]);
  });
  await page.getByRole("button", { name: "选择 A" }).click();
  await title("Session A");
  const windowState = () => page.evaluate(() => {
    const state = Reflect.get(window, "controller").state;
    return { offset: state.activeSnapshot?.transcript?.messageOffset, count: state.activeSnapshot?.messages.length,
      loading: state.isHistoryLoading, error: state.historyError };
  });
  expect(await windowState()).toEqual({ offset: 4, count: 2, loading: false, error: null });
  await script(first, ["hold", "ok"]);
  await page.evaluate(() => {
    const controller = Reflect.get(window, "controller");
    void controller.loadOlderMessages();
    void controller.loadOlderMessages();
  });
  await page.waitForFunction(() => Reflect.get(window, "fixture").release);
  expect(await readCount()).toBe(2);
  await page.getByRole("button", { name: "选择 B" }).click();
  await title("Session B");
  await page.getByRole("button", { name: "选择 A" }).click();
  await title("Session A");
  await page.evaluate(() => Reflect.get(window, "fixture").release());
  await page.waitForTimeout(100);
  expect(await windowState()).toEqual({ offset: 4, count: 2, loading: false, error: null });
  await page.evaluate(() => Reflect.get(window, "controller").loadOlderMessages());
  await expect.poll(async () => (await windowState()).offset).toBe(2);
  expect((await windowState()).count).toBe(4);
  await page.getByRole("button", { name: "再次读取" }).click();
  await expect.poll(readCount).toBe(6);
  expect(await windowState()).toEqual({ offset: 2, count: 4, loading: false, error: null });
});

async function selectExternalSession(status = "running") {
  await page.clock.install();
  await page.evaluate(status => { Reflect.get(window, "fixture").snapshots[0].status = status; }, status);
  await page.getByRole("button", { name: "选择 A" }).click();
  await title("Session A");
}

it.each(["running", "awaiting_approval"])("syncs an external %s session until completion without replaying effects", async status => {
  await selectExternalSession(status);
  await page.evaluate(() => {
    const snapshot = Reflect.get(window, "fixture").snapshots[0];
    snapshot.title = "CLI advanced";
    snapshot.updatedAt = "2026-10-01T00:00:02.000Z";
    snapshot.messages.push({ role: "assistant", content: "new CLI output" });
  });
  await page.clock.runFor(2100);
  await title("CLI advanced");
  expect(await readCount()).toBe(2);
  expect(await page.evaluate(() => Reflect.get(window, "controller").state.activeSnapshot.messages.at(-1).content)).toBe("new CLI output");
  await page.evaluate(() => {
    const snapshot = Reflect.get(window, "fixture").snapshots[0];
    snapshot.status = "completed";
    snapshot.updatedAt = "2026-10-01T00:00:03.000Z";
  });
  await page.clock.runFor(2100);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "controller").state.activeSnapshot.status)).toBe("completed");
  expect(await readCount()).toBe(3);
  await page.clock.runFor(6000);
  expect(await readCount()).toBe(3);
  expect(await page.evaluate(() => Reflect.get(window, "fixture").writes)).toEqual([]);
});

it("coalesces slow external reads and stops observing when selecting another session", async () => {
  await selectExternalSession();
  await script(first, ["hold", "ok"]);
  await page.clock.runFor(2100);
  await page.waitForFunction(() => Reflect.get(window, "fixture").release);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(6000);
  expect(await readCount()).toBe(2);
  await page.getByRole("button", { name: "选择 B" }).click();
  await title("Session B");
  await page.evaluate(() => Reflect.get(window, "fixture").release());
  await page.clock.runFor(6000);
  expect(await readCount()).toBe(3);
  await title("Session B");
});

it.each(["corrupt", "not_found", "network", "conflict"])("stops external observation after a %s read failure", async mode => {
  await selectExternalSession();
  await script(first, [mode]);
  await page.clock.runFor(2500);
  await page.getByRole("alert").waitFor();
  const count = mode === "conflict" ? 4 : 2;
  expect(await readCount()).toBe(count);
  await page.clock.runFor(10000);
  expect(await readCount()).toBe(count);
  expect(await page.getByTestId("transcript").innerText()).toBe("persisted transcript");
  expect(await page.evaluate(() => Reflect.get(window, "fixture").writes)).toEqual([]);
});

it("pauses external observation in hidden tabs and cleans it up on unmount", async () => {
  await selectExternalSession();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(6000);
  expect(await readCount()).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(readCount).toBe(2);
  await page.evaluate(() => Reflect.get(window, "fixture").unmount());
  await page.clock.runFor(6000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(await readCount()).toBe(2);
});

it("leaves host-owned runs on their live event stream without additional reads", async () => {
  await selectExternalSession();
  await page.evaluate(id => Reflect.get(window, "fixture").emit({
    runId: "33333333-3333-4333-8333-333333333333",
    event: { type: "state_changed", sessionId: id, status: "running", timestamp: "2026-10-01T00:00:02.000Z" },
  }), first);
  await expect.poll(() => page.evaluate(id => Boolean(Reflect.get(window, "controller").state.activeRuns[id]?.runId), first)).toBe(true);
  await page.clock.runFor(6000);
  expect(await readCount()).toBe(1);
});
