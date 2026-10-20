import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { expect, it } from "vitest";

async function fixture(page: Page, action: string, value?: unknown) {
  await page.evaluate(({ action, value }) => (window as any).fixture[action](value), { action, value });
}

it("renders eight live child cards with isolated streams, folded tools, stable scrolling and separate reports", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {WorkbenchProvider, useWorkbench} from './src/renderer/state/workbench-context';
      import {SubAgentsPanel} from './src/renderer/components/workbench/RuntimePanels';
      import {defaultPublicSettings} from './src/shared/schemas';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/components/workbench/inspector.css';
      import './src/renderer/styles/workspace-theme.css';
      let clock=0;
      const timestamp=()=>new Date(Date.UTC(2026,0,1,14,32,clock++)).toISOString();
      const parent='11111111-1111-4111-8111-111111111111';
      const runId='22222222-2222-4222-8222-222222222222';
      const base={version:1,title:'父任务',model:'cn:deepseek-v4.1-flash',workspace:'/tmp/fixture',createdAt:timestamp(),updatedAt:timestamp(),status:'running',messages:[],events:[],changes:[]};
      const store={[parent]:{...base,id:parent}};
      const names=['实现子任务实时会话','检查消息同步','验证工具展示','回归错误状态','完善布局样式','检查会话跳转','整理最终报告','验证读取恢复'];
      for(let i=1;i<=8;i++)store['child-'+i]={...base,id:'child-'+i,parentSessionId:parent,title:names[i-1],createdAt:timestamp(),updatedAt:timestamp(),status:i<=2?'running':'completed',messages:i===1?[{role:'assistant',content:'我先检查当前的子任务卡片。',reasoning:'hidden reasoning'}]:i===2?[]:[{role:'assistant',content:'已完成检查 '+i+'。'}]};
      const listeners=new Set();
      const reads=[];
      const cancelled=[];
      let failedRead=true;
      const emit=event=>{const next={sessionId:parent,timestamp:timestamp(),...event};for(const listener of listeners)listener({runId,event:next})};
      window.forge={
        getSettings:async()=>({...defaultPublicSettings,isConfigured:true,theme:'dark'}),
        listSessions:async()=>[store[parent],...Object.values(store).filter(s=>s.id!==parent).reverse()],
        getSession:async id=>{reads.push(id);if(id==='child-8'&&failedRead)throw Error('read failed');return structuredClone(store[id])},
        onEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
        cancelSession:async id=>{cancelled.push(id);return true},
      };
      const save=({id='child-1',messages,status='running',events=[]})=>{
        store[id]={...store[id],messages,status,events,updatedAt:timestamp()};
        emit({type:'agent_update',childSessionId:id,model:base.model,status,summary:''});
      };
      window.fixture={reads,cancelled,emit,save,
        progress:({id='child-1',text,step})=>emit({type:'agent_progress',childSessionId:id,text,truncated:false,...(step?{childTurn:1,childStep:step}:{})}),
        recover:()=>{failedRead=false},
      };
      function App(){
        const controller=useWorkbench();
        window.fixture.state=()=>controller.state;
        return <><button id='select-parent' onClick={()=>controller.selectSession(parent)}>返回测试父会话</button>
          <div className='wb-app mobile-inspector' style={{height:'calc(100vh - 30px)',justifyContent:'flex-end'}}>
            <aside className='wb-inspector' style={{width:'380px',maxWidth:'100%',overflowY:'auto'}}><SubAgentsPanel/></aside>
          </div></>;
      }
      createRoot(document.getElementById('root')).render(<WorkbenchProvider><App/></WorkbenchProvider>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "subagent.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.setContent('<html data-theme="dark"><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.locator("#select-parent").click();
    await expect.poll(() => page.locator(".child-session-card").count()).toBe(8);
    const cards = page.locator(".child-session-card");
    const first = cards.nth(0);
    const second = cards.nth(1);
    expect(await first.locator(".child-title-button").textContent()).toContain("实现子任务实时会话");
    await expect.poll(() => first.locator(".child-activity-preview").textContent()).toContain("我先检查");
    expect(await second.locator(".child-activity-preview").textContent()).toBe("已启动，等待第一条消息");
    expect(await page.locator(".child-conversation-scroll").count()).toBe(0);
    expect(await cards.nth(2).locator(".child-activity-heading").textContent()).toContain("最终报告");
    await expect.poll(() => cards.nth(7).getByText("会话记录读取失败；实时预览仍会继续更新。").isVisible()).toBe(true);
    await fixture(page, "recover");
    await cards.nth(7).getByRole("button", { name: "重试读取" }).click();
    await expect.poll(() => cards.nth(7).locator(".child-activity-preview").textContent()).toContain("已完成检查 8");

    const height = (await first.boundingBox())!.height;
    const initialReads = await page.evaluate(() => (window as any).fixture.reads.length);
    await fixture(page, "progress", { text: "正在连接子任务的实时会话。" });
    await expect.poll(() => first.locator(".child-activity-preview").textContent()).toBe("正在连接子任务的实时会话。");
    await fixture(page, "progress", { text: "正在连接子任务的实时会话。" + "流式回复不会撑开其他卡片。".repeat(100) });
    await expect.poll(async () => (await first.locator(".child-activity-preview").textContent())?.length).toBe(1000);
    expect((await first.boundingBox())!.height).toBe(height);
    expect(await page.evaluate(() => (window as any).fixture.reads.length)).toBe(initialReads);
    expect(await second.locator(".child-activity-preview").textContent()).toBe("已启动，等待第一条消息");
    await first.getByRole("button", { name: "展开记录" }).click();
    const record = first.getByRole("region", { name: "子任务会话记录" });
    await expect.poll(() => record.isVisible()).toBe(true);
    expect(await record.textContent()).not.toContain("hidden reasoning");
    await fixture(page, "progress", { text: "实时回复已接入。" });
    await fixture(page, "save", { messages: [{ role: "assistant", content: "我先检查当前的子任务卡片。" }, { role: "assistant", content: "实时回复已接入。" }] });
    await expect.poll(() => record.getByText("实时回复已接入。", { exact: true }).count()).toBe(1);
    await expect.poll(() => record.locator('[data-live="true"]').count()).toBe(0);

    const call = { id: "read", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/renderer/components/workbench/RuntimePanels.tsx" }) } };
    await fixture(page, "save", { messages: [{ role: "assistant", content: "实时回复已接入。", tool_calls: [call] }], events: [
      { sessionId: "child-1", timestamp: "2026-01-01T15:00:00.000Z", type: "tool_started", call },
    ] });
    await expect.poll(() => record.locator('.tool-disclosure[data-status="running"]').count()).toBe(1);
    expect(await record.locator(".tool-disclosure-header").getAttribute("aria-expanded")).toBe("false");
    await fixture(page, "save", { messages: [
      { role: "assistant", content: "实时回复已接入。", tool_calls: [call] },
      { role: "tool", tool_call_id: "read", content: JSON.stringify({ content: "模拟读取错误，未执行写操作", isError: true }) },
    ] });
    await expect.poll(() => record.locator('.tool-disclosure[data-status="failed"]').count()).toBe(1);
    expect(await record.locator(".tool-disclosure-header").getAttribute("aria-expanded")).toBe("false");
    await record.locator(".tool-disclosure-header").click();
    await expect.poll(() => record.getByText("模拟读取错误，未执行写操作", { exact: true }).isVisible()).toBe(true);

    const history = Array.from({ length: 22 }, (_, index) => ({ role: "assistant", content: `过程记录 ${index + 1}：检查流式消息、工具状态和会话同步。` }));
    await fixture(page, "progress", { text: "" });
    await fixture(page, "save", { messages: history });
    await expect.poll(() => record.locator(".child-conversation-message").count()).toBe(22);
    const metrics = await record.evaluate(node => ({ height: node.clientHeight, scrollHeight: node.scrollHeight }));
    expect(metrics.height).toBeLessThanOrEqual(300);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.height);
    await record.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });
    const outerScroll = await page.locator(".wb-inspector").evaluate(node => node.scrollTop);
    await fixture(page, "progress", { text: "新的进展：向上阅读时不会抢走滚动位置。" });
    await expect.poll(() => first.getByRole("button", { name: "有新内容 · 回到最新" }).isVisible()).toBe(true);
    expect(await record.evaluate(node => node.scrollTop)).toBe(0);
    expect(await page.locator(".wb-inspector").evaluate(node => node.scrollTop)).toBe(outerScroll);
    expect(await second.locator(".child-conversation-scroll").count()).toBe(0);
    await first.getByRole("button", { name: "有新内容 · 回到最新" }).click();
    await expect.poll(() => record.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);
    await fixture(page, "progress", { text: "新的进展：向上阅读时不会抢走滚动位置。\n\n继续验证自动跟随。\n\n最新内容。" });
    await expect.poll(() => record.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);

    if (process.env.FORGE_SUBAGENT_SCREENSHOT) {
      await fixture(page, "progress", { text: "实时会话已经接入，接下来验证最终报告与过程记录的切换。" });
      await page.locator(".wb-inspector").evaluate(node => { node.scrollTop = 0; });
      await page.locator(".wb-inspector").screenshot({ path: process.env.FORGE_SUBAGENT_SCREENSHOT });
    }
    await fixture(page, "save", { messages: [...history, { role: "assistant", content: "最终报告：实时会话、工具详情与滚动跟随均已验证。" }], status: "completed" });
    await expect.poll(() => first.getByRole("button", { name: "展开报告" }).isVisible()).toBe(true);
    expect(await record.isVisible()).toBe(true); // Completion doesn't close the record being read.
    expect(await first.locator(".child-title-button").textContent()).toContain("实现子任务实时会话");
    await first.getByRole("button", { name: "收起记录" }).click();
    expect(await first.locator(".child-activity-preview").textContent()).toContain("最终报告：实时会话");
    await first.getByRole("button", { name: "展开报告" }).click();
    expect(await first.getByRole("region", { name: "子任务最终报告" }).textContent()).toContain("最终报告：实时会话");
    await first.getByRole("button", { name: "查看过程记录" }).click();
    expect(await record.textContent()).toContain("过程记录 1");

    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await record.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    await second.getByRole("button", { name: "取消" }).click();
    expect(await page.evaluate(() => (window as any).fixture.cancelled)).toEqual(["child-2"]);
    await first.getByRole("button", { name: "打开完整会话" }).click();
    await expect.poll(() => page.locator(".child-session-card").count()).toBe(0);
    await page.locator("#select-parent").click();
    await expect.poll(() => page.locator(".child-session-card").count()).toBe(8);
    expect(await page.locator(".child-conversation-scroll").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
