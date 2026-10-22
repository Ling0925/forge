import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { reviewSession } from "../fixtures/review-session";

type ReviewCall = { prompt: string; permission: string; model: string | null; sessionId: string; mode: string; sourceId: string | null; images: unknown; routeGroupId: string | null };

it("renders /review and submits the chosen model/source or route without changing composer settings", async () => {
  const snapshot = reviewSession({ workspace: "/fixture", providerSourceId: "source-a" });
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {Composer} from './src/renderer/components/workbench/Composer';
      import {FixtureProvider} from './src/renderer/state/workbench-context';
      window.calls=[]; window.reads=0; window.accept=true;
      window.forge={listModels:async()=>['session-model','picked-model'],
        getSession:async(id)=>{window.reads++; if(window.hold) await new Promise(resolve=>window.release=resolve); return {...${JSON.stringify(snapshot)},id};}};
      createRoot(document.getElementById('root')).render(<FixtureProvider><Composer/></FixtureProvider>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "test.js",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "fixture", setup(api) {
      api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({ loader: "tsx", resolveDir: resolve("."), contents: `
        import {createContext,useContext,useState} from 'react';
        import {defaultPublicSettings} from './src/shared/schemas';
        const Context=createContext(null);
        export const useWorkbench=()=>useContext(Context);
        export function FixtureProvider({children}) {
          const [id,setId]=useState('${snapshot.id}'); window.selectSession=setId;
          const [route,setRoute]=useState(false); window.useRoute=()=>setRoute(true);
          const sources=['a','b'].map(suffix=>({id:'source-'+suffix,label:'Source '+suffix,baseUrl:'https://fixture.invalid',hasApiKey:false,
            model:suffix==='a'?'session-model':'picked-model',apiMode:'chat-completions'}));
          const state={activeSessionId:id,activeSnapshot:{...${JSON.stringify(snapshot)},id,...(route?{routeGroupId:'route-a'}:{})},sessions:[],activeRuns:{},
            settings:{...defaultPublicSettings,isConfigured:true,model:'global-model',providerSources:sources,
              routeGroups:[{id:'route-a',label:'Review route',strategy:'order',members:[{sourceId:'source-b',model:'picked-model'}]}]}};
          const startRun=async(prompt,permission,model,sessionId,mode,sourceId,images,routeGroupId)=>{
            window.calls.push({prompt,permission,model:model??null,sessionId,mode,sourceId:sourceId??null,images:images??null,routeGroupId:routeGroupId??null});
            return window.accept;
          };
          return <Context.Provider value={{state,startRun,dispatch:()=>{},loadSessions:async()=>{},updateSettings:async()=>({ok:true})}}>{children}</Context.Provider>;
        }
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text });
    const input = page.locator("textarea");
    const calls = () => page.evaluate(() => (window as unknown as { calls: ReviewCall[] }).calls);
    const output = () => page.locator(".composer-slash-message").innerText();
    await input.fill("/model picked-model");
    await input.press("Enter");
    await expect.poll(output).toBe("Model: picked-model");
    await input.fill("/mode plan");
    await input.press("Enter");
    await expect.poll(() => page.locator("#run-mode").inputValue()).toBe("plan");
    await input.fill("/rev");
    await expect.poll(() => page.getByRole("option").locator("strong").allTextContents()).toEqual(["/review"]);
    await input.press("Tab");
    expect(await input.inputValue()).toBe("/review");
    await input.fill("/review 重点检查权限");
    await input.press("Enter");
    await expect.poll(async () => (await calls()).length).toBe(1);
    await expect.poll(() => input.inputValue()).toBe("");
    expect((await calls())[0]).toMatchObject({ model: "picked-model", sourceId: "source-b", sessionId: snapshot.id, mode: "build", permission: "readonly", images: null, routeGroupId: null });
    expect((await calls())[0]?.prompt).toContain("重点检查权限");
    expect((await calls())[0]?.prompt).toContain("src/example.ts");
    expect(await page.locator("#run-mode").inputValue()).toBe("plan");
    expect(await page.locator("#run-permission").inputValue()).toBe("readonly");
    await input.fill("/mode build");
    await input.press("Enter");
    await expect.poll(() => page.locator("#run-permission").inputValue()).toBe("workspace");

    // A failed start retains the command and is not automatically replayed.
    await page.evaluate(() => { (window as unknown as { accept: boolean }).accept = false; });
    await input.fill("/review");
    await input.press("Enter");
    await expect.poll(output).toContain("草稿已保留");
    expect(await input.inputValue()).toBe("/review");
    expect(await calls()).toHaveLength(2);

    // Switching away while the full transcript is loading must not start work
    // in the old or new session. A second Enter must not duplicate the read.
    await page.evaluate(() => { const w = window as unknown as { accept: boolean; hold: boolean }; w.accept = true; w.hold = true; });
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(3);
    await input.dispatchEvent("keydown", { key: "Enter" });
    await page.evaluate(() => (window as unknown as { selectSession(id: string): void }).selectSession("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    await expect.poll(() => input.getAttribute("id")).toContain("bbbbbbbb");
    await page.evaluate(() => { const w = window as unknown as { hold: boolean; release(): void }; w.hold = false; w.release(); });
    await page.evaluate(id => (window as unknown as { selectSession(id: string): void }).selectSession(id), snapshot.id);
    await expect.poll(output).toContain("会话已切换");
    expect(await calls()).toHaveLength(2);

    // A fresh draft with a selected route submits that route, not a stale model.
    await page.evaluate(() => {
      const w = window as unknown as { selectSession(id: string): void; useRoute(): void };
      w.useRoute(); w.selectSession("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    });
    await input.fill("/review");
    await page.getByRole("option").click();
    await expect.poll(async () => (await calls()).length).toBe(3);
    expect((await calls())[2]).toMatchObject({ model: null, sourceId: null, routeGroupId: "route-a", permission: "readonly", mode: "build", sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30_000);
