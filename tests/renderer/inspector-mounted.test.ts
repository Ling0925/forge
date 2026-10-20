import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

// A real mounted browser run is required: server-rendered snapshots cannot
// observe React reconciliation retaining stale sibling subtrees.
// Uses the normal Playwright browser by default; set FORGE_BROWSER_EXECUTABLE
// (same override as the browser tool) when the bundled browser is not on disk.
const executablePath = process.env.FORGE_BROWSER_EXECUTABLE;

const sessionIds = ["parent-a", "child-a", "parent-b", "child-b"];

it("mounted Inspector switches sessions without retaining sibling navigation or checkpoint targets", async () => {
  // In-memory test-only bundling, not an application build or asset mutation.
  const bundle = await build({
    stdin: {
      contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Inspector} from './src/renderer/components/workbench/Inspector';
      const ids = ${JSON.stringify(sessionIds)};
      const sessions = ids.map((id, i) => ({id, title:id, model:'model-'+id, workspace:'/tmp', status:'completed', createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z', messages:[], events:[], changes:[], parentSessionId: i % 2 ? ids[i-1] : undefined}));
      window.checkpointReads = [];
      window.diagnosticsReads = [];
      window.forge = {
        listCheckpoints: async (id) => { window.checkpointReads.push(id); return []; },
        getCheckpointDiff: async () => '',
        restoreCheckpoint: async () => sessions[0],
        getDiagnostics: async (id) => { window.diagnosticsReads.push(id); return null; },
        getProjectContext: async () => ({workspace:'/tmp', instructionSources:[], skills:[], warnings:[], counts:{instructions:0, skills:0, warnings:0}}),
        listMcpServers: async () => [],
        cancelSession: async () => false,
        compactSession: async () => sessions[0],
      };
      function Harness() {
        const [id, select] = useState(ids[0]);
        window.testController = {state:{activeSessionId:id, activeSnapshot:sessions.find(s=>s.id===id), sessions, activeRuns:{}}, selectSession:select, refreshActiveSession:()=>{}, answerApproval:()=>{}};
        window.selectTestSession = select;
        return <Inspector/>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
      resolveDir: resolve("."),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".css": "empty" },
    plugins: [
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

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        warnings.push(message.text());
    });
    page.on("pageerror", (error) => warnings.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]?.text ?? "" });

    const changesTab = page.getByRole("tab", { name: "文件", exact: true });
    await changesTab.click();
    await page.getByRole("tab", { name: "变更与检查点", exact: true }).click();

    // Forward/back across all four sessions, revisiting parents so an
    // accumulating sibling navigation would surface as a duplicate section.
    for (const id of [
      "parent-a",
      "child-a",
      "parent-b",
      "child-b",
      "parent-a",
      "child-a",
      "parent-b",
      "child-b",
      "parent-a",
    ]) {
      await page.evaluate(
        (selected) =>
          (
            window as unknown as {
              selectTestSession: (id: string) => void;
            }
          ).selectTestSession(selected),
        id,
      );
      // Wait until the sole navigation section reflects the new session.
      // A stale, accumulated sibling section keeps this false -> failure.
      await page.waitForFunction((selected) => {
        const sections = document.querySelectorAll(
          '[aria-label="关联会话的变更导航"]',
        );
        return (
          sections.length === 1 &&
          sections[0]?.textContent?.includes(`当前会话：${selected}`) === true
        );
      }, id);
      const navigation = page.locator('[aria-label="关联会话的变更导航"]');
      expect(await navigation.count()).toBe(1);
      const text = (await navigation.textContent()) ?? "";
      expect(text).toContain(`当前会话：${id}`);
      if (id.startsWith("child")) {
        expect(text).toContain(`父任务：${id.replace("child", "parent")}`);
        expect(text).not.toContain("子任务会话（");
      } else {
        expect(text).toContain(id.replace("parent", "child"));
        expect(text).not.toContain(id === "parent-a" ? "child-b" : "child-a");
      }
      // The checkpoint panel (its own keyed sibling) must target the same
      // session, proving both change subtrees agree on selection.
      await page.waitForFunction(
        (selected) =>
          (
            window as unknown as { checkpointReads: string[] }
          ).checkpointReads.at(-1) === selected,
        id,
      );
      expect(await changesTab.getAttribute("aria-selected")).toBe("true");
    }

    await page.getByText("关联任务的变更", { exact: true }).click();

    // Exercise the real child-open and return-to-parent actions, not only
    // externally driven selection.
    await page
      .getByRole("button", { name: "打开此子任务的变更 / 检查点" })
      .click();
    await page
      .getByRole("button", { name: "返回父任务的变更 / 检查点" })
      .click();
    expect(
      await page.locator('[aria-label="关联会话的变更导航"]').count(),
    ).toBe(1);

    // Duplicate sibling keys emit React warnings; none are acceptable here.
    expect(warnings).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
