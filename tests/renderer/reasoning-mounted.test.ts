import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

// The renderer captures streamingReasoning but historically rendered nothing.
// It now shows a bespoke, non-native reasoning block: a small auto-scrolling
// viewport while thinking, then a single last-line summary once done.
it("streams reasoning in a scrolling viewport then keeps only the last line", async () => {
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
        if(action==='reasoning') event({type:'reasoning_delta',text:'line 1\\nline 2\\nline 3\\nline 4\\nline 5\\nline 6\\nfinal thought'});
        if(action==='answer') event({type:'text_delta',text:'Answer'});
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

    // While thinking: a scrolling viewport, never a native <details>.
    await step("reasoning");
    const live = page.locator(".reasoning-live");
    await expect.poll(() => live.count()).toBe(1);
    expect(await page.locator("details.transcript-reasoning").count()).toBe(0);
    expect(await live.innerText()).toContain("思考中");
    const viewport = page.locator(".reasoning-viewport");
    await expect.poll(() => viewport.count()).toBe(1);
    // Newest line stays in view: the viewport is scrolled to the bottom.
    const scrolled = await viewport.evaluate(
      (node) => node.scrollHeight > node.clientHeight && node.scrollTop > 0,
    );
    expect(scrolled).toBe(true);

    // Done: the live viewport is gone; one collapsed last-line summary remains.
    await step("answer");
    await expect.poll(() => page.locator(".reasoning-live").count()).toBe(0);
    const done = page.locator(".reasoning-done");
    await expect.poll(() => done.count()).toBe(1);
    expect(await done.locator(".reasoning-summary").innerText()).toBe(
      "final thought",
    );
    expect(await page.locator(".reasoning-full").count()).toBe(0);
    await done.locator(".reasoning-head").click();
    await expect.poll(() => page.locator(".reasoning-full").count()).toBe(1);
    expect(await page.locator(".reasoning-full").innerText()).toContain("line 1");

    // Persisted reasoning renders as its own collapsed last-line summary.
    await step("saved");
    await expect.poll(() => page.locator(".reasoning-done").count()).toBe(2);
    const persisted = page
      .locator(".reasoning-done")
      .filter({ hasText: "I inspected the persisted file" });
    await expect.poll(() => persisted.count()).toBe(1);

    expect(errors).toEqual([]);
    await page.close();
  } finally {
    await browser.close();
  }
}, 30000);
