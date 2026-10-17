// Temporary QA harness: mounts the real Sidebar with real CSS in Chromium.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const longTitle =
  "重构认证中间件并把所有遗留的会话缓存迁移到新的索引结构同时补齐回归测试与文档说明";

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

      const mk = (id, title, workspace, model, updatedAt) => ({
        version: 1, id, title, workspace, model,
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt,
      });
      const sessions = [
        mk('11111111-1111-4111-8111-111111111111', ${JSON.stringify(longTitle)},
           '/home/ling/services/desktop-harness', 'cbcn/deepseek-v4.1-flash', '2026-02-02T10:00:00.000Z'),
        mk('22222222-2222-4222-8222-222222222222', '短标题', '/home/ling/services/desktop-harness',
           'cbcn/deepseek-v4.1-flash', '2026-02-01T09:00:00.000Z'),
        mk('33333333-3333-4333-8333-333333333333', '另一个工作区的任务', '/tmp/other-project',
           'gateway/secret-model-id', '2026-01-31T08:00:00.000Z'),
      ];
      window.testController = {
        state: {
          activeSessionId: sessions[0].id,
          activeSnapshot: sessions[0],
          sessions,
          activeRuns: {},
          settings: {model: 'cbcn/deepseek-v4.1-flash', isConfigured: true},
          alertError: null, isSessionsLoading: false, isNewSessionOpen: false,
          isMobileSidebarOpen: false, mobileTab: 'task',
        },
        selectSession: (id) => { window.__selected = id; },
        refreshActiveSession: () => {}, answerApproval: () => {},
        openNewSession: () => { window.__newOpened = true; },
        openSettings: () => {}, setMobileTab: () => {},
        setMobileSidebar: () => {}, clearAlert: () => {},
        loadSettings: () => {}, loadSessions: () => {},
      };
      window.__reactRoot = createRoot(document.getElementById('root'));
      window.__reactRoot.render(<div className="workbench wb-app"><Sidebar/></div>);
    `,
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  outfile: "sidebar-qa.js",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "local-font-faces",
      setup(api) {
        api.onResolve({ filter: /^@fontsource-variable\// }, (args) => ({
          path: args.path,
          namespace: "test-font-face",
        }));
        api.onLoad({ filter: /.*/, namespace: "test-font-face" }, () => ({
          contents: "",
          loader: "css",
        }));
      },
    },
    {
      name: "test-controller",
      setup(api) {
        api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
          contents:
            "export function useWorkbench() { return window.testController; }",
          loader: "js",
        }));
      },
    },
  ],
});

const js =
  bundle.outputFiles.find((f) => f.path.endsWith("sidebar-qa.js"))?.text ?? "";
const css =
  bundle.outputFiles.find((f) => f.path.endsWith("sidebar-qa.css"))?.text ?? "";
if (!js) throw new Error("no js bundle");
if (!css.includes(".session-folder-header")) throw new Error("css missing folder styles");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORGE_BROWSER_EXECUTABLE
    ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
    : {}),
});
const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${detail}`}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await page.waitForSelector(".session-folder-header");

  // 1. group-by-folder
  const folders = await page.locator(".session-folder").count();
  check("one folder per workspace", folders === 2, `got ${folders}`);
  const names = await page.locator(".session-folder-name").allInnerTexts();
  check(
    "folder shows leaf directory name",
    JSON.stringify(names) === JSON.stringify(["desktop-harness", "other-project"]),
    JSON.stringify(names),
  );
  const counts = await page.locator(".session-folder-count").allInnerTexts();
  check("folder shows session count", counts.join(",") === "2,1", counts.join(","));
  const fullPathTitle = await page
    .locator(".session-folder-header")
    .first()
    .getAttribute("title");
  check(
    "folder keeps full path in tooltip",
    fullPathTitle === "/home/ling/services/desktop-harness",
    String(fullPathTitle),
  );

  // 2. no model id anywhere in the sidebar
  const sidebarText = await page.locator(".workbench-sidebar").innerText();
  const sidebarHtml = await page.locator(".workbench-sidebar").innerHTML();
  check(
    "no model id rendered",
    !sidebarText.includes("deepseek") &&
      !sidebarText.includes("secret-model-id") &&
      !sidebarHtml.includes("deepseek") &&
      !sidebarHtml.includes("secret-model-id"),
    "model id leaked into sidebar",
  );
  const itemTitle = await page
    .locator(".session-item-main")
    .first()
    .getAttribute("title");
  check(
    "per-session tooltip has no model id",
    !String(itemTitle).includes("deepseek") &&
      !String(itemTitle).includes("secret-model-id"),
    String(itemTitle),
  );

  // 3. left alignment + single line + fade
  const longTitleEl = page.locator(".session-item-title").first();
  const style = await longTitleEl.evaluate((n) => {
    const s = getComputedStyle(n);
    return {
      whiteSpace: s.whiteSpace,
      textAlign: s.textAlign,
      mask: s.maskImage || s.webkitMaskImage,
      textOverflow: s.textOverflow,
      scrollWidth: n.scrollWidth,
      clientWidth: n.clientWidth,
      rect: n.getBoundingClientRect().height,
      line: parseFloat(s.lineHeight) || 0,
    };
  });
  check("title never wraps", style.whiteSpace === "nowrap", style.whiteSpace);
  check(
    "title is left aligned",
    style.textAlign === "left" || style.textAlign === "start",
    style.textAlign,
  );
  check(
    "no ellipsis, uses fade mask",
    style.mask !== "none" &&
      String(style.mask).includes("linear-gradient") &&
      style.textOverflow !== "ellipsis",
    `mask=${style.mask} overflow=${style.textOverflow}`,
  );
  check(
    "long title genuinely overflows (fade is visible)",
    style.scrollWidth > style.clientWidth + 8,
    `${style.scrollWidth} vs ${style.clientWidth}`,
  );
  check(
    "single rendered line height",
    style.rect <= style.line * 1.6,
    `height=${style.rect} line=${style.line}`,
  );
  // short title must NOT be faded away
  const shortOverflow = await page
    .locator(".session-item-title")
    .nth(1)
    .evaluate((n) => n.scrollWidth - n.clientWidth);
  check(
    "short title is not clipped",
    shortOverflow <= 0,
    `overflow=${shortOverflow}`,
  );

  // 4. geometry: dot then title, both on the left
  const dot = await page.locator(".wb-status-dot").first().boundingBox();
  const title = await longTitleEl.boundingBox();
  const row = await page.locator(".session-item-main").first().boundingBox();
  check(
    "status dot precedes the title",
    dot.x < title.x && dot.x - row.x < 20,
    `dot=${dot.x} title=${title.x} row=${row.x}`,
  );
  const nestedLeft = await page
    .locator(".session-folder-body .session-item-main")
    .first()
    .evaluate((n) => n.getBoundingClientRect().left);
  const headerLeft = await page
    .locator(".session-folder-header")
    .first()
    .evaluate((n) => n.getBoundingClientRect().left);
  check(
    "sessions are indented under their folder",
    nestedLeft > headerLeft,
    `item=${nestedLeft} header=${headerLeft}`,
  );
  check(
    "no horizontal overflow in the sidebar",
    await page.evaluate(
      () =>
        document.querySelector(".workbench-sidebar").scrollWidth <=
        document.querySelector(".workbench-sidebar").clientWidth + 1,
    ),
    "sidebar scrollWidth exceeds clientWidth",
  );

  // 5. collapse / expand
  const header = page.locator(".session-folder-header").first();
  check(
    "folder starts expanded",
    (await header.getAttribute("aria-expanded")) === "true",
    String(await header.getAttribute("aria-expanded")),
  );
  await header.click();
  await page.waitForTimeout(60);
  const collapsed = await page.evaluate(() => {
    const h = document.querySelector(".session-folder-header");
    const body = document.querySelector(".session-folder-body");
    return {
      expanded: h.getAttribute("aria-expanded"),
      hidden: body.hidden,
      display: getComputedStyle(body).display,
      caret: getComputedStyle(document.querySelector(".session-folder-caret"))
        .transform,
    };
  });
  check(
    "collapse hides the folder body",
    collapsed.expanded === "false" &&
      collapsed.hidden === true &&
      collapsed.display === "none",
    JSON.stringify(collapsed),
  );
  check(
    "collapsed caret rotates",
    collapsed.caret !== "none",
    collapsed.caret,
  );
  await header.click();
  await page.waitForTimeout(60);
  check(
    "expand restores the folder body",
    (await header.getAttribute("aria-expanded")) === "true" &&
      (await page.locator(".session-folder-body").first().isVisible()),
    "folder did not re-expand",
  );

  // 6. selecting a session still works
  await page.locator(".session-item-main").first().click();
  check(
    "session selection still works",
    await page.evaluate(() => window.__selected === "11111111-1111-4111-8111-111111111111"),
    String(await page.evaluate(() => window.__selected)),
  );

  // 7. search filters within folders and forces them open
  await header.click(); // collapse again
  await page.waitForTimeout(40);
  await page.locator(".sidebar-search-input").fill("另一个工作区");
  await page.waitForTimeout(60);
  const searched = await page.evaluate(() => ({
    folders: document.querySelectorAll(".session-folder").length,
    items: document.querySelectorAll(".session-item").length,
    visibleBodies: [...document.querySelectorAll(".session-folder-body")].filter(
      (b) => !b.hidden,
    ).length,
  }));
  check(
    "search narrows folders and reveals matches",
    searched.folders === 1 &&
      searched.items === 1 &&
      searched.visibleBodies === 1,
    JSON.stringify(searched),
  );
  await page.locator(".sidebar-search-input").fill("");
  await page.waitForTimeout(60);
  check(
    "clearing the query restores the collapsed folder",
    await page.evaluate(
      () => document.querySelector(".session-folder-body").hidden === true,
    ),
    "collapse state lost after search",
  );

  check("no console/page errors", errors.length === 0, errors.join(" | "));
  await mkdir(".build/sidebar-qa", { recursive: true });
  await page.screenshot({ path: ".build/sidebar-qa/sidebar-qa.png" });
} finally {
  await browser.close();
}
console.log(
  failures.length === 0
    ? "\nALL CHECKS PASSED"
    : `\n${failures.length} FAILURE(S):\n${failures.join("\n")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
