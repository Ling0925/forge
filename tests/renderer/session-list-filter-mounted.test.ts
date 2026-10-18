import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("hides children from sidebar, search, palette and counts while retaining task navigation", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."), loader: "tsx", contents: `
        import {createRoot} from 'react-dom/client';
        import {Sidebar} from './src/renderer/components/workbench/Sidebar';
        import {Welcome} from './src/renderer/components/workbench/Welcome';
        import {CommandPalette} from './src/renderer/components/workbench/CommandPalette';
        import {ChangeSessionNavigation} from './src/renderer/components/workbench/ChangeSessionNavigation';
        const root=createRoot(document.getElementById('root'));
        window.render=()=>root.render(<><Sidebar/><Welcome/><CommandPalette/>
          <div id="task-navigation"><ChangeSessionNavigation sessionId="parent" sessions={window.sessions} onOpenChanges={()=>{}}/></div>
        </>);
        window.render();
      `,
    },
    bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" },
    plugins: [{
      name: "session-state",
      setup(api) {
        api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
          loader: "js", contents: `
            export const useWorkbench=()=>({state:{sessions:window.sessions,activeRuns:{},settings:{isConfigured:true}},
              openNewSession:()=>{},openSettings:()=>{},setMobileSidebar:()=>{},selectSession:()=>{},refreshActiveSession:()=>{}});
          `,
        }));
      },
    }],
  });
  const js = bundle.outputFiles[0]?.text;
  if (!js) throw new Error("Missing test bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => {
      const base = { version: 1, model: "test", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", status: "completed" };
      Object.assign(window, { sessions: [
        { ...base, id: "child", parentSessionId: "parent", title: "Internal child", workspace: "/tmp/child-only" },
        { ...base, id: "parent", title: "Main session", workspace: "/tmp/main" },
        { ...base, id: "archived", title: "Archived main", workspace: "/tmp/main", archived: true },
      ] });
    });
    await page.addScriptTag({ content: js });
    const sidebar = page.getByRole("complementary", { name: "会话与导航" });
    await sidebar.getByRole("button", { name: "Main session", exact: true }).waitFor();
    expect(await sidebar.innerText()).not.toContain("Internal child");
    expect(await sidebar.innerText()).not.toContain("child-only");
    expect(await sidebar.locator(".session-folder-count").allTextContents()).toEqual(["1"]);
    expect(await page.locator(".welcome-metrics dd").allTextContents()).toEqual(["1", "1"]);
    expect(await page.locator("#task-navigation").innerText()).toContain("Internal child");

    await sidebar.getByTitle("显示归档会话").click();
    await sidebar.getByRole("button", { name: "归档 · Archived main", exact: true }).waitFor();
    expect(await sidebar.innerText()).not.toContain("Internal child");
    await sidebar.getByRole("textbox", { name: "搜索会话" }).fill("Internal child");
    await sidebar.getByText("没有匹配的任务").waitFor();
    await sidebar.getByRole("textbox", { name: "搜索会话" }).fill("");

    await page.getByRole("button", { name: "命令 · Ctrl/Cmd K" }).click();
    const palette = page.getByRole("dialog", { name: "命令与会话导航" });
    await palette.getByRole("button", { name: "打开会话 · Main session", exact: true }).waitFor();
    expect(await palette.innerText()).not.toContain("Internal child");
    await palette.getByRole("button", { name: "关闭面板" }).click();

    await page.evaluate(() => {
      const host = window as unknown as { sessions: { parentSessionId?: string }[]; render: () => void };
      host.sessions = host.sessions.filter(session => session.parentSessionId);
      host.render();
    });
    await sidebar.getByText("暂无历史任务").waitFor();
    expect(await page.locator(".welcome-metrics dd").allTextContents()).toEqual(["0", "0"]);
  } finally {
    await browser.close();
  }
});
