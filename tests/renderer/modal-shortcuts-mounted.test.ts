import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

// A real mounted browser run is required: the defect is DOM-time modal
// stacking (native <dialog> showModal) driven by window keydown handlers, which
// server-rendered snapshots cannot observe. Uses the normal Playwright browser
// by default; set FORGE_BROWSER_EXECUTABLE (same override as the browser tool)
// when the bundled browser is not on disk.
const executablePath = process.env.FORGE_BROWSER_EXECUTABLE;

it("mounted global modal shortcuts never stack dialogs and keep toggle, handoff and focus", async () => {
  // In-memory test-only bundling, not an application build or asset mutation.
  // Real components (Settings, NewTask composer, CommandPalette, Dialog) run on
  // the real reducer; only the IPC-backed workbench context is stubbed.
  const bundle = await build({
    stdin: {
      contents: `
      import React, {useReducer, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {defaultPublicSettings} from './src/shared/schemas';
      import {initialWorkbenchState, workbenchReducer} from './src/renderer/state/workbench-reducer';
      import {useGlobalModalShortcuts} from './src/renderer/state/modal-shortcuts';
      import {CommandPalette} from './src/renderer/components/workbench/CommandPalette';
      import {Composer} from './src/renderer/components/workbench/Composer';
      import {Dialog} from './src/renderer/components/workbench/Dialog';
      import {Settings} from './src/renderer/components/workbench/Settings';
      window.forge = { listModels: async () => [], chooseWorkspace: async () => '/tmp/workspace' };
      function LocalRestoreDialog({open, onClose}) {
        return open
          ? <Dialog title="确认恢复文件" onClose={onClose}><p>确认恢复检查点？</p></Dialog>
          : null;
      }
      function Harness() {
        const [state, dispatch] = useReducer(workbenchReducer, {
          ...initialWorkbenchState,
          settings: {...defaultPublicSettings, isConfigured: false},
          isSettingsOpen: true,
        });
        const [localOpen, setLocalOpen] = useState(false);
        const openSettings = (isOpen) => dispatch({type: 'OPEN_SETTINGS', isOpen});
        const openNewSession = (isOpen) => { dispatch({type: 'OPEN_NEW_SESSION', isOpen}); if(isOpen) requestAnimationFrame(() => document.getElementById('new-prompt')?.focus()); };
        window.testController = {
          state,
          openSettings,
          openNewSession,
          updateSettings: async () => {},
          selectSession: () => {},
          refreshActiveSession: async () => {},
        };
        window.setLocalDialog = setLocalOpen;
        useGlobalModalShortcuts({
          onNewSession: openNewSession,
          onSettings: openSettings,
          onEscape: () => setLocalOpen(false),
        });
        return (
          <>
            <CommandPalette />
            <Settings />
            <Composer isNew />
            <LocalRestoreDialog open={localOpen} onClose={() => setLocalOpen(false)} />
          </>
        );
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
  // Production workbench/app component styles (workbench.css, app.css).
  const globalCss = ["workbench.css", "app.css"]
    .map((name) =>
      readFileSync(resolve("src/renderer/components/workbench", name), "utf8"),
    )
    .join("\n");

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
    await page.addStyleTag({ content: globalCss });
    await page.addScriptTag({ content: bundle.outputFiles[0]?.text ?? "" });

    const SETTINGS = "设置 · 模型与执行";
    const NEW_TASK = "新建会话";
    const PALETTE = "命令与会话导航";
    const LOCAL_RESTORE = "确认恢复文件";

    const openLabels = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("dialog[open]")).map((dialog) =>
          dialog.getAttribute("aria-label"),
        ),
      );
    // Wait for the expected dialogs to open, then keep the window a few React
    // frames to catch any late stacking before asserting the exact set.
    const expectOpen = async (labels: string[]) => {
      await page.waitForFunction((expected: string[]) => {
        const open = Array.from(document.querySelectorAll("dialog[open]")).map(
          (dialog) => dialog.getAttribute("aria-label"),
        );
        return (
          open.length === expected.length &&
          expected.every((label) => open.includes(label))
        );
      }, labels);
      await page.waitForTimeout(150);
      expect(await openLabels().then((l) => [...l].sort())).toEqual(
        [...labels].sort(),
      );
    };
    const pressMod = async (key: string) => {
      await page.keyboard.down("Control");
      await page.keyboard.press(key);
      await page.keyboard.up("Control");
      await page.waitForTimeout(150);
    };
    const paletteButton = page.getByRole("button", {
      name: "命令 · Ctrl/Cmd K",
    });
    // The redesigned palette opener is an icon button: its raw textContent is
    // only the visible "命令" label, while the accessible name carries the
    // shortcut. Focus restoration is therefore proven by element identity
    // against the captured opener (plus its accessible label and liveness),
    // never by matching visible text and never by accepting any focus.
    const paletteOpener = await paletteButton.elementHandle();
    expect(paletteOpener).not.toBeNull();
    const expectFocusOnPaletteOpener = async () => {
      expect(
        await page.evaluate(
          (opener) =>
            opener?.isConnected === true &&
            document.activeElement === opener &&
            document.activeElement.getAttribute("aria-label") ===
              "命令 · Ctrl/Cmd K",
          paletteOpener,
        ),
      ).toBe(true);
    };

    // 1. Initial unconfigured state opens Settings alone; global new/settings/
    //    palette shortcuts must not stack anything on top of it.
    await expectOpen([SETTINGS]);
    await pressMod("n");
    expect(await openLabels()).toEqual([SETTINGS]);
    await pressMod("k");
    expect(await openLabels()).toEqual([SETTINGS]);
    await pressMod("Comma");
    expect(await openLabels()).toEqual([SETTINGS]);

    // 2. Escape closes settings; shortcuts work again but never stack.
    await page.keyboard.press("Escape");
    await expectOpen([]);
    await pressMod("n");
    await expectOpen([]);
    expect(await page.getByRole("form", { name: "新会话输入" }).isVisible()).toBe(true);
    await pressMod("k");
    await expectOpen([PALETTE]);
    await page.keyboard.press("Escape");
    await expectOpen([]);
    await pressMod("Comma");
    await expectOpen([SETTINGS]);
    await page.keyboard.press("Escape");
    await expectOpen([]);

    // 3. Palette keeps its own Ctrl/Cmd+K toggle, Escape close and focus
    //    restoration to the opener.
    await paletteButton.click();
    await expectOpen([PALETTE]);
    await page.keyboard.press("Escape");
    await expectOpen([]);
    await expectFocusOnPaletteOpener();
    await paletteButton.click();
    await expectOpen([PALETTE]);
    await pressMod("k");
    await expectOpen([]);

    // 4. Palette action closes the palette first, then hands off explicitly:
    //    exactly one dialog may be open after the handoff.
    await paletteButton.click();
    await expectOpen([PALETTE]);
    await page.getByRole("button", { name: NEW_TASK, exact: true }).click();
    await expectOpen([]);
    expect(await page.getByRole("form", { name: "新会话输入" }).isVisible()).toBe(true);
    expect(await page.locator("#new-prompt").evaluate((node) => node === document.activeElement)).toBe(true);

    // 5. A local native panel dialog (same Dialog as MCP / restore / rename)
    //    blocks every global modal shortcut until dismissed.
    await page.evaluate(() =>
      (
        window as unknown as {
          setLocalDialog: (open: boolean) => void;
        }
      ).setLocalDialog(true),
    );
    await expectOpen([LOCAL_RESTORE]);
    await pressMod("n");
    expect(await openLabels()).toEqual([LOCAL_RESTORE]);
    await pressMod("k");
    expect(await openLabels()).toEqual([LOCAL_RESTORE]);
    await pressMod("Comma");
    expect(await openLabels()).toEqual([LOCAL_RESTORE]);
    await page.keyboard.press("Escape");
    await expectOpen([]);

    // 6. Outside dialogs, normal shortcuts still work.
    await pressMod("Comma");
    await expectOpen([SETTINGS]);
    await page.keyboard.press("Escape");
    await expectOpen([]);
    await pressMod("k");
    await expectOpen([PALETTE]);
    await page.keyboard.press("Escape");
    await expectOpen([]);

    // React warnings or runtime errors are not acceptable here.
    expect(warnings).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);

it("abandons the modal handoff when a competing dialog stays open past the budget", async () => {
  const bundle = await build({
    stdin: {
      contents: `
      import {afterModalsClosed} from './src/renderer/state/modal-shortcuts';
      window.handoffs = [];
      window.scheduleHandoff = () => afterModalsClosed(() => window.handoffs.push('fired'));
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
  });
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<dialog id="competing"></dialog>');
    await page.addScriptTag({ content: bundle.outputFiles[0]?.text ?? "" });
    const handoffs = () =>
      page.evaluate(
        () => (window as unknown as { handoffs: string[] }).handoffs,
      );
    // A persistent competing modal must never receive a handoff, not even
    // after the bounded frame budget expires.
    await page.evaluate(() => {
      (document.getElementById("competing") as HTMLDialogElement).showModal();
      (window as unknown as { scheduleHandoff: () => void }).scheduleHandoff();
    });
    await page.waitForTimeout(1500); // well past the 30-frame budget
    expect(await handoffs()).toEqual([]);
    // Closing the dialog later must not fire the abandoned callback.
    await page.evaluate(() =>
      (document.getElementById("competing") as HTMLDialogElement).close(),
    );
    await page.waitForTimeout(400);
    expect(await handoffs()).toEqual([]);
    // Control: with no modal open the handoff fires normally.
    await page.evaluate(() =>
      (window as unknown as { scheduleHandoff: () => void }).scheduleHandoff(),
    );
    await page.waitForFunction(
      () => (window as unknown as { handoffs: string[] }).handoffs.length === 1,
    );
  } finally {
    await browser.close();
  }
}, 30000);
