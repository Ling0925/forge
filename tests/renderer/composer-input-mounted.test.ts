import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("composer grows to six lines and latches multiline drafts into click-only sending", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
      import {createRoot} from 'react-dom/client';
      import {Composer} from './src/renderer/components/workbench/Composer';
      import {TestProvider,useWorkbench} from './src/renderer/state/workbench-context';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/styles/workspace-theme.css';
      function Harness(){const {calls,switchSession,toggleFailure,holdSend,acceptSend,finishRun}=useWorkbench();return <>
        <div className="wb-app"><Composer/></div><output id="calls">{calls}</output>
        <button onClick={switchSession}>切换</button><button onClick={toggleFailure}>切换失败</button>
        <button onClick={holdSend}>延迟发送</button><button onClick={acceptSend}>接收</button><button onClick={finishRun}>完成运行</button>
      </>}
      createRoot(document.getElementById('root')).render(<TestProvider><Harness/></TestProvider>);
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "input.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "input-state",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            resolveDir: resolve("."),
            loader: "tsx",
            contents: `
        import {createContext,useContext,useState,useRef} from 'react';
        import {defaultPublicSettings} from './src/shared/schemas';
        const Context=createContext(null);export const useWorkbench=()=>useContext(Context);
        export function TestProvider({children}){
          const [id,setId]=useState('a');const [calls,setCalls]=useState(0);
          const [failure,setFailure]=useState(false);const [runs,setRuns]=useState({});
          const hold=useRef(false);const resolveSend=useRef(null);
          const startRun=async()=>{setCalls(n=>n+1);if(failure)return false;
            if(hold.current) return new Promise(resolve=>{resolveSend.current=resolve;});
            setRuns(old=>({...old,[id]:{accepted:true,status:'completed'}}));return true;};
          return <Context.Provider value={{calls,startRun,toggleFailure:()=>setFailure(v=>!v),
            holdSend:()=>{hold.current=true;},
            acceptSend:()=>{setRuns({[id]:{accepted:true,status:'running'}});resolveSend.current?.(true);},
            cancelRun:()=>setRuns({[id]:{accepted:true,status:'running',isCancelling:true}}),
            finishRun:()=>setRuns({[id]:{accepted:true,status:'completed'}}),
            switchSession:()=>setId(v=>v==='a'?'b':'a'),selectSession:()=>{},
            state:{activeSessionId:id,activeSnapshot:{model:'provider/model',workspace:'/tmp'},sessions:[],
              settings:{...defaultPublicSettings,model:'provider/model',isConfigured:true},activeRuns:runs}}}>{children}</Context.Provider>
        }
      `,
          }));
        },
      },
    ],
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) =>
    file.path.endsWith(".css"),
  )?.text;
  if (!js || !css) throw new Error("Missing input test bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addStyleTag({
      content:
        ".wb-app{height:auto!important}body,#root{overflow:auto!important}",
    });
    await page.addScriptTag({ content: js });
    const input = page.locator("textarea.composer-textarea");
    const calls = () => page.locator("#calls").innerText();
    await input.fill("hello");
    expect((await input.boundingBox())?.height).toBe(36);
    await input.press("Enter");
    await expect.poll(calls).toBe("1");
    await expect.poll(() => input.inputValue()).toBe("");
    await input.fill("one");
    await input.press("Shift+Enter");
    await input.press("Enter");
    expect(await input.inputValue()).toBe("one\n\n");
    expect(await calls()).toBe("1");
    await input.fill("one");
    await page.getByRole("button", { name: "切换", exact: true }).click();
    await input.fill("other");
    await input.press("Enter");
    await expect.poll(calls).toBe("2");
    await page.getByRole("button", { name: "切换", exact: true }).click();
    await input.press("Enter");
    expect(await input.inputValue()).toBe("one\n");
    await input.press("Control+Enter");
    expect(await calls()).toBe("2");
    await input.fill(
      Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"),
    );
    const geometry = await input.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        height: node.getBoundingClientRect().height,
        limit:
          Number.parseFloat(style.lineHeight) * 6 +
          Number.parseFloat(style.paddingTop) +
          Number.parseFloat(style.paddingBottom),
        scroll: node.scrollHeight,
        overflow: style.overflowY,
      };
    });
    expect(geometry.height).toBeGreaterThan(100);
    expect(geometry.height).toBeLessThanOrEqual(geometry.limit + 1);
    expect(geometry.scroll).toBeGreaterThan(geometry.height);
    expect(geometry.overflow).toBe("auto");
    await page.screenshot({ path: "/tmp/forge-input-six-lines.png" });
    await page.getByRole("button", { name: "切换失败", exact: true }).click();
    await page.getByRole("button", { name: "运行", exact: true }).click();
    await expect.poll(calls).toBe("3");
    await input.press("Enter");
    expect(await calls()).toBe("3");
    await page.getByRole("button", { name: "切换失败", exact: true }).click();
    await page.getByRole("button", { name: "运行", exact: true }).click();
    await expect.poll(() => input.inputValue()).toBe("");
    expect((await input.boundingBox())?.height).toBe(36);
    await input.fill("IME");
    await input.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    expect(await calls()).toBe("4");
    await input.press("Enter");
    await expect.poll(calls).toBe("5");
    await expect.poll(() => input.inputValue()).toBe("");
    await page.getByRole("button", { name: "延迟发送", exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await input.fill("animation check");
      await page.evaluate(async () => {
        await Promise.all(
          document.getAnimations().map((animation) => animation.finished),
        );
      });
      const action = page.locator(".composer-action");
      const initial = await action.boundingBox();
      const formHeight = await page
        .locator("form")
        .evaluate((node) => node.getBoundingClientRect().height);
      await action.click();
      await expect.poll(() => action.getAttribute("aria-busy")).toBe("true");
      for (const reducedMotion of ["no-preference", "reduce"] as const) {
        await page.emulateMedia({ reducedMotion });
        const spinner = action.locator(".btn-spinner");
        await spinner.waitFor();
        const centered = await spinner.evaluate((node) => {
          const icon = node.getBoundingClientRect();
          const parent = node.closest("button");
          if (!parent) throw new Error("Missing spinner button");
          const button = parent.getBoundingClientRect();
          return (
            Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2) +
            Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2)
          );
        });
        expect(centered).toBeLessThan(1);
        expect(await action.boundingBox()).toEqual(initial);
      }
      expect(await page.locator(".composer-status").count()).toBe(0);
      expect(
        await page
          .locator("form")
          .evaluate((node) => node.getBoundingClientRect().height),
      ).toBe(formHeight);
      await page.screenshot({ path: `/tmp/forge-send-${width}.png` });
      await page.getByRole("button", { name: "接收", exact: true }).click();
      await expect.poll(() => action.getAttribute("aria-label")).toBe("取消");
      expect(await action.boundingBox()).toEqual(initial);
      await action.click();
      await expect.poll(() => action.getAttribute("aria-busy")).toBe("true");
      expect(await action.boundingBox()).toEqual(initial);
      await page.getByRole("button", { name: "完成运行", exact: true }).click();
      await expect.poll(() => action.getAttribute("aria-label")).toBe("运行");
      expect(await action.boundingBox()).toEqual(initial);
    }
  } finally {
    await browser.close();
  }
}, 20000);
