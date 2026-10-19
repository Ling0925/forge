import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";

let browser: Browser;
let js: string;
let css: string;

beforeAll(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."), loader: "tsx", contents: `
        import {createRoot} from 'react-dom/client';
        import {Composer} from './src/renderer/components/workbench/Composer';
        import {TestProvider,useWorkbench} from './src/renderer/state/workbench-context';
        const snapshot=id=>({id,model:'test/model',workspace:'/tmp',events:[]});
        window.calls=[];window.pending={};
        window.forge={
          chooseWorkspace:async()=>'/tmp',
          listModels:async()=>['test/model'],getSession:async id=>snapshot(id),
          compactSession:id=>{window.calls.push('compact:'+id);return new Promise(resolve=>{
            window.pending[id]=()=>resolve({...snapshot(id),contextSummary:{boundary:2,content:'summary'}});
          });},
          getDiagnostics:id=>{window.calls.push('diagnostics:'+id);return new Promise((resolve,reject)=>{
            window.pending[id]=()=>reject(new Error(id+' diagnostics failed'));
          });}
        };
        function Harness(){const {select,setRun}=useWorkbench();return <>
          <div style={{paddingTop:100}}><Composer isNew={useWorkbench().state.isNewSessionOpen}/></div>
          <nav style={{position:'fixed',top:0,zIndex:1000,background:'white'}}>
          <button onClick={()=>select('a')}>Session A</button>
          <button onClick={()=>select('b')}>Session B</button>
          <button onClick={()=>select('new')}>New session</button>
          <button onClick={()=>window.pending.a()}>Complete A</button>
          <button onClick={()=>window.pending.b()}>Fail B</button>
          <button onClick={()=>setRun('a',{status:'running',providerRetry:2})}>Run A</button>
          <button onClick={()=>setRun('b',{status:'awaiting_approval'})}>Run B</button>
          <button onClick={()=>setRun('a',{status:'completed'})}>Finish A</button>
          </nav>
        </>}
        createRoot(document.getElementById('root')).render(<TestProvider><Harness/></TestProvider>);
      `,
    },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "scope.js",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "session-state", setup(api) {
      api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
        resolveDir: resolve("."), loader: "tsx", contents: `
          import {createContext,useContext,useState,useLayoutEffect} from 'react';
          import {defaultPublicSettings} from './src/shared/schemas';
          const Context=createContext(null);export const useWorkbench=()=>useContext(Context);
          const snapshot=id=>({id,model:'test/model',workspace:'/tmp',events:[]});
          export function TestProvider({children}){
            const [id,setId]=useState('a');const [runs,setRuns]=useState({});
            useLayoutEffect(()=>{
              window.activityFrames??=[];
              window.activityFrames.push({id,text:document.querySelector('.composer-activity')?.textContent??''});
            });
            return <Context.Provider value={{
              select:setId,selectSession:async id=>setId(id),
              setRun:(id,run)=>setRuns(old=>({...old,[id]:{sessionId:id,runId:id,...run}})),
              dispatch:()=>{},loadSessions:async()=>{},updateSettings:async()=>({ok:true}),
              state:{activeSessionId:id==='new'?null:id,isNewSessionOpen:id==='new',
                activeSnapshot:id==='new'?null:snapshot(id),sessions:[],
                settings:{...defaultPublicSettings,model:'test/model',isConfigured:true},activeRuns:runs}
            }}>{children}</Context.Provider>
          }
        `,
      }));
    } }],
  });
  js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => { await browser?.close(); });

async function mount(): Promise<Page> {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  page.on("pageerror", error => console.error("Mounted page error:", error.message));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  return page;
}

it("keeps command status, duplicate guards and out-of-order results with their session", async () => {
  const page = await mount();
  try {
    const input = page.locator("textarea");
    const executing = page.getByText("正在执行命令…", { exact: true });
    const calls = () => page.evaluate(() => (window as unknown as { calls: string[] }).calls);
    const message = () => page.locator(".composer-slash-message").innerText();
    await input.fill("/compact");
    await input.press("Enter");
    await expect.poll(() => executing.count()).toBe(1);
    await expect.poll(calls).toEqual(["compact:a"]);

    await page.getByRole("button", { name: "Session B", exact: true }).click();
    expect(await executing.count()).toBe(0);
    expect(await page.locator(".composer-slash-message").count()).toBe(0);
    await input.fill("/diagnostics");
    await input.press("Enter");
    await expect.poll(calls).toEqual(["compact:a", "diagnostics:b"]);
    expect(await executing.count()).toBe(1);

    await page.getByRole("button", { name: "Session A", exact: true }).click();
    expect(await input.inputValue()).toBe("/compact");
    expect(await executing.count()).toBe(1);
    await input.press("Enter");
    await input.press("Enter");
    expect(await calls()).toEqual(["compact:a", "diagnostics:b"]);

    await page.getByRole("button", { name: "Session B", exact: true }).click();
    await expect.poll(() => input.getAttribute("id")).toBe("prompt-b");
    await page.getByRole("button", { name: "Complete A", exact: true }).click();
    expect(await executing.count()).toBe(1);
    expect(await page.locator(".composer-slash-message").count()).toBe(0);
    expect(await input.inputValue()).toBe("/diagnostics");
    await page.getByRole("button", { name: "Fail B", exact: true }).click();
    await expect.poll(message).toBe("b diagnostics failed");
    expect(await executing.count()).toBe(0);

    await page.getByRole("button", { name: "Session A", exact: true }).click();
    await expect.poll(message).toContain("上下文压缩完成");
    expect(await executing.count()).toBe(0);
    await page.getByRole("button", { name: "New session", exact: true }).click();
    expect(await page.locator(".composer-slash-message").count()).toBe(0);
    expect(await executing.count()).toBe(0);
    await page.getByRole("button", { name: "Session B", exact: true }).click();
    expect(await message()).toBe("b diagnostics failed");
  } finally { await page.close(); }
});

it("never shows the previous session's run activity while retaining same-session exit animation", async () => {
  const page = await mount();
  try {
    const activity = () => page.locator(".composer-activity").innerText();
    await page.getByRole("button", { name: "Run A", exact: true }).click();
    await expect.poll(activity).toContain("重试 2/5");
    await page.getByRole("button", { name: "Session B", exact: true }).click();
    expect(await page.locator(".composer-activity").count()).toBe(0);
    await page.getByRole("button", { name: "New session", exact: true }).click();
    expect(await page.locator(".composer-activity").count()).toBe(0);
    const inactiveFrames = await page.evaluate(() =>
      (window as unknown as { activityFrames: { id: string; text: string }[] }).activityFrames.filter(frame => frame.id !== "a"));
    expect(inactiveFrames.every(frame => frame.text === "")).toBe(true);

    await page.getByRole("button", { name: "Run B", exact: true }).click();
    await page.getByRole("button", { name: "Session B", exact: true }).click();
    await expect.poll(activity).toContain("等待审批");
    expect(await activity()).not.toContain("重试");
    await page.getByRole("button", { name: "Session A", exact: true }).click();
    await expect.poll(activity).toContain("重试 2/5");
    await page.clock.install();
    await page.getByRole("button", { name: "Finish A", exact: true }).click();
    await expect.poll(() => page.locator(".composer-activity-slot").getAttribute("class")).toContain("is-leaving");
    await page.clock.fastForward(250);
    await expect.poll(() => page.locator(".composer-activity").count()).toBe(0);
  } finally { await page.close(); }
});
