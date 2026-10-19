import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("sidebar hides completed dots and inline metadata, loads honest usage on hover", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
      import {createRoot} from 'react-dom/client';
      import {SessionListItem} from './src/renderer/components/workbench/SessionListItem';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/workbench.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/styles/workspace-theme.css';
      import './src/renderer/styles/sidebar-compact.css';
      const base={version:1,workspace:'/tmp/project',model:'provider/model-id',createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T01:00:00Z'};
      const sessions=[{...base,id:'done',title:'完成的会话',status:'completed'},
        {...base,id:'running',title:'执行中的会话',status:'running'},
        {...base,id:'pending',title:'等待批准的会话',status:'completed'}];
      window.forge={getSession:async id=>{
        document.body.dataset.reads=String(Number(document.body.dataset.reads||0)+1);
        return {...base,events:id==='done'?[{type:'run_started',model:'provider/actual-model'},
          {type:'run_finished',usage:{totalTokens:1200},usageComplete:true},
          {type:'run_finished',usage:{totalTokens:300},usageComplete:false}]:[]};
      }};
      createRoot(document.getElementById('root')).render(<div className="wb-app"><aside className="workbench-sidebar">
        {sessions.map(session=><SessionListItem key={session.id} session={session}/>)}
      </aside></div>);
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "sidebar.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "sidebar-state",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            loader: "js",
            contents: `
        export const useWorkbench=()=>({state:{activeRuns:{pending:{pendingApproval:{}}},activeSessionId:'done',isNewSessionOpen:false},
          selectSession:id=>{document.body.dataset.selected=id},setMobileSidebar:()=>{}});
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
  if (!js || !css) throw new Error("Missing test bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    const done = page.getByRole("button", { name: "完成的会话", exact: true });
    await done.waitFor();
    expect(await done.locator(".wb-status-dot").count()).toBe(0);
    expect(await page.locator(".wb-status-dot").count()).toBe(2);
    expect(await page.locator(".session-item-time").count()).toBe(0);
    expect(await page.locator("body").getAttribute("data-reads")).toBeNull();
    await done.hover();
    await page.getByRole("tooltip").getByText("1,500（部分统计）").waitFor();
    expect(await page.getByRole("tooltip").innerText()).toContain(
      "provider/actual-model",
    );
    // Tooltip stays to the right of the sidebar, never obstructing sidebar buttons
    const tooltipBox = await page.getByRole("tooltip").boundingBox();
    const sidebarBox = await page.locator(".workbench-sidebar").boundingBox();
    expect(tooltipBox?.x).toBeGreaterThanOrEqual((sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0));

    // Hovering the session action button closes the tooltip so it never blocks menu actions
    const actionBtn = page.locator(".session-item").first().locator(".session-action-btn");
    await actionBtn.hover();
    expect(await page.getByRole("tooltip").count()).toBe(0);

    expect(await done.innerText()).toBe("完成的会话");
    const height = (await done.boundingBox())?.height;
    expect(height).toBeLessThanOrEqual(30);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `/tmp/forge-sidebar-${theme}.png` });
    }
    await done.focus();
    await done.press("Escape");
    expect(await page.getByRole("tooltip").count()).toBe(0);
    await page.locator(".session-item-main").nth(1).focus();
    await page
      .getByRole("tooltip")
      .getByText("未记录", { exact: true })
      .waitFor();
    await done.click();
    expect(await page.locator("body").getAttribute("data-selected")).toBe(
      "done",
    );
  } finally {
    await browser.close();
  }
});
