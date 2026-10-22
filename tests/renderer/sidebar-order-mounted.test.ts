import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import type { SessionSummary } from "../../src/renderer/shared-types";

it("keeps project and session positions stable across activity, filtering and remounts", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import { flushSync } from 'react-dom';
        import { createRoot } from 'react-dom/client';
        import { Sidebar } from './src/renderer/components/workbench/Sidebar';
        import './src/renderer/styles/global.css';
        import './src/renderer/components/workbench/workbench.css';
        import './src/renderer/components/workbench/app.css';
        import './src/renderer/styles/workspace-theme.css';
        import './src/renderer/styles/sidebar-compact.css';
        const root = createRoot(document.getElementById('root'));
        window.generation = 0;
        window.render = () => flushSync(() => root.render(
          <div className="wb-app"><Sidebar key={window.generation} /></div>
        ));
        window.render();
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "sidebar-order.js",
    loader: { ".woff2": "dataurl" },
    plugins: [{
      name: "session-state",
      setup(api) {
        api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
          loader: "js",
          contents: `
            export const useWorkbench = () => ({
              state: {
                sessions: window.sessions, activeRuns: {},
                activeSessionId: window.activeSessionId,
                settings: { isConfigured: true },
              },
              openNewSession: () => {}, openSettings: () => {},
              setMobileSidebar: () => {},
              selectSession: (id) => { window.activeSessionId = id; window.render(); },
            });
          `,
        }));
      },
    }],
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  if (!js || !css) throw new Error("Missing sidebar test bundle");

  const workspaceA = "/tmp/a/project-2";
  const workspaceB = "/tmp/b/project-2";
  const workspaceC = "/tmp/project-10";
  const base = {
    version: 1 as const,
    model: "test/model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "completed" as const,
  };
  let sessions: SessionSummary[] = [
    ...Array.from({ length: 12 }, (_, i) => ({
      ...base,
      id: `a-${String(i + 1).padStart(2, "0")}`,
      title: `Task A-${i + 1}`,
      workspace: workspaceA,
      // A-2 and A-3 deliberately share a creation time to exercise the ID tie-breaker.
      createdAt: new Date(Date.UTC(2026, 0, 20 - (i === 2 ? 1 : i))).toISOString(),
    })),
    { ...base, id: "b-new", title: "Task B-new", workspace: workspaceB, createdAt: "2026-01-02T00:00:00.000Z" },
    { ...base, id: "b-old", title: "Task B-old", workspace: workspaceB },
    { ...base, id: "c", title: "Task C", workspace: workspaceC },
    { ...base, id: "archive", title: "Archived", workspace: workspaceA, archived: true },
  ];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(4000);
    await page.setContent('<div id="root"></div>');
    const renderSessions = async () => {
      await page.evaluate((next) => {
        // The sidebar must not reorder the shared state used by other views.
        Reflect.set(window, "sessions", Object.freeze(next.map((session) => Object.freeze(session))));
        Reflect.get(window, "render")?.();
      }, sessions);
    };
    await renderSessions();
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    const sidebar = page.getByRole("complementary", { name: "会话与导航" });
    await sidebar.waitFor();
    const readOrder = () => sidebar.locator(".session-folder").evaluateAll((folders) =>
      folders.map((folder) => ({
        workspace: folder.querySelector(".session-folder-header")?.getAttribute("title"),
        titles: Array.from(folder.querySelectorAll(".session-item-title"), (item) => item.textContent),
      })),
    );
    const expected = [
      { workspace: workspaceA, titles: Array.from({ length: 10 }, (_, i) => `Task A-${i + 1}`) },
      { workspace: workspaceB, titles: ["Task B-new", "Task B-old"] },
      { workspace: workspaceC, titles: ["Task C"] },
    ];
    expect(await readOrder()).toEqual(expected);

    // Simulate refreshed API results promoting active sessions (including a hidden
    // page-2 item). Status dots must update without moving projects or list items.
    for (const status of ["running", "awaiting_approval", "completed"] as const) {
      sessions = sessions.map((session) => ({
        ...session,
        status,
        updatedAt: "2026-02-01T00:00:00.000Z",
      })).reverse();
      await renderSessions();
      const dots = sidebar.locator(".session-item [data-status]");
      expect(await dots.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status"))))
        .toEqual(status === "completed" ? [] : Array(13).fill(status));
      expect(await readOrder()).toEqual(expected);
      expect(await sidebar.getByRole("button", { name: "Task A-12", exact: true }).count()).toBe(0);
    }

    await sidebar.getByRole("button", { name: "Task B-old", exact: true }).click();
    expect(await sidebar.locator('[aria-current="true"] .session-item-title').textContent()).toBe("Task B-old");
    expect(await readOrder()).toEqual(expected);

    // Search and archive visibility must not change the relative order of survivors.
    const search = sidebar.getByRole("textbox", { name: "搜索会话" });
    await search.fill("old");
    expect(await readOrder()).toEqual([{ workspace: workspaceB, titles: ["Task B-old"] }]);
    await search.fill("");
    expect(await readOrder()).toEqual(expected);
    await sidebar.getByTitle("显示归档会话").click();
    expect(await readOrder()).toEqual(expected);
    await sidebar.locator(".session-folder-more").click();
    expect(await sidebar.locator(".session-folder").first().locator(".session-item-title").allTextContents())
      .toEqual([...Array.from({ length: 12 }, (_, i) => `Task A-${i + 1}`), "归档 · Archived"]);
    await sidebar.getByTitle("隐藏归档会话").click();

    // A new session belongs at the top of its own project, without promoting the project.
    sessions = [{ ...base, id: "b-newest", title: "Task B-newest", workspace: workspaceB,
      createdAt: "2026-03-01T00:00:00.000Z" }, ...sessions];
    await renderSessions();
    const expandedExpected = [
      { workspace: workspaceA, titles: Array.from({ length: 12 }, (_, i) => `Task A-${i + 1}`) },
      { workspace: workspaceB, titles: ["Task B-newest", "Task B-new", "Task B-old"] },
      expected[2],
    ];
    expect(await readOrder()).toEqual(expandedExpected);

    const folderB = sidebar.locator(".session-folder").filter({ has: page.getByTitle(workspaceB, { exact: true }) });
    await folderB.locator(".session-folder-header").click();
    sessions.reverse();
    await renderSessions();
    expect(await folderB.locator(".session-folder-header").getAttribute("aria-expanded")).toBe("false");
    expect(await readOrder()).toEqual(expandedExpected);

    // A fresh mount must reconstruct the same order, not capture whichever API
    // order happened to arrive first. Pagination returns to its default size.
    await page.evaluate(() => {
      Reflect.set(window, "generation", 1);
      Reflect.get(window, "render")();
    });
    expect(await readOrder()).toEqual([expected[0], expandedExpected[1], expected[2]]);
    expect(await folderB.locator(".session-folder-header").getAttribute("aria-expanded")).toBe("true");
  } finally {
    await browser.close();
  }
});
