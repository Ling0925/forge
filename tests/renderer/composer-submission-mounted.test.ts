import { resolve } from "node:path";
import { build } from "esbuild";
import { type Page, chromium } from "playwright";
import { expect, it } from "vitest";

// Real mounted composer: one instance stays mounted while navigation changes
// the active session, so pending writes must be owned per draft/session.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

async function steerPrompts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Reflect.get(window, "fixture").steers.map(
      (entry: { prompt: string }) => entry.prompt,
    ),
  );
}

async function pendingSteers(page: Page): Promise<number> {
  return page.evaluate(() => Reflect.get(window, "fixture").pending());
}

it("scopes pending steering to its session and settles drafts per owner", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import {createRoot} from 'react-dom/client';
        import {Composer} from './src/renderer/components/workbench/Composer';
        import {Transcript} from './src/renderer/components/workbench/Transcript';
        import {WorkbenchProvider,useWorkbench} from './src/renderer/state/workbench-context';
        import {defaultPublicSettings} from './src/shared/schemas';
        import './src/renderer/styles/global.css';
        import './src/renderer/components/workbench/app.css';
        import './src/renderer/styles/workspace-theme.css';
        import './src/renderer/styles/settings-models.css';
        const a='${A}';
        const b='${B}';
        const snapshots=Object.fromEntries([a,b].map(id=>[id,{version:1,id,title:id===a?'A':'B',
          workspace:'/tmp',model:'a-model',providerSourceId:'a',status:'idle',
          createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',
          messages:[],events:[],changes:[]}]));
        const listeners=new Set(); const live=new Map(); const steers=[]; let counter=0;
        const emit=(runId,event)=>{for(const listener of listeners)listener({runId,event:{timestamp:new Date().toISOString(),...event}});};
        const entryFor=(sessionId)=>steers.find(item=>item.sessionId===sessionId&&!item.settled);
        const fixture=window.fixture={starts:[],steers,ready:[],
          pending:()=>steers.filter(item=>!item.settled).length,
          accept:(sessionId)=>{const item=fixture.ready.find(entry=>entry.sessionId===sessionId);
            if(!item)throw Error('no unaccepted run for '+sessionId);
            fixture.ready=fixture.ready.filter(entry=>entry!==item);
            emit(item.runId,{type:'run_started',sessionId,model:snapshots[sessionId].model,permission:'workspace'});},
          apply:(sessionId)=>{const item=entryFor(sessionId);if(!item)throw Error('no pending steering for '+sessionId);
            item.settled=true;(snapshots[sessionId].pendingSteering??=[]).push({role:'user',content:item.prompt});item.resolve();},
          fail:(sessionId,message)=>{const item=entryFor(sessionId);if(!item)throw Error('no pending steering for '+sessionId);
            item.settled=true;item.reject(Error(message||'未写入，草稿已保留'));}};
        window.forge={getSettings:async()=>({...defaultPublicSettings,isConfigured:true,
            baseUrl:'https://a.invalid/v1',model:'a-model',activeSourceId:'a',
            providerSources:[{id:'a',label:'Source A',baseUrl:'https://a.invalid/v1',model:'a-model',hasApiKey:false}]}),
          listSessions:async()=>Object.values(snapshots),
          getSession:async id=>structuredClone(snapshots[id]),
          listModels:async()=>['a-model'],
          onEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
          startRun:async input=>{fixture.starts.push(input);
            const runId='33333333-3333-4333-8333-'+String(++counter).padStart(12,'0');
            const snapshot=snapshots[input.sessionId];snapshot.messages.push({role:'user',content:input.prompt});snapshot.status='running';
            live.set(input.sessionId,runId);fixture.ready.push({sessionId:input.sessionId,runId});
            return {runId,sessionId:input.sessionId};},
          steerRun:(runId,prompt)=>new Promise((resolve,reject)=>{
            const sessionId=[...live].find(([,id])=>id===runId)?.[0];
            if(!sessionId){reject(Error('stale run'));return;}
            steers.push({sessionId,runId,prompt,settled:false,resolve,reject});}),
          chooseWorkspace:async()=>null,
          setRunPermission:async(_id,permission)=>permission};
        function Harness(){const {selectSession,state}=useWorkbench();return <>
          <button onClick={()=>selectSession(a)}>打开 A</button><button onClick={()=>selectSession(b)}>打开 B</button>
          <output id="selected">{state.activeSessionId}</output><div className="wb-app"><main className="workbench-main"><Transcript/><Composer/></main></div></>}
        createRoot(document.getElementById('root')).render(<WorkbenchProvider><Harness/></WorkbenchProvider>);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "composer-submission.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://forge.test/**", (route) =>
      route.fulfill({
        body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
        contentType: "text/html",
      }),
    );
    await page.goto("http://forge.test");
    const js = bundle.outputFiles.find((file) =>
      file.path.endsWith(".js"),
    )?.text;
    if (!js) throw new Error("Missing mounted bundle");
    const css =
      bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    await page.addStyleTag({ content: css });
    await page.addStyleTag({
      content:
        ".wb-app{height:740px!important;padding-top:20px}body,#root{overflow:auto!important}",
    });
    await page.addScriptTag({ content: js });

    const input = page.locator("textarea.composer-textarea");
    const steerButton = page.locator(".composer-btn-steer-hold");
    const openA = page.getByRole("button", { name: "打开 A", exact: true });
    const openB = page.getByRole("button", { name: "打开 B", exact: true });

    // Start A and hold its run_started: A's own draft and controls stay locked.
    await openA.click();
    await input.fill("start A");
    await input.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "fixture").ready.length),
      )
      .toBe(1);
    await page.locator(".composer-cancel").waitFor();
    expect(await input.inputValue()).toBe("start A");
    expect(await steerButton.isDisabled()).toBe(true);

    // B can start while A waits for acceptance: the lock belongs to A's draft.
    await openB.click();
    await expect.poll(() => page.locator("#selected").innerText()).toBe(B);
    await input.fill("start B");
    expect(await page.locator(".composer-submit").isDisabled()).toBe(false);
    await input.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "fixture").ready.length),
      )
      .toBe(2);
    await page.locator(".composer-cancel").waitFor();
    expect(await input.inputValue()).toBe("start B");
    expect(await steerButton.isDisabled()).toBe(true);

    // Accepting B clears only B; A's unaccepted draft and lock survive.
    await page.evaluate(
      (sessionId) => Reflect.get(window, "fixture").accept(sessionId),
      B,
    );
    await expect.poll(() => input.inputValue()).toBe("");
    await openA.click();
    await expect.poll(() => input.inputValue()).toBe("start A");
    expect(await steerButton.isDisabled()).toBe(true);

    // Editing the same draft while acceptance is pending survives settlement;
    // acceptance still releases A's own lock.
    await input.fill("start A edited");
    await page.evaluate(
      (sessionId) => Reflect.get(window, "fixture").accept(sessionId),
      A,
    );
    await expect.poll(() => steerButton.isDisabled()).toBe(false);
    expect(await input.inputValue()).toBe("start A edited");
    expect(await page.locator(".composer-cancel").count()).toBe(1);
    await input.fill("");

    // A running with a pending steering write: its draft and button stay locked.
    await input.fill("steer A one");
    await input.press("Alt+Enter");
    await expect.poll(() => pendingSteers(page)).toBe(1);
    expect(await steerPrompts(page)).toEqual(["steer A one"]);
    expect(await input.inputValue()).toBe("steer A one");
    expect(await steerButton.isDisabled()).toBe(true);
    // The same session's shortcut is also locked: no duplicate write.
    await input.press("Alt+Enter");
    expect(await steerPrompts(page)).toEqual(["steer A one"]);
    expect(await pendingSteers(page)).toBe(1);

    // B is untouched by A's pending steering: its own start draft was cleared
    // only by B's acceptance, and its run is still controllable.
    await openB.click();
    await expect.poll(() => page.locator("#selected").innerText()).toBe(B);
    await expect.poll(() => input.inputValue()).toBe("");
    expect(await page.locator(".composer-cancel").count()).toBe(1);

    // Two sessions can hold steering writes at once.
    await input.fill("steer B one");
    await input.press("Alt+Enter");
    await expect.poll(() => pendingSteers(page)).toBe(2);
    expect(await steerPrompts(page)).toEqual(["steer A one", "steer B one"]);
    expect(await steerButton.isDisabled()).toBe(true);

    // A settling must not unlock or clear B while B's write is still pending.
    await page.evaluate(
      (sessionId) => Reflect.get(window, "fixture").apply(sessionId),
      A,
    );
    await expect.poll(() => pendingSteers(page)).toBe(1);
    expect(await input.inputValue()).toBe("steer B one");
    expect(await steerButton.isDisabled()).toBe(true);

    // A cleared on success and renders the sent message while its model is still
    // running; it can accept another write even while B's write is pending.
    await openA.click();
    await expect.poll(() => input.inputValue()).toBe("");
    await page.getByText("steer A one", { exact: true }).waitFor({ state: "visible" });
    expect(await page.locator(".composer-cancel").count()).toBe(1);
    await input.fill("steer A two");
    await input.press("Alt+Enter");
    await expect.poll(() => pendingSteers(page)).toBe(2);
    expect(await input.inputValue()).toBe("steer A two");
    expect(await steerButton.isDisabled()).toBe(true);

    // B's success clears only B; A's newer draft and lock stay intact.
    await openB.click();
    await expect.poll(() => input.inputValue()).toBe("steer B one");
    await page.evaluate(
      (sessionId) => Reflect.get(window, "fixture").apply(sessionId),
      B,
    );
    await expect.poll(() => input.inputValue()).toBe("");
    await page.getByText("steer B one", { exact: true }).waitFor({ state: "visible" });
    await expect.poll(() => pendingSteers(page)).toBe(1);
    await openA.click();
    await expect.poll(() => input.inputValue()).toBe("steer A two");
    expect(await steerButton.isDisabled()).toBe(true);

    // Failure keeps A's draft, reports it, and releases only A's own lock.
    await page.evaluate(
      (sessionId) =>
        Reflect.get(window, "fixture").fail(sessionId, "未写入，草稿已保留"),
      A,
    );
    await expect.poll(() => pendingSteers(page)).toBe(0);
    await expect
      .poll(() => page.locator(".composer-error").innerText())
      .toContain("草稿已保留");
    expect(await input.inputValue()).toBe("steer A two");
    expect(await steerButton.isDisabled()).toBe(false);

    // The retained draft can be retried immediately.
    await input.press("Alt+Enter");
    await expect.poll(() => pendingSteers(page)).toBe(1);
    expect(await steerPrompts(page)).toEqual([
      "steer A one",
      "steer B one",
      "steer A two",
      "steer A two",
    ]);
    await page.evaluate(
      (sessionId) => Reflect.get(window, "fixture").apply(sessionId),
      A,
    );
    await expect.poll(() => input.inputValue()).toBe("");

    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
