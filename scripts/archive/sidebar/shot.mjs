// Temporary visual capture of the redesigned sidebar folder list.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const sessions = [
  [
    "11111111-1111-4111-8111-111111111111",
    "重构认证中间件并把所有遗留的会话缓存迁移到新的索引结构同时补齐回归测试与文档",
    "/home/ling/services/desktop-harness",
    "2026-02-02T10:32:00.000Z",
  ],
  [
    "22222222-2222-4222-8222-222222222222",
    "修复登录页在窄屏下的布局抖动",
    "/home/ling/services/desktop-harness",
    "2026-02-02T09:05:00.000Z",
  ],
  [
    "33333333-3333-4333-8333-333333333333",
    "补齐 LSP 工具的重连回归测试",
    "/home/ling/services/desktop-harness",
    "2026-02-01T18:20:00.000Z",
  ],
  [
    "44444444-4444-4444-8444-444444444444",
    "调研浏览器工具的会话隔离方案并输出对比报告",
    "/home/ling/projects/experiments/very-deep-folder-name",
    "2026-01-30T11:00:00.000Z",
  ],
  [
    "55555555-5555-4555-8555-555555555555",
    "文档校对",
    "/tmp/scratch",
    "2026-01-28T08:00:00.000Z",
  ],
];

const bundle = await build({
  stdin: {
    resolveDir: resolve("."),
    loader: "tsx",
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/components/workbench/workbench.css';
      import {Sidebar} from './src/renderer/components/workbench/Sidebar';
      const mk = ([id, title, workspace, updatedAt]) => ({version:1,id,title,workspace,
        model:'cbcn/deepseek-v4.1-flash',status:'completed',
        createdAt:'2026-01-01T00:00:00.000Z',updatedAt});
      const sessions = ${JSON.stringify(sessions)}.map(mk);
      window.testController = {
        state:{activeSessionId:sessions[0].id, activeSnapshot:sessions[0], sessions,
          activeRuns:{}, settings:{model:'x',isConfigured:true}, alertError:null,
          isSessionsLoading:false, isNewSessionOpen:false, isMobileSidebarOpen:false,
          mobileTab:'task'},
        selectSession:()=>{},refreshActiveSession:()=>{},answerApproval:()=>{},
        openNewSession:()=>{},openSettings:()=>{},setMobileTab:()=>{},
        setMobileSidebar:()=>{},clearAlert:()=>{},loadSettings:()=>{},loadSessions:()=>{}};
      createRoot(document.getElementById('root')).render(<div className="workbench wb-app"><Sidebar/></div>);
    `,
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  outfile: "shot.js",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "fonts",
      setup(api) {
        api.onResolve({ filter: /^@fontsource-variable\// }, (a) => ({
          path: a.path,
          namespace: "f",
        }));
        api.onLoad({ filter: /.*/, namespace: "f" }, () => ({
          contents: "",
          loader: "css",
        }));
      },
    },
    {
      name: "ctl",
      setup(api) {
        api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
          contents: "export function useWorkbench(){return window.testController;}",
          loader: "js",
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith("shot.js")).text;
const css = bundle.outputFiles.find((f) => f.path.endsWith("shot.css")).text;

const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORGE_BROWSER_EXECUTABLE
    ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
    : {}),
});
try {
  await mkdir(".build/sidebar-qa", { recursive: true });
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 760 },
        deviceScaleFactor: 2,
      });
      await page.setContent(`<div id="root" data-theme="${theme}"></div>`);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: js });
      await page.waitForSelector(".session-folder-header");
      await page.waitForTimeout(120);
      const sidebar = page.locator(".workbench-sidebar");
      await sidebar.screenshot({
        path: `.build/sidebar-qa/sidebar-${theme}-${width}.png`,
      });
      console.log(`captured .build/sidebar-qa/sidebar-${theme}-${width}.png`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
