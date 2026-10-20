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
        getProjectContext:async()=>({counts:{instructions:1,skills:0},instructionSources:[],skills:[],warnings:[]}),
        listWorkspaceEntries:async({path}={})=>({
          workspace:'/home/ling/services/desktop-harness',
          path:path&&path!=='.'?path:'.',
          parentPath:path&&path!=='.'?'.':null,
          entries:path==='src'
            ? [{name:'Inspector.tsx',path:'src/Inspector.tsx',kind:'file',sizeBytes:128,updatedAt:'2026-01-01T00:00:00.000Z'}]
            : [{name:'src',path:'src',kind:'directory',updatedAt:'2026-01-01T00:00:00.000Z'},{name:'README.md',path:'README.md',kind:'file',sizeBytes:64,updatedAt:'2026-01-01T00:00:00.000Z'}],
          truncated:false
        }),
        readWorkspaceFile:async({path})=>({
          path,
          sizeBytes:64,
          binary:false,
          truncated:false,
          content:'# Workspace Preview Content'
        })
      };
      const snapshot={
        id:'session',
        status:'running',
        model:'provider/model-with-a-long-identifier',
        workspace:'/home/ling/services/desktop-harness',
        messages:[
          {id:'msg-1',role:'user',content:'初始简短摘要但包含完整背景说明：需要把右侧面板的折叠项默认展开，并支持点击展开截断内容。',timestamp:'2026-01-01T00:00:00.000Z'}
        ],
        events:[],
        changes:[],
        contextSummary:{
          boundary:1,
          fallback:true,
          content:'Local run-end checkpoint; partial observations, NOT a verified semantic summary. All original records m1..m1 remain available.\\n' + JSON.stringify({
            status:'completed',
            endedAt:'2026-01-01T00:05:00.000Z',
            initialRequest:{ref:'m1',text:JSON.stringify({role:'user',content:'初始简短摘要'}),truncated:true},
            latestRequest:null,
            latestAssistantReport:null,
            planExcerpt:null,
            priorMemoryExcerpt:null,
            toolObservations:[],
            effectsMayBeUncertain:false
          })
        },
        plan:{steps:[{step:'检查会话数据与执行状态',status:'completed'},{step:'验证长路径与窄屏布局',status:'in_progress'},{step:'清理临时输出并汇总',status:'pending'}],explanation:'真实计划说明'}
      };
      const childSessions=[
        {id:'child-1',parentSessionId:'session',title:'独立子代理：收集仓库结构与测试配置并输出简要结论',status:'completed',model:'cbcn/deepseek-v4.1-flash',workspace:'/home/ling/services/desktop-harness',createdAt:'2026-01-01T00:01:00.000Z',updatedAt:'2026-01-01T00:02:00.000Z',latestReport:'已完成目录扫描与配置核对。'}
      ];
      function Harness(){
        const [tick,setTick]=useState(0);
        window.refreshFixture=()=>setTick(tick+1);
        window.testController={state:{...initialWorkbenchState,activeSessionId:'session',activeSnapshot:{...snapshot,updatedAt:String(tick)},activeRuns:{session:{status:'running',permission:'unrestricted'}},sessions:childSessions},refreshActiveSession:async()=>{},selectSession:async()=>{}};
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
        const runtime = page.getByRole("tab", {
          name: "计划与进度",
          exact: true,
        });
        await expect
          .poll(() => runtime.getAttribute("aria-selected"))
          .toBe("true");
        expect(
          await page
            .getByText("检查会话数据与执行状态", { exact: true })
            .isVisible(),
        ).toBe(true);
        // Verify PlanSteps pending item circle and inline title row
        const stepMetrics = await page.evaluate(() => {
          const list = document.querySelector(".wb-plan-progress");
          const pending = document.querySelector(
            ".wb-plan-progress .plan-pending",
          );
          const titleRow = document.querySelector(
            ".inspector-plan-progress-panel .inspector-title-row",
          );
          const listStyle = list ? getComputedStyle(list) : null;
          const pendingStyle = pending ? getComputedStyle(pending) : null;
          const pendingRect = pending?.getBoundingClientRect();
          const titleRowStyle = titleRow ? getComputedStyle(titleRow) : null;
          return {
            gap: listStyle?.rowGap ?? listStyle?.gap,
            pendingWidth: pendingRect?.width ?? 0,
            pendingHeight: pendingRect?.height ?? 0,
            pendingBorderWidth: pendingStyle?.borderTopWidth ?? "0px",
            pendingBorderColor: pendingStyle?.borderTopColor ?? "",
            titleRowDisplay: titleRowStyle?.display ?? "",
          };
        });
        expect(stepMetrics.gap).toBe("0px");
        expect(stepMetrics.pendingWidth).toBe(14);
        expect(stepMetrics.pendingHeight).toBe(14);
        expect(Number.parseFloat(stepMetrics.pendingBorderWidth)).toBeGreaterThan(
          0,
        );
        expect(stepMetrics.pendingBorderColor).not.toBe("rgba(0, 0, 0, 0)");
        expect(stepMetrics.titleRowDisplay).toBe("flex");
        await page.screenshot({
          path: `/tmp/forge-inspector-plan-${width}-${theme}.png`,
        });
        await page.getByRole("tab", { name: "Plan", exact: true }).click();
        expect(
          await page.getByText("真实计划说明", { exact: true }).isVisible(),
        ).toBe(true);
        await page.getByRole("tab", { name: "计划进度", exact: true }).click();
        await runtime.focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
        await expect
          .poll(() =>
            page
              .getByRole("tab", { name: "文件", exact: true })
              .getAttribute("aria-selected"),
          )
          .toBe("true");
        expect(
          await page.getByText("工作区文件", { exact: true }).isVisible(),
        ).toBe(true);
        await page.getByText("README.md", { exact: true }).click();
        expect(
          await page
            .getByText("# Workspace Preview Content", { exact: true })
            .isVisible(),
        ).toBe(true);
        await page
          .getByRole("tab", { name: "变更与检查点", exact: true })
          .click();
        expect(
          await page.getByRole("button", { name: "刷新检查点" }).isVisible(),
        ).toBe(true);
        expect(
          await page.evaluate(() => Reflect.get(window, "diagnosticCalls")),
        ).toBe(0);
        await page.getByRole("tab", { name: "会话信息", exact: true }).click();
        expect(
          await page.getByText("无限制", { exact: true }).isVisible(),
        ).toBe(true);
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
        expect(
          await page.getByText("42,000 字符", { exact: false }).isVisible(),
        ).toBe(true);
        // Memory card is open by default and truncated excerpt expands on click
        expect(
          await page.getByText("初始简短摘要", { exact: true }).isVisible(),
        ).toBe(true);
        await page
          .getByRole("button", { name: "已截断 · 点击展开", exact: true })
          .click();
        expect(
          await page
            .getByText("需要把右侧面板的折叠项默认展开", { exact: false })
            .isVisible(),
        ).toBe(true);
        await page.screenshot({
          path: `/tmp/forge-inspector-${width}-${theme}.png`,
        });
        await page.getByRole("tab", { name: "项目资源", exact: true }).click();
        expect(
          await page.getByText("项目指令与技能", { exact: true }).isVisible(),
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
