import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

// The web/desktop renderer previously captured streamingReasoning but rendered
// nothing, so live thoughts were invisible while the model was thinking.
it("renders live reasoning and collapses it once the answer begins", async () => {
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
    const base={version:1,id,title:'test',workspace:'/tmp',model:'m',status:'running',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:01.000Z',messages:[{role:'user',content:'task'}],events:[],changes:[]};
    const saved={...base,status:'completed',updatedAt:'2026-01-01T00:00:05.000Z',messages:[...base.messages,{role:'assistant',content:'Answer',reasoning:'I inspected the persisted file'}]};
    function Harness(){
      const [state,dispatch]=useReducer(workbenchReducer,{...initialWorkbenchState,activeSessionId:id,activeSnapshot:base});
      const event=data=>dispatch({type:'RUN_EVENT_RECEIVED',event:{runId,event:{sessionId:id,timestamp:'2026-01-01T00:00:03.000Z',...data}}});
      window.testController={state,answerApproval:()=>{},openNewSession:()=>{}};
      window.step=action=>{
        if(action==='reasoning') event({type:'reasoning_delta',text:'Inspecting the harness'});
        if(action==='answer') event({type:'text_delta',text:'Answer'});
        if(action==='tool') event({type:'tool_started',call:{id:'tool',type:'function',function:{name:'read_file',arguments:'{}'}}});
        if(action==='saved') dispatch({type:'SET_ACTIVE_SNAPSHOT',snapshot:saved});
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
    outfile: "reasoning.js",
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    const step = async (action: string) => {
      await page.evaluate(
        (value) =>
          (window as unknown as { step: (action: string) => void }).step(value),
        action,
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    };

    // Live reasoning is visible and expanded while the model is thinking.
    await step("reasoning");
    const live = page.locator("details.transcript-reasoning");
    await expect.poll(() => live.count()).toBe(1);
    expect(await live.getAttribute("open")).not.toBeNull();
    expect(await live.innerText()).toContain("Inspecting the harness");
    expect(await live.innerText()).toContain("思考中…");

    // Once the answer streams in, the same block collapses to 思考过程.
    await step("answer");
    await expect.poll(() => live.count()).toBe(1);
    expect(await live.getAttribute("open")).toBeNull();
    expect(await live.innerText()).toContain("思考过程");

    // Persisted reasoning renders as its own collapsed disclosure.
    await step("saved");
    await expect.poll(() => page.locator("details.transcript-reasoning").count()).toBe(2);
    const saved = page
      .locator("details.transcript-reasoning")
      .filter({ hasText: "I inspected the persisted file" });
    await expect.poll(() => saved.count()).toBe(1);
    expect(await saved.getAttribute("open")).toBeNull();

    expect(errors).toEqual([]);
    await page.close();
  } finally {
    await browser.close();
  }
}, 30000);
