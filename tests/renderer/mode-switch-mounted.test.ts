import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("switches only the focused composer, announces next-run scope and preserves native navigation", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {Composer} from './src/renderer/components/workbench/Composer';
    import {initialWorkbenchState} from './src/renderer/state/workbench-reducer';
    import {defaultPublicSettings} from './src/shared/schemas';
    const id = '11111111-1111-4111-8111-111111111111';
    window.testController = { state: {...initialWorkbenchState, activeSessionId:id,
      activeSnapshot:{id, workspace:'/tmp', model:'test', messages:[], events:[], changes:[]},
      settings:{...defaultPublicSettings, model:'test', isConfigured:true},
      activeRuns:{[id]:{status:'running', streamingText:''}}},
      startRun:async()=>true, createSession:async()=>null, chooseWorkspace:async()=>null,
      openNewSession:()=>{}, cancelRun:async()=>{}, openSettings:()=>{} };
    createRoot(document.getElementById('root')).render(<Composer/>);
  `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "context",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            contents:
              "export const useWorkbench = () => window.testController;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    const code = bundle.outputFiles[0]?.text;
    if (!code) throw Error("No bundle");
    await page.addScriptTag({ content: code });
    const input = page.getByRole("textbox", { name: "继续任务" });
    await input.fill("draft");
    await input.press("Shift+Tab");
    expect(await page.locator("#run-mode").inputValue()).toBe("plan");
    expect(await page.locator("#run-permission").isDisabled()).toBe(true);
    expect(await page.locator("#run-permission").inputValue()).toBe("readonly");
    expect(
      await page.locator(".composer-mode-arrow").getAttribute("class"),
    ).toContain("is-plan");
    expect(
      await page.locator('[aria-live="polite"]').allTextContents(),
    ).toContain("Mode: plan；仅影响下一次运行，当前运行模式不变");
    expect(await input.inputValue()).toBe("draft");
    await page.locator("#run-mode").focus();
    await page.keyboard.press("Shift+Tab");
    expect(await page.locator("#run-mode").inputValue()).toBe("plan");
    await input.focus();
    await input.press("Shift+Tab");
    expect(await page.locator("#run-mode").inputValue()).toBe("build");
    await page.evaluate(() => {
      const dialog = document.createElement("dialog");
      dialog.open = true;
      document.body.append(dialog);
    });
    await input.press("Shift+Tab");
    expect(await page.locator("#run-mode").inputValue()).toBe("build");
  } finally {
    await browser.close();
  }
}, 20000);
