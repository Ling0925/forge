import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";

let browser: Browser;
let js: string;
let css: string;

beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createContext,StrictMode,useContext,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {DeferredPanel} from './src/renderer/components/primitives/DeferredPanel';
      import './src/renderer/styles/global.css';
      const C=createContext(null);
      window.fixture={mode:'fail',attempts:0,renderFailure:false};
      function Panel(){
        const {open,setOpen}=useContext(C);
        const [filter,setFilter]=useState('');
        const [,render]=useState(0);
        if(window.fixture.renderFailure)throw new Error('fixture render failed');
        if(!open)return null;
        return <div role="dialog" aria-label="测试面板">
          <input aria-label="面板筛选" value={filter} onChange={e=>setFilter(e.target.value)}/>
          <button onClick={()=>{window.fixture.renderFailure=true;render(n=>n+1);}}>触发渲染失败</button>
          <button onClick={()=>setOpen(false)}>关闭面板</button>
        </div>;
      }
      const load=()=>{
        window.fixture.attempts++;
        if(window.fixture.mode==='pending')return new Promise((resolve,reject)=>{window.fixture.reject=reject;});
        if(window.fixture.mode==='fail')return Promise.reject(new Error('fixture import failed'));
        return Promise.resolve({default:Panel});
      };
      function Harness(){
        const [open,setOpen]=useState(false);
        const [draft,setDraft]=useState('');
        return <C.Provider value={{open,setOpen}}>
          <input aria-label="会话草稿" value={draft} onChange={e=>setDraft(e.target.value)}/>
          <button onClick={()=>setOpen(true)}>打开面板</button>
          <DeferredPanel open={open} label="测试面板" onClose={()=>setOpen(false)} load={load}/>
        </C.Provider>;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "deferred-panel.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
  });
  js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => { await browser?.close(); });

async function mount(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await page.getByRole("button", { name: "打开面板" }).waitFor();
  return page;
}

const attempts = (page: Page) => page.evaluate(() => Reflect.get(window, "fixture").attempts);
const setMode = (page: Page, mode: string) => page.evaluate(value => {
  Reflect.get(window, "fixture").mode = value;
}, mode);

it("retries rejected lazy loads on demand, preserving drafts and successful panel state", async () => {
  const page = await mount();
  try {
    expect(await attempts(page)).toBe(0);
    await page.getByLabel("会话草稿").fill("草稿不能丢");
    await page.getByRole("button", { name: "打开面板" }).click();
    await page.getByRole("alert").waitFor();
    expect(await attempts(page)).toBe(1);
    expect(await page.getByRole("button", { name: "刷新页面", exact: true }).isVisible()).toBe(true);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await attempts(page)).toBe(2);
    await page.getByRole("button", { name: "返回工作台" }).click();
    expect(await page.getByRole("alert").count()).toBe(0);
    expect(await attempts(page)).toBe(2);
    expect(await page.getByLabel("会话草稿").inputValue()).toBe("草稿不能丢");
    await setMode(page, "success");
    await page.getByRole("button", { name: "打开面板" }).click();
    await page.getByRole("dialog").waitFor();
    expect(await attempts(page)).toBe(3);
    await page.getByLabel("面板筛选").fill("最近七天");
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page.getByRole("button", { name: "打开面板" }).click();
    expect(await page.getByLabel("面板筛选").inputValue()).toBe("最近七天");
    expect(await attempts(page)).toBe(3);
    expect(await page.getByLabel("会话草稿").inputValue()).toBe("草稿不能丢");
  } finally { await page.close(); }
});

it("recovers if the load fails after the user has already returned to the workbench", async () => {
  const page = await mount();
  try {
    await setMode(page, "pending");
    await page.getByRole("button", { name: "打开面板" }).click();
    await page.getByRole("status").filter({ hasText: "正在加载测试面板" }).waitFor();
    await page.getByRole("button", { name: "返回工作台" }).click();
    await page.evaluate(() => Reflect.get(window, "fixture").reject(new Error("late import failure")));
    await setMode(page, "success");
    expect(await page.getByRole("alert").count()).toBe(0);
    expect(await attempts(page)).toBe(1);
    await page.getByRole("button", { name: "打开面板" }).click();
    await page.getByRole("dialog").waitFor();
    expect(await attempts(page)).toBe(2);
  } finally { await page.close(); }
});

it.each(["retry", "reopen"])("recovers from a mounted panel render error via %s", async action => {
  const page = await mount();
  try {
    await setMode(page, "success");
    await page.getByRole("button", { name: "打开面板" }).click();
    await page.getByRole("button", { name: "触发渲染失败" }).click();
    await page.getByRole("alert").waitFor();
    await page.evaluate(() => { Reflect.get(window, "fixture").renderFailure = false; });
    if (action === "retry") {
      await page.getByRole("button", { name: "重试", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "返回工作台" }).click();
      await page.getByRole("button", { name: "打开面板" }).click();
    }
    await page.getByRole("dialog").waitFor();
    expect(await attempts(page)).toBe(2);
  } finally { await page.close(); }
});
