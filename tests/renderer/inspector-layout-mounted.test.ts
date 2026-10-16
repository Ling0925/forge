import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("keeps execution details compact, navigable and diagnostics on demand", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Inspector} from './src/renderer/components/workbench/Inspector';
      import {initialWorkbenchState} from './src/renderer/state/workbench-reducer';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/styles/workspace-theme.css';
      window.diagnosticCalls=0;
      window.forge={
        getDiagnostics:async()=>{window.diagnosticCalls++;return {transcriptChars:42000,messageCount:12,projectedChars:16000}},
        listCheckpoints:async()=>[],listMcpServers:async()=>[],
        getProjectContext:async()=>({counts:{instructions:1,skills:0},instructionSources:[],skills:[],warnings:[]})
      };
      const snapshot={id:'session',status:'running',model:'provider/model-with-a-long-identifier',workspace:'/home/ling/services/desktop-harness',messages:[],events:[],changes:[],plan:{steps:[{step:'检查会话数据与执行状态',status:'completed'},{step:'验证长路径与窄屏布局',status:'in_progress'}],explanation:'真实计划说明'}};
      function Harness(){
        const [tick,setTick]=useState(0);
        window.refreshFixture=()=>setTick(tick+1);
        window.testController={state:{...initialWorkbenchState,activeSessionId:'session',activeSnapshot:{...snapshot,updatedAt:String(tick)},activeRuns:{session:{status:'running',permission:'unrestricted'}},sessions:[]},refreshActiveSession:async()=>{},selectSession:async()=>{}};
        return <div className="wb-app mobile-inspector" style={{height:'100vh',justifyContent:'flex-end'}}><Inspector onRequestCollapse={()=>{window.collapsed=true}}/></div>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "inspector.js",
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
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setContent(
          `<html data-theme="${theme}"><body><div id="root"></div></body></html>`,
        );
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: js });
        const runtime = page.getByRole("tab", { name: "运行", exact: true });
        await expect
          .poll(() => runtime.getAttribute("aria-selected"))
          .toBe("true");
        expect(
          await page.getByText("无限制", { exact: true }).isVisible(),
        ).toBe(true);
        expect(
          await page.evaluate(() => Reflect.get(window, "diagnosticCalls")),
        ).toBe(0);
        await page.getByText("上下文统计", { exact: true }).click();
        await expect
          .poll(() =>
            page.evaluate(() => Reflect.get(window, "diagnosticCalls")),
          )
          .toBe(1);
        await page.evaluate(() => Reflect.get(window, "refreshFixture")());
        expect(
          await page.evaluate(() => Reflect.get(window, "diagnosticCalls")),
        ).toBe(1);
        expect(
          await page
            .getByRole("button", { name: "压缩上下文", exact: true })
            .isDisabled(),
        ).toBe(true);
        await page.screenshot({
          path: `/tmp/forge-inspector-${width}-${theme}.png`,
        });
        await runtime.focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
        await expect
          .poll(() =>
            page
              .getByRole("tab", { name: "变更", exact: true })
              .getAttribute("aria-selected"),
          )
          .toBe("true");
        await page.getByText("文件检查点与恢复", { exact: true }).click();
        expect(
          await page.getByRole("button", { name: "刷新检查点" }).isVisible(),
        ).toBe(true);
        await page.getByRole("tab", { name: "资源", exact: true }).click();
        expect(
          await page.getByText("项目指令与技能", { exact: true }).isVisible(),
        ).toBe(true);
        await runtime.click();
        expect(
          await page.getByText("42,000 字符", { exact: false }).isVisible(),
        ).toBe(true);
        const overflow = await page
          .locator(".inspector-scroll")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(overflow).toBe(false);
        expect(errors).toEqual([]);
        await page.close();
      }
  } finally {
    await browser.close();
  }
}, 20000);
