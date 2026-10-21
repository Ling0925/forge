import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("home composer is floating and fixed at bottom without spurious page scrolling on empty content", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
      import { createRoot } from 'react-dom/client';
      import { App } from './src/renderer/components/workbench/App';
      import { defaultPublicSettings } from './src/shared/schemas';
      import './src/renderer/styles/global.css';
      import './src/renderer/styles/workspace-theme.css';
      import './src/renderer/styles/settings-models.css';
      import './src/renderer/styles/sidebar-compact.css';

      const titles = ['任务一：开发新功能', '任务二：排查系统错误', '任务三：重构前端样式', '任务四：测试用例编写'];
      const sessions = window.__empty ? [] : titles.map((title, i) => ({
        version: 1, id: 'sess-' + i, title, workspace: '/tmp/project', model: 'fixture/model',
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z', messages: [], events: [], changes: []
      }));
      window.fixture = { reads: [], sessions };
      window.forge = {
        getSettings: async () => ({ ...defaultPublicSettings, isConfigured: true, theme: 'light', model: 'fixture/model' }),
        listSessions: async () => sessions,
        getSession: async () => null,
        onEvent: () => () => {},
        listModels: async () => ['fixture/model'],
        chooseWorkspace: async () => '/tmp/project',
        getProjectContext: async () => ({ instructionSources: [], skills: [], warnings: [], counts: { instructions: 0, skills: 0, warnings: 0 } }),
        listMcpServers: async () => [],
        listCheckpoints: async () => [],
        getDiagnostics: async () => null,
      };
      createRoot(document.getElementById('root')).render(<App />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "test-home-layout.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });

  const js = bundle.outputFiles.find((f) => f.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((f) => f.path.endsWith(".css"))?.text;
  if (!js || !css) throw new Error("Bundle output missing");

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE } : {}),
  });

  try {
    // 1. Verify on empty content: no spurious scrolling, composer fixed at bottom
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="root"></div><script>
      window.__empty = true;
      ${js}
    </script></body></html>`);
    await page.waitForSelector(".wb-new-session");

    const emptyMetrics = await page.evaluate(() => {
      const main = document.querySelector(".workbench-main");
      const scroll = document.querySelector(".wb-new-session-scroll");
      const composer = document.querySelector(".composer-fresh");
      const composerRect = composer?.getBoundingClientRect();
      return {
        mainScrollHeight: main?.scrollHeight ?? 0,
        mainClientHeight: main?.clientHeight ?? 0,
        scrollScrollHeight: scroll?.scrollHeight ?? 0,
        scrollClientHeight: scroll?.clientHeight ?? 0,
        composerBottom: composerRect?.bottom ?? 0,
      };
    });

    // workbench-main must NOT be scrollable
    expect(emptyMetrics.mainScrollHeight).toBe(emptyMetrics.mainClientHeight);
    // wb-new-session-scroll must NOT be scrollable when content fits
    expect(emptyMetrics.scrollScrollHeight).toBe(emptyMetrics.scrollClientHeight);
    // composer is positioned near the bottom of viewport (800 - 24px margin = 776px)
    expect(emptyMetrics.composerBottom).toBeGreaterThanOrEqual(750);
    expect(emptyMetrics.composerBottom).toBeLessThanOrEqual(800);

    await page.close();

    // 2. Verify with tasks on compact viewport: top scroll area scrolls, composer stays fixed and does not move
    const compactPage = await browser.newPage({ viewport: { width: 1280, height: 500 } });
    await compactPage.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="root"></div><script>
      window.__empty = false;
      ${js}
    </script></body></html>`);
    await compactPage.waitForSelector(".wb-new-session");

    const beforeScroll = await compactPage.evaluate(() => {
      const composer = document.querySelector(".composer-fresh");
      const scroll = document.querySelector(".wb-new-session-scroll");
      const main = document.querySelector(".workbench-main");
      return {
        mainScrollable: (main?.scrollHeight ?? 0) > (main?.clientHeight ?? 0),
        composerBottom: composer?.getBoundingClientRect().bottom ?? 0,
        composerTop: composer?.getBoundingClientRect().top ?? 0,
        scrollCanScroll: (scroll?.scrollHeight ?? 0) > (scroll?.clientHeight ?? 0),
      };
    });

    expect(beforeScroll.mainScrollable).toBe(false);
    expect(beforeScroll.scrollCanScroll).toBe(true);

    // Scroll top content down
    await compactPage.evaluate(() => {
      const scroll = document.querySelector(".wb-new-session-scroll");
      if (scroll) scroll.scrollTop = 150;
    });

    const afterScroll = await compactPage.evaluate(() => {
      const composer = document.querySelector(".composer-fresh");
      const scroll = document.querySelector(".wb-new-session-scroll");
      return {
        scrollTop: scroll?.scrollTop ?? 0,
        composerBottom: composer?.getBoundingClientRect().bottom ?? 0,
        composerTop: composer?.getBoundingClientRect().top ?? 0,
      };
    });

    expect(afterScroll.scrollTop).toBeGreaterThan(0);
    // Composer must remain firmly in place: bottom and top coordinates must not shift with scroll!
    expect(Math.abs(afterScroll.composerBottom - beforeScroll.composerBottom)).toBeLessThan(1);
    expect(Math.abs(afterScroll.composerTop - beforeScroll.composerTop)).toBeLessThan(1);

    await compactPage.close();
  } finally {
    await browser.close();
  }
}, 30000);
