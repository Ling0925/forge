import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("keeps rendered output through tool transitions, lagging snapshots and terminal refreshes", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
    import {useReducer} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Transcript} from './src/renderer/components/workbench/Transcript';
    import {initialWorkbenchState,workbenchReducer} from './src/renderer/state/workbench-reducer';
    import './src/renderer/styles/global.css';
    import './src/renderer/components/workbench/app.css';
    import './src/renderer/styles/workspace-theme.css';
    const id='11111111-1111-4111-8111-111111111111';
    const runId='22222222-2222-4222-8222-222222222222';
    const call={id:'tool',type:'function',function:{name:'read_file',arguments:'{"path":"a.txt"}'}};
    const base={version:1,id,title:'test',workspace:'/tmp',model:'m',status:'running',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:01.000Z',messages:[{role:'user',content:'task'}],events:[],changes:[]};
    const saved={...base,updatedAt:'2026-01-01T00:00:02.000Z',messages:[...base.messages,{role:'assistant',content:'First answer survives',tool_calls:[call]}]};
    function Harness(){
      const [state,dispatch]=useReducer(workbenchReducer,{...initialWorkbenchState,activeSessionId:id,activeSnapshot:base});
      const event=data=>dispatch({type:'RUN_EVENT_RECEIVED',event:{runId,event:{sessionId:id,timestamp:'2026-01-01T00:00:03.000Z',...data}}});
      window.testController={state,answerApproval:()=>{},openNewSession:()=>{}};
      window.step=action=>{
        if(action==='error') event({type:'error',error:{code:'provider',message:'Old failure',retryable:true}});
        if(action==='first') event({type:'text_delta',text:'First answer survives'});
        if(action==='tool') event({type:'tool_started',call});
        if(action==='stale') dispatch({type:'SET_ACTIVE_SNAPSHOT',snapshot:base});
        if(action==='second') event({type:'text_delta',text:'Second answer survives'});
        if(action==='saved') dispatch({type:'SET_ACTIVE_SNAPSHOT',snapshot:saved});
        if(action==='finish') event({type:'run_finished',status:'completed',turns:2,toolCalls:1});
        if(action==='final') dispatch({type:'SET_ACTIVE_SNAPSHOT',snapshot:{...saved,updatedAt:'2026-01-01T00:00:04.000Z',status:'completed',messages:[...saved.messages,{role:'assistant',content:'Second answer survives'}]}});
      };
      return <div className="wb-app"><main className="workbench-main"><Transcript/></main></div>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "transcript.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "context",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            contents: "export const useWorkbench=()=>window.testController;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) =>
    file.path.endsWith(".css"),
  )?.text;
  if (!js || !css) throw new Error("Missing bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const withError of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent('<div id="root"></div>');
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: js });
      const step = async (action: string) => {
        await page.evaluate(
          (value) =>
            (window as unknown as { step: (action: string) => void }).step(
              value,
            ),
          action,
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
      };
      if (withError) await step("error");
      await step("first");
      const first = page
        .locator(".message-assistant")
        .filter({ hasText: "First answer survives" });
      await expect.poll(() => first.count()).toBe(1);
      let secondStarted = false;
      for (const action of [
        "tool",
        "stale",
        "tool",
        "second",
        "saved",
        "finish",
        "stale",
        "final",
      ]) {
        await step(action);
        if (action === "second") secondStarted = true;
        expect(await first.count(), action).toBe(1);
        expect(await first.isVisible(), action).toBe(true);
        if (secondStarted) {
          await expect
            .poll(() =>
              page
                .locator(".message-assistant")
                .filter({ hasText: "Second answer survives" })
                .count(),
            )
            .toBe(1);
        }
      }
      expect(await page.locator(".message-assistant").count()).toBe(2);
      if (withError) {
        const history = page
          .locator("details")
          .filter({ hasText: "历史异常记录" });
        expect(await history.getAttribute("open")).toBeNull();
        expect(
          await page.locator(".conversation-inner > :last-child").innerText(),
        ).toContain("Second answer survives");
        await history.locator("summary").click();
        expect(await history.innerText()).toContain("Old failure");
      }
      await page.screenshot({
        path: `/tmp/forge-transcript-sync-${withError}.png`,
      });
      expect(errors).toEqual([]);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}, 20000);
