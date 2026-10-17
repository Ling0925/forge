import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("shows preparing, executing and finished tool UI while session snapshot reads are withheld", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {useReducer} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Transcript} from './src/renderer/components/workbench/Transcript';
      import {initialWorkbenchState,workbenchReducer} from './src/renderer/state/workbench-reducer';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      const id='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222';
      const start={type:'run_started',sessionId:id,timestamp:'2026-01-01T00:00:00.000Z',model:'m',permission:'unrestricted'};
      const call={id:'call',type:'function',function:{name:'read_file',arguments:'{"path":"a.ts"}'}};
      const base={version:1,id,title:'test',workspace:'/tmp',model:'m',status:'running',createdAt:start.timestamp,updatedAt:start.timestamp,messages:[{role:'user',content:'task'}],events:[start],changes:[]};
      function Harness(){
        const [state,dispatch]=useReducer(workbenchReducer,{...initialWorkbenchState,activeSessionId:id,activeSnapshot:base});
        const event=data=>dispatch({type:'RUN_EVENT_RECEIVED',event:{runId,event:{sessionId:id,timestamp:'2026-01-01T00:00:03.000Z',...data}}});
        window.testController={state,answerApproval:()=>{},openNewSession:()=>{}};
        window.step=action=>{
          if(action==='prepare') event({type:'tool_call_preview',previewId:'1:0:0',name:'read_file',argumentsChars:123});
          if(action==='update') event({type:'tool_call_preview',previewId:'1:0:0',name:'read_file',argumentsChars:456});
          if(action==='start') event({type:'tool_started',previewId:'1:0:0',call});
          if(action==='finish') event({type:'tool_finished',toolCallId:call.id,result:{content:'file content',isError:false}});
          if(action==='stale') dispatch({type:'SET_ACTIVE_SNAPSHOT',snapshot:base});
          if(action==='saved') dispatch({type:'SET_ACTIVE_SNAPSHOT',snapshot:{...base,updatedAt:'2026-01-01T00:00:04.000Z',messages:[...base.messages,{role:'assistant',content:null,tool_calls:[call]},{role:'tool',tool_call_id:call.id,content:JSON.stringify({content:'file content',isError:false})}]}});
        };
        return <div className="wb-app"><main className="workbench-main"><Transcript/></main></div>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "tool-live.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "context", setup(api) {
      api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({ contents: "export const useWorkbench=()=>window.testController;", loader: "js" }));
    } }],
  });
  const js = bundle.outputFiles.find(f => f.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find(f => f.path.endsWith(".css"))?.text;
  if (!js || !css) throw new Error("Missing bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.waitForFunction(() => typeof (window as unknown as { step?: unknown }).step === "function");
    const step = async (action: string) => {
      await page.evaluate(value => (window as unknown as { step: (a: string) => void }).step(value), action);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    };
    await step("prepare");
    expect(await page.locator(".conversation-inner").innerText()).toContain("生成参数中");
    expect(await page.locator(".conversation-inner").innerText()).toContain("123");
    await step("update");
    expect((await page.locator(".conversation-inner").innerText()).match(/生成参数中/g)).toHaveLength(1);
    expect(await page.locator(".conversation-inner").innerText()).toContain("456");
    await step("start");
    expect(await page.locator('.tool-disclosure[data-status="running"]').count()).toBe(1);
    expect(await page.locator(".conversation-inner").innerText()).not.toContain("生成参数中");
    await step("stale");
    expect(await page.locator('.tool-disclosure[data-status="running"]').count()).toBe(1);
    await step("finish");
    expect(await page.locator('.tool-disclosure[data-status="completed"]').count()).toBe(1);
    await step("saved");
    expect(await page.locator(".tool-disclosure").count()).toBe(1);
    await page.locator(".tool-disclosure-header").click();
    expect(await page.locator(".tool-disclosure").innerText()).toContain("file content");
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 20000);
