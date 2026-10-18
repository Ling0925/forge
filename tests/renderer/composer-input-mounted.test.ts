import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("composer grows to six lines and requires explicit submission for multiline drafts", async () => {
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
      import './src/renderer/styles/settings-models.css';
      function Harness(){const {calls,switchSession,toggleFailure,holdSend,acceptSend,finishRun,awaitApproval,saveEffort,failEffort}=useWorkbench();return <>
        <div className="wb-app"><Composer/></div><output id="calls">{calls}</output>
        <button onClick={switchSession}>切换</button><button onClick={toggleFailure}>切换失败</button>
        <button onClick={holdSend}>延迟发送</button><button onClick={acceptSend}>接收</button><button onClick={finishRun}>完成运行</button>
        <button onClick={awaitApproval}>等待批准</button>
        <button onClick={saveEffort}>保存等级</button><button onClick={failEffort}>保存等级失败</button>
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
          const [effort,setEffort]=useState('default');const pendingEffort=useRef(null);
          const startRun=async()=>{setCalls(n=>n+1);if(failure)return false;
            if(hold.current) return new Promise(resolve=>{resolveSend.current=resolve;});
            setRuns(old=>({...old,[id]:{accepted:true,status:'completed'}}));return true;};
          return <Context.Provider value={{calls,startRun,toggleFailure:()=>setFailure(v=>!v),
            updateSettings:({settings})=>new Promise(resolve=>{pendingEffort.current={value:settings.reasoningEffort,resolve};}),
            saveEffort:()=>{setEffort(pendingEffort.current.value);pendingEffort.current.resolve(true);},
            failEffort:()=>pendingEffort.current.resolve(false),
            holdSend:()=>{hold.current=true;},
            acceptSend:()=>{setRuns({[id]:{accepted:true,status:'running',permission:'workspace'}});resolveSend.current?.(true);},
            awaitApproval:()=>setRuns({[id]:{accepted:true,status:'awaiting_approval',permission:'workspace'}}),
            setRunPermission:async(permission)=>{setRuns(old=>({...old,[id]:{...old[id],permission}}));return true;},
            cancelRun:()=>setRuns({[id]:{accepted:true,status:'running',isCancelling:true}}),
            finishRun:()=>setRuns({[id]:{accepted:true,status:'completed'}}),
            switchSession:()=>setId(v=>v==='a'?'b':'a'),selectSession:()=>{},
            state:{activeSessionId:id,activeSnapshot:{id,model:'provider/model',workspace:'/tmp',events:[
                {type:'run_started',timestamp:'2026-01-01T00:00:00Z'},
                {type:'run_finished',timestamp:'2026-01-01T00:00:10Z',usage:{promptTokens:100,completionTokens:200,totalTokens:300},usageComplete:true}
              ]},sessions:[],
              settings:{...defaultPublicSettings,model:'provider/model',isConfigured:true,reasoningEffort:effort},activeRuns:runs}}}>{children}</Context.Provider>
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
    page.setDefaultTimeout(3000);
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addStyleTag({
      content:
        ".wb-app{height:auto!important;padding-top:400px}body,#root{overflow:auto!important}",
    });
    await page.addScriptTag({ content: js });
    const input = page.locator("textarea.composer-textarea");
    const calls = () => page.locator("#calls").innerText();
    await expect.poll(() => page.locator(".composer-output-speed").innerText()).toBe("平均 20 tok/s");
    await input.fill("hello");
    expect((await input.boundingBox())?.height).toBe(36);
    await input.press("Enter");
    await expect.poll(calls).toBe("1");
    await expect.poll(() => input.inputValue()).toBe("");
    const trigger = page.locator(".composer-model-summary");
    await trigger.click();
    const slider = page.getByRole("slider", { name: "思考等级", exact: true });
    const setSlider = async (val: string) => {
      await slider.evaluate((node: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(node, value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
      }, val);
      await slider.dispatchEvent("pointerup");
    };
    await setSlider("5");
    expect(await slider.getAttribute("aria-valuetext")).toBe("高");
    await input.fill("wait for effort");
    expect(
      await page
        .getByRole("button", { name: "运行", exact: true })
        .isDisabled(),
    ).toBe(true);
    await input.press("Enter");
    expect(await calls()).toBe("1");
    await page.getByRole("button", { name: "保存等级", exact: true }).click();
    await expect.poll(() => page.locator(".model-effort-meter").getAttribute("aria-label")).toContain("高");
    await trigger.click();
    await setSlider("3");
    expect(await slider.getAttribute("aria-valuetext")).toBe("低");
    await page
      .getByRole("button", { name: "保存等级失败", exact: true })
      .click();
    await expect
      .poll(() => page.getByRole("alert").innerText())
      .toBe("思考等级保存失败，请重试。");
    expect(await page.locator(".model-effort-meter").getAttribute("aria-label")).toContain("高");
    await trigger.click();
    await expect.poll(() => slider.getAttribute("aria-valuetext")).toBe("高");
    await slider.press("Home");
    await page.getByRole("button", { name: "保存等级", exact: true }).click();
    await expect.poll(() => page.locator(".model-effort-meter").getAttribute("aria-label")).toContain("自动");
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
    await expect.poll(calls).toBe("3");
    await expect.poll(() => input.inputValue()).toBe("");
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
    await expect.poll(calls).toBe("4");
    await input.press("Enter");
    expect(await calls()).toBe("4");
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
    expect(await calls()).toBe("5");
    await input.press("Enter");
    await expect.poll(calls).toBe("6");
    await expect.poll(() => input.inputValue()).toBe("");
    await page.getByRole("button", { name: "延迟发送", exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const speedBounds = await page.locator(".composer-output-speed").boundingBox();
      expect(speedBounds?.x).toBeGreaterThanOrEqual(0);
      expect(speedBounds!.x + speedBounds!.width).toBeLessThanOrEqual(width);
      expect(await page.locator(".composer-output-speed").innerText()).toBe("平均 20 tok/s");
      await trigger.click();
      const panel = page.locator(".composer-model-panel");
      await panel.waitFor();
      await panel.evaluate(async (node) => {
        await Promise.all(
          node.getAnimations().map((animation) => animation.finished),
        );
      });
      const panelBounds = await panel.boundingBox();
      if (!panelBounds) throw new Error("Missing effort panel");
      expect(panelBounds.x).toBeGreaterThanOrEqual(0);
      expect(panelBounds.y).toBeGreaterThanOrEqual(0);
      expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(width);
      const sliderInPanel = page.getByRole("slider", { name: "思考等级", exact: true });
      expect(
        await sliderInPanel.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return node.contains(
            document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            ),
          );
        }),
      ).toBe(true);
      await page.screenshot({ path: `/tmp/forge-effort-${width}.png` });
      await page.keyboard.press("Escape");
      expect(await page.locator(".composer-model-picker").getAttribute("open")).toBe(null);
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
      const activeBox = await action.boundingBox();
      expect(activeBox?.y).toBeGreaterThan(initial.y);
      const activity = page.locator(".composer-activity");
      expect(await activity.innerText()).toContain("正在执行");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const bar = activity.locator(".composer-activity-bars > span").first();
      const frames = await bar.evaluate((node) => {
        const animation = node.getAnimations()[0];
        if (!animation) throw new Error("Missing activity animation");
        animation.pause();
        animation.currentTime = 0;
        const first = getComputedStyle(node).transform;
        animation.currentTime = 600;
        const second = getComputedStyle(node).transform;
        animation.play();
        return [first, second];
      });
      expect(frames[0]).not.toBe(frames[1]);
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await page
          .locator("form")
          .screenshot({ path: `/tmp/forge-activity-${width}-${theme}.png` });
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await bar.evaluate((node) => getComputedStyle(node).animationName),
      ).toBe("none");
      await page.getByRole("button", { name: "等待批准", exact: true }).click();
      expect(await activity.innerText()).toBe("等待审批");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      expect(
        await bar.evaluate((node) => getComputedStyle(node).animationName),
      ).toBe("none");
      await page.getByRole("button", { name: "接收", exact: true }).click();
      await page.getByRole("button", { name: "执行权限", exact: true }).click();
      await page.getByRole("menuitemradio", { name: /^无限制/ }).click();
      await expect
        .poll(() =>
          page
            .getByRole("button", { name: "执行权限", exact: true })
            .getAttribute("title"),
        )
        .toBe("执行权限：无限制");
      await page.getByRole("button", { name: "执行权限", exact: true }).click();
      await page.getByRole("menuitemradio", { name: /^工作区/ }).click();
      await expect
        .poll(() =>
          page
            .getByRole("button", { name: "执行权限", exact: true })
            .getAttribute("title"),
        )
        .toBe("执行权限：工作区");
      await action.click();
      await expect.poll(() => action.getAttribute("aria-busy")).toBe("true");
      expect((await action.boundingBox())?.y).toBe(activeBox?.y);
      expect(await activity.innerText()).toBe("正在停止");
      await page.getByRole("button", { name: "完成运行", exact: true }).click();
      await expect.poll(() => action.getAttribute("aria-label")).toBe("运行");
      await expect.poll(async () => (await action.boundingBox())?.y).toBe(initial.y);
      expect(await action.boundingBox()).toEqual(initial);
      expect(await activity.count()).toBe(0);
    }
  } finally {
    await browser.close();
  }
}, 20000);
