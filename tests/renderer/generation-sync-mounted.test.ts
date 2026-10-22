import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { expect, it } from "vitest";

const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const call = { id: "reused", type: "function", function: { name: "read_file", arguments: '{"path":"fixture.txt"}' } };
type HarnessWindow = Window & {
  send(data: object, nextRun?: boolean): void;
  save(messages: object[], status?: string): void;
  savedHead?: Element | null;
  copied?: string;
};
const settle = (page: Page) => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
async function event(page: Page, data: object, nextRun = false) {
  await page.evaluate(({ data, nextRun }) => (window as unknown as HarnessWindow).send(data, nextRun), { data, nextRun });
  await settle(page);
}
async function save(page: Page, messages: object[], status = "running") {
  await page.evaluate(({ messages, status }) => (window as unknown as HarnessWindow).save(messages, status), { messages, status });
  await settle(page);
}

it("renders generation-ordered reasoning through both snapshot races, failure and continuation", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {useReducer} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Transcript} from './src/renderer/components/workbench/Transcript';
      import {agentEventSchema,sessionSnapshotSchema} from './src/shared/schemas';
      import {initialWorkbenchState,workbenchReducer} from './src/renderer/state/workbench-reducer';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/styles/workspace-theme.css';
      const id='11111111-1111-4111-8111-111111111111';
      const runId='22222222-2222-4222-8222-222222222222';
      let tick=0; const stamp=()=>new Date(Date.UTC(2026,9,22,0,0,tick++)).toISOString();
      const base=sessionSnapshotSchema.parse({version:1,id,title:'test',workspace:'/tmp',model:'fixture',status:'running',createdAt:stamp(),updatedAt:stamp(),messages:[{role:'user',content:'TASK'}],events:[],changes:[]});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});
      function Harness(){
        const [state,dispatch]=useReducer(workbenchReducer,{...initialWorkbenchState,activeSessionId:id,activeSnapshot:base});
        window.testController={state,answerApproval:()=>{},openNewSession:()=>{}};
        window.send=(data,nextRun=false)=>dispatch({type:'RUN_EVENT_RECEIVED',event:{runId:nextRun?'33333333-3333-4333-8333-333333333333':runId,event:agentEventSchema.parse({sessionId:id,timestamp:stamp(),turn:1,step:1,...data})}});
        window.save=(messages,status='running')=>dispatch({type:'SET_ACTIVE_SNAPSHOT',snapshot:sessionSnapshotSchema.parse({...state.activeSnapshot,messages,status,updatedAt:stamp()})});
        return <div className="wb-app"><main className="workbench-main"><Transcript/></main></div>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "generations.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "context", setup(api) {
      api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({ contents: "export const useWorkbench=()=>window.testController;", loader: "js" }));
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text;
  if (!js || !css) throw Error("Missing fixture bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(3000);
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.setContent('<div id="root"></div>');
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js }); await settle(page);
      await event(page, { type: "run_started", model: "fixture", permission: "unrestricted", messageIndex: 0 });
      await event(page, { type: "step_started", messageIndex: 1 });
      await event(page, { type: "generation_started", generationId: first, messageIndex: 1 });
      await event(page, { type: "reasoning_delta", generationId: first, text: "first line\nlast thought" });
      const firstMessage = page.locator(`[data-generation-id="${first}"]`);
      expect(await firstMessage.locator(".reasoning-live").count()).toBe(1);
      await event(page, { type: "tool_call_preview", generationId: first, previewId: "preview", name: "read_file", argumentsChars: 22 });
      expect(await firstMessage.locator(".reasoning-live").count()).toBe(0);
      expect(await firstMessage.locator(".message-author-row, .message-copy").count()).toBe(0);
      await firstMessage.locator(".reasoning-head").click();
      await event(page, { type: "generation_finished", generationId: first, status: "completed" });
      await event(page, { type: "tool_started", generationId: first, callIndex: 0, call, previewId: "preview" });
      await event(page, { type: "tool_finished", generationId: first, callIndex: 0, toolCallId: call.id, result: { content: "OK", isError: false } });
      // Compare a settled pending→saved handoff, not the earlier live→done
      // collapse (its hidden viewport unmounts after the closing delay).
      await expect.poll(() => firstMessage.locator(".smooth-collapse.is-collapsing").count()).toBe(0);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await settle(page);
      const before = await firstMessage.boundingBox();
      const toolBox = await page.locator(".tool-disclosure").first().boundingBox();
      expect(before && toolBox && before.y + before.height <= toolBox.y + 1).toBe(true);
      await firstMessage.locator(".reasoning-head").focus();
      await page.evaluate(id => { (window as unknown as HarnessWindow).savedHead = document.querySelector(`[data-generation-id="${id}"] .reasoning-head`); }, first);
      const messages = [{ role: "user", content: "TASK" },
        { role: "assistant", generationId: first, content: null, reasoning: "first line\nlast thought", tool_calls: [call] },
        { role: "tool", tool_call_id: call.id, content: JSON.stringify({ content: "OK", isError: false }) }];
      await save(page, messages);
      expect(await firstMessage.count()).toBe(1);
      expect(await firstMessage.locator(".reasoning-head").getAttribute("aria-expanded")).toBe("true");
      expect(await page.evaluate(() => (window as unknown as HarnessWindow).savedHead === document.activeElement)).toBe(true);
      const after = await firstMessage.boundingBox();
      expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
      await event(page, { type: "step_started", step: 2, messageIndex: 3 });
      await event(page, { type: "generation_started", generationId: second, step: 2, messageIndex: 3 });
      await event(page, { type: "reasoning_delta", generationId: second, step: 2, text: "first line\nlast thought" });
      await save(page, messages);
      const nextMessage = page.locator(`[data-generation-id="${second}"]`);
      expect(await nextMessage.locator(".reasoning-live").count()).toBe(1);
      await event(page, { type: "generation_finished", generationId: second, status: "failed", step: 2 });
      await event(page, { type: "error", step: 2, error: { code: "provider", message: "Fixture protocol failure", retryable: false } });
      await event(page, { type: "run_finished", status: "failed", turns: 2, toolCalls: 1, messageIndex: 3 });
      await save(page, messages, "failed");
      await event(page, { type: "run_started", model: "fixture", permission: "unrestricted", turn: 2, messageIndex: 3 }, true);
      await save(page, [...messages, { role: "user", content: "CONTINUE" }]);
      expect(await page.locator('[data-turn="1"] .reasoning[data-reasoning-status="failed"]').count()).toBe(1);
      expect(await page.locator('[data-turn="2"] .reasoning').count()).toBe(0);
      expect(await page.getByRole("alert").last().innerText()).toContain("provider");
      await page.getByRole("button", { name: "收起第 1 轮对话", exact: true }).click();
      await page.getByRole("button", { name: "展开第 1 轮对话", exact: true }).click();
      expect(await firstMessage.locator(".reasoning-head").getAttribute("aria-expanded")).toBe("true");
      expect(errors).toEqual([]);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: "reduce" });
    await page.setContent('<div id="root"></div>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js }); await settle(page);
    await event(page, { type: "generation_started", generationId: first, messageIndex: 1 });
    await save(page, [{ role: "user", content: "TASK" }, { role: "assistant", generationId: first, content: "answer **only**", reasoning: "saved first" }]);
    await event(page, { type: "reasoning_delta", generationId: first, text: "saved first" });
    await event(page, { type: "text_delta", generationId: first, text: "answer **only**" });
    await event(page, { type: "generation_finished", generationId: first, status: "completed" });
    expect(await page.locator(".reasoning").count()).toBe(1);
    expect(await page.locator(".reasoning-live").count()).toBe(0);
    expect(await page.locator(".message-author-row").innerText()).toContain("Forge");
    await page.getByRole("button", { name: "复制整段回答" }).click();
    expect(await page.evaluate(() => (window as unknown as HarnessWindow).copied)).toBe("answer **only**");
    await page.close();
  } finally { await browser.close(); }
}, 30000);
