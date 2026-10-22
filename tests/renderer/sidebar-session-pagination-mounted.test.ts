import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("limits sessions per workspace to 10 by default, expands by 10 on see more, and has collapse transition", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import { createRoot } from "react-dom/client";
        import { Sidebar } from "./src/renderer/components/workbench/Sidebar";
        import "./src/renderer/styles/global.css";
        import "./src/renderer/components/workbench/workbench.css";
        import "./src/renderer/components/workbench/app.css";
        import "./src/renderer/styles/workspace-theme.css";
        import "./src/renderer/styles/sidebar-compact.css";

        const root = createRoot(document.getElementById("root"));
        window.render = () => root.render(
          <div className="wb-app">
            <Sidebar />
          </div>
        );
        window.render();
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "sidebar-pagination.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "session-state",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            loader: "js",
            contents: `
              export const useWorkbench = () => ({
                state: {
                  sessions: window.sessions,
                  isSessionsLoading: false,
                  activeRuns: {},
                  settings: { isConfigured: true },
                  activeSessionId: window.activeSessionId,
                  isMobileSidebarOpen: false,
                  isNewSessionOpen: false,
                },
                openNewSession: () => {},
                openSettings: () => {},
                setMobileSidebar: () => {},
                selectSession: (id) => { window.activeSessionId = id; window.render(); },
                refreshActiveSession: () => {},
                createSession: (input) => (window.createSession ? window.createSession(input) : Promise.resolve({ id: "mock-new-id" })),
              });
            `,
          }));
        },
      },
    ],
  });

  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  if (!js || !css) throw new Error("Missing test bundle");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
    });
    page.setDefaultTimeout(4000);
    await page.setContent('<div id="root"></div>');

    // Create 25 sessions for Workspace A and 3 sessions for Workspace B
    await page.evaluate(() => {
      const base = {
        version: 1,
        model: "provider/test-model",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        status: "completed",
      };
      const sessionsA = Array.from({ length: 25 }, (_, i) => ({
        ...base,
        id: `session-a-${i + 1}`,
        title: `Task A-${i + 1}`,
        workspace: "/tmp/project-a",
      }));
      const sessionsB = Array.from({ length: 3 }, (_, i) => ({
        ...base,
        id: `session-b-${i + 1}`,
        title: `Task B-${i + 1}`,
        workspace: "/tmp/project-b",
      }));
      Object.assign(window, {
        sessions: [...sessionsA, ...sessionsB],
        activeSessionId: "session-a-1",
      });
    });

    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });

    const sidebar = page.getByRole("complementary", { name: "会话与导航" });
    await sidebar.waitFor();

    // Verify both projects are visible in the sidebar
    await page.getByText("project-a", { exact: false }).first().waitFor();
    await page.getByText("project-b", { exact: false }).first().waitFor();

    // Project B has 3 sessions, so no "See more" under project-b
    const folderB = page.locator(".session-folder").nth(1);
    expect(await folderB.locator(".session-item").count()).toBe(3);
    expect(await folderB.locator(".session-folder-more").count()).toBe(0);

    // Project A has 25 sessions:
    // 1. By default, only 10 sessions are visible
    const folderA = page.locator(".session-folder").nth(0);
    expect(await folderA.locator(".session-item").count()).toBe(10);

    // 2. A muted "See more" button is displayed at the bottom of the list
    const seeMoreBtn = folderA.locator(".session-folder-more");
    expect(await seeMoreBtn.isVisible()).toBe(true);
    expect(await seeMoreBtn.innerText()).toContain("See more");

    // Check transition styles on .session-folder-collapse
    const collapseEl = folderA.locator(".session-folder-collapse");
    const transitionStyle = await collapseEl.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        display: cs.display,
        gridTemplateRows: cs.gridTemplateRows,
        transitionProperty: cs.transitionProperty,
      };
    });
    expect(transitionStyle.display).toBe("grid");
    expect(transitionStyle.transitionProperty).toContain("grid-template-rows");

    // 3. Click "See more" -> loads 10 more sessions (now 20)
    await seeMoreBtn.click();
    expect(await folderA.locator(".session-item").count()).toBe(20);
    expect(await seeMoreBtn.isVisible()).toBe(true);

    // 4. Click "See more" again -> loads remaining 5 sessions (now 25)
    await seeMoreBtn.click();
    expect(await folderA.locator(".session-item").count()).toBe(25);

    // 5. All sessions displayed, "See more" button disappears
    expect(await seeMoreBtn.count()).toBe(0);

    // 6. Test collapse and expand transition classes
    const headerA = folderA.locator(".session-folder-header");
    expect(await collapseEl.getAttribute("class")).not.toContain("is-collapsed");

    // Click header to collapse
    await headerA.click();
    expect(await collapseEl.getAttribute("class")).toContain("is-collapsed");
    expect(await headerA.getAttribute("aria-expanded")).toBe("false");

    // Click header to expand
    await headerA.click();
    expect(await collapseEl.getAttribute("class")).not.toContain("is-collapsed");
    expect(await headerA.getAttribute("aria-expanded")).toBe("true");

    // 7. Test create session button in folder header
    const createBtnB = folderB.locator(".session-folder-create-btn");
    expect(await createBtnB.count()).toBe(1);
    expect(await createBtnB.getAttribute("title")).toBe("在 project-b 中新建会话");
    let createdWorkspace: string | null = null;
    await page.exposeFunction("trackCreateSession", (input: { workspace: string }) => {
      createdWorkspace = input.workspace;
    });
    await page.evaluate(() => {
      window.createSession = async (input: { workspace: string }) => {
        await (window as unknown as { trackCreateSession: (val: unknown) => Promise<void> }).trackCreateSession(input);
        return { id: "new-session-b", workspace: input.workspace };
      };
    });
    await createBtnB.click();
    expect(createdWorkspace).toBe("/tmp/project-b");
  } finally {
    await browser.close();
  }
});
