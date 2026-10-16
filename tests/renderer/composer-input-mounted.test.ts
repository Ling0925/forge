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
      function Harness(){const {calls,switchSession,toggleFailure}=useWorkbench();return <>
        <div className="wb-app"><Composer/></div><output id="calls">{calls}</output>
        <button onClick={switchSession}>切换</button><button onClick={toggleFailure}>切换失败</button>
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
        import {createContext,useContext,useState} from 'react';
        import {defaultPublicSettings} from './src/shared/schemas';
        const Context=createContext(null);export const useWorkbench=()=>useContext(Context);
        export function TestProvider({children}){
          const [id,setId]=useState('a');const [calls,setCalls]=useState(0);
          const [failure,setFailure]=useState(false);const [runs,setRuns]=useState({});
          const startRun=async()=>{setCalls(n=>n+1);if(failure)return false;
            setRuns(old=>({...old,[id]:{accepted:true,status:'completed'}}));return true;};
          return <Context.Provider value={{calls,startRun,toggleFailure:()=>setFailure(v=>!v),
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
  } finally {
    await browser.close();
  }
}, 20000);
