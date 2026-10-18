import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { type Page, chromium } from "playwright";
import { expect, it } from "vitest";

/**
 * Mounted checks for the redesigned tool card. These are outcomes of the real
 * CSS cascade (touch target height, horizontal overflow, first-paint structure)
 * that a static markup snapshot cannot observe.
 */
it("mounts the redesigned tool card: decoded console, failure banner, touch targets", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {ToolDisclosure} from './src/renderer/components/primitives/ToolDisclosure';
        import {createDiffPatch} from './src/shared/diff';
        import './src/renderer/styles/global.css';
        import './src/renderer/styles/workspace-theme.css';
        import './src/renderer/components/primitives/tool-disclosure.css';
        function LiveTool() {
          const [status, setStatus] = useState('running');
          const [autoCollapsed, setAutoCollapsed] = useState(false);
          window.updateTool = (status, history = false) => { setStatus(status); setAutoCollapsed(history); };
          return <ToolDisclosure className="live-tool" toolName="read_file" target="src/renderer/components/primitives/ToolDisclosure.tsx" status={status} autoCollapsed={autoCollapsed} output={status === 'failed' ? 'Access denied' : 'content'} />;
        }
        const editPath = 'src/renderer/components/workbench/settings/provider-connections/model-source-settings.ts';
        const before = Array.from({length: 30}, (_, i) => 'old value ' + i).join('\\n');
        const after = Array.from({length: 30}, (_, i) => 'new value ' + i).join('\\n');
        function EditTool() {
          const [done, setDone] = useState(false);
          window.finishEdit = () => setDone(true);
          return <ToolDisclosure toolName="edit_file" target={editPath} status={done ? 'completed' : 'running'} changes={done ? [{path: editPath, kind: 'modified', patch: createDiffPatch(before, after)}] : []} />;
        }
        createRoot(document.getElementById('root')).render(
          <div className="wb-app">
            <ToolDisclosure
              toolName="run_command"
              command="git status --short"
              cwd="/tmp/project"
              status="completed"
              durationMs={1420}
              output={JSON.stringify({
                stdout: " M src/a.ts\\n?? src/b.ts",
                stderr: "",
                exit_code: 0,
                duration_ms: 37,
                truncated: false,
              })}
              defaultExpanded={true}
            />
            <ToolDisclosure
              toolName="run_command"
              command="node scripts/check-syntax.mjs"
              status="failed"
              output={JSON.stringify({
                stdout: "",
                stderr: "SyntaxError: Unexpected token '?' at line 42:15",
                exit_code: 1,
              })}
              defaultExpanded={true}
            />
            <ToolDisclosure
              toolName="read_file"
              target="src/a.ts"
              status="completed"
              parameters={JSON.stringify({path: 'src/a.ts', limit: 40})}
              output={JSON.stringify({path: 'src/a.ts', content: '1: const a = 1;\\n2: export { a };'})}
              defaultExpanded={true}
            />
            <LiveTool />
            <EditTool />
            <ToolDisclosure toolName="write_file" target="src/new.ts" status="completed" changes={[{path:'src/new.ts', kind:'created', patch:createDiffPatch('', 'export const value = 1;')}]} />
            <ToolDisclosure toolName="edit_file" target="src/locked.ts" status="failed" error="Permission denied" />
          </div>
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "tool-card.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) =>
    file.path.endsWith(".css"),
  )?.text;
  if (!js || !css) throw new Error("Missing bundle");
  const surfaceCss = `${css}\nhtml,body,#root {height:auto;overflow:visible;background:var(--canvas-bg)} .wb-app {max-width:760px;margin:24px auto;padding:16px;}`;
  const captureDirectory = process.env.FORGE_QA_DIR;
  if (captureDirectory) await mkdir(captureDirectory, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    // A phone-sized touch surface: exercises the coarse-pointer contract and the
    // narrow reading column at the same time.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: surfaceCss });
    await page.addScriptTag({ content: js });
    await page.waitForSelector(".tool-disclosure");

    // The command envelope is decoded: stdout lines, not one escaped JSON blob.
    const commandCard = page.locator(".tool-disclosure").first();
    const commandText = await commandCard.innerText();
    expect(commandText).toContain(" M src/a.ts");
    expect(commandText).toContain("?? src/b.ts");
    expect(commandText).not.toContain("\\n");
    expect(commandText).not.toContain('"stdout"');
    // The command line itself stays exact and is not reflowed away.
    expect(commandText).toContain("git status --short");
    expect(commandText).toContain("工作目录 /tmp/project");
    // Machine facts keep their own labelled rows.
    expect(commandText).toContain("退出码 0");
    expect(commandText).toContain("1.4s");

    // A failure names itself and shows stderr as its own stream.
    const failedCard = page.locator(
      '.tool-disclosure[data-status="failed"][data-tool="run_command"]',
    );
    expect(await failedCard.count()).toBe(1);
    const failedText = await failedCard.innerText();
    expect(failedText).toContain("失败");
    expect(failedText).toContain(
      "SyntaxError: Unexpected token '?' at line 42:15",
    );
    expect(failedText).toContain("退出码 1");

    // Touch pointers get the documented 44px target on the row summary.
    const headerHeight = await page
      .locator(".tool-disclosure-header")
      .first()
      .evaluate((node) => node.getBoundingClientRect().height);
    expect(headerHeight).toBeGreaterThanOrEqual(44);

    // No horizontal overflow inside the narrow reading column, including the
    // long unbreakable tokens in a command and a file body.
    const overflow = await page.evaluate(() => {
      const inner = document.querySelector(".wb-app");
      if (!inner) return { scrollWidth: 0, clientWidth: 0 };
      return { scrollWidth: inner.scrollWidth, clientWidth: inner.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // The row is a real button: keyboard focus reaches it with a visible ring.
    await page.locator(".tool-disclosure-header").first().focus();
    const focused = await page.evaluate(
      () => document.activeElement?.className,
    );
    expect(focused).toContain("tool-disclosure-header");
    const params = page
      .locator('.tool-disclosure[aria-label="工具调用：read_file"]')
      .first()
      .locator(".tool-details");
    expect(await params.getAttribute("open")).toBeNull();
    await params.locator("summary").click();
    expect(
      await page.locator(".live-tool .tool-disclosure-target").innerText(),
    ).toBe("ToolDisclosure.tsx");
    expect(await page.locator(".live-tool .tool-read-path").innerText()).toBe(
      "src/renderer/components/primitives/ToolDisclosure.tsx",
    );
    const verifyEdits = async (surface: Page) => {
      const edited = surface.locator('[data-tool="edit_file"]').first();
      expect(await edited.getAttribute("data-expanded")).toBe("true");
      await surface.evaluate(() => Reflect.get(window, "finishEdit")());
      await edited.locator(".diff-viewer").waitFor();
      expect(await edited.getAttribute("data-expanded")).toBe("true");
      expect(await edited.locator(".tool-diff-added").innerText()).toBe("+30");
      expect(await edited.locator(".tool-diff-removed").innerText()).toBe(
        "-30",
      );
      expect(await edited.locator(".diff-line").count()).toBe(10);
      const pathFits = await edited
        .locator(".diff-path > span")
        .evaluate((node) => {
          const header = node.closest(".diff-header");
          return (
            header !== null &&
            node.getBoundingClientRect().right <=
              header.getBoundingClientRect().right
          );
        });
      expect(pathFits).toBe(true);
      if (
        await surface.evaluate(() => matchMedia("(pointer: coarse)").matches)
      ) {
        expect(
          await edited
            .locator(".diff-more")
            .evaluate((node) => node.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(44);
      }
      await edited
        .getByRole("button", { name: "展开全部差异", exact: false })
        .click();
      expect(await edited.locator(".diff-line").count()).toBe(60);
      expect(await edited.locator(".diff-scroll").innerText()).toContain(
        "new value 29",
      );
      expect(
        await edited
          .locator(".diff-scroll")
          .evaluate((node) => node.getBoundingClientRect().height),
      ).toBeLessThanOrEqual(480);
      if (captureDirectory)
        await edited.screenshot({
          path: resolve(
            captureDirectory,
            `edit-expanded-${surface.viewportSize()?.width}.png`,
          ),
          animations: "disabled",
        });
      const sizes = await edited.evaluate((node) => ({
        width: node.clientWidth,
        scroll: node.scrollWidth,
      }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
      await edited.getByRole("button", { name: "收起差异" }).click();
      expect(await edited.locator(".diff-line").count()).toBe(10);
      await edited.locator(".tool-disclosure-header").click();
      expect(await edited.locator(".diff-viewer").count()).toBe(0);
      await edited.locator(".tool-disclosure-header").click();
      expect(await edited.locator(".diff-viewer").count()).toBe(1);
      const written = surface.locator('[data-tool="write_file"]');
      expect(await written.getAttribute("data-expanded")).toBe("true");
      expect(await written.locator(".diff-line-added").innerText()).toContain(
        "export const value = 1;",
      );
      const failedEdit = surface.locator(
        '[data-tool="edit_file"][data-status="failed"]',
      );
      expect(await failedEdit.getAttribute("data-expanded")).toBe("true");
      expect(
        (await failedEdit.innerText()).match(/Permission denied/g),
      ).toHaveLength(1);
      expect(await failedEdit.locator(".diff-viewer").count()).toBe(0);
    };
    await verifyEdits(page);
    expect(await params.innerText()).toContain("src/a.ts");
    await params.locator("summary").click();
    const targetHeight = await page
      .locator(".live-tool .tool-disclosure-target")
      .evaluate((node) => node.getBoundingClientRect().height);
    expect(targetHeight).toBeLessThanOrEqual(34);
    if (captureDirectory)
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await page.screenshot({
          path: resolve(captureDirectory, `tools-390-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page
          .locator('[data-tool="edit_file"]')
          .first()
          .screenshot({
            path: resolve(captureDirectory, `edit-390-${theme}.png`),
            animations: "disabled",
          });
      }
    expect(errors).toEqual([]);
    await context.close();

    // Desktop fine-pointer cadence: the same card keeps a compact row instead
    // of inheriting the touch height, and toggling it never resizes the summary.
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const desktopPage = await desktop.newPage();
    await desktopPage.setContent('<div id="root"></div>');
    await desktopPage.addStyleTag({ content: surfaceCss });
    await desktopPage.addScriptTag({ content: js });
    await desktopPage.waitForSelector(".tool-disclosure");
    const desktopHeader = desktopPage
      .locator(".tool-disclosure-header")
      .first();
    const fineHeight = await desktopHeader.evaluate(
      (node) => node.getBoundingClientRect().height,
    );
    expect(fineHeight).toBeGreaterThanOrEqual(28);
    expect(fineHeight).toBeLessThanOrEqual(28);
    await desktopHeader.click();
    const collapsedHeight = await desktopHeader.evaluate(
      (node) => node.getBoundingClientRect().height,
    );
    expect(Math.abs(collapsedHeight - fineHeight)).toBeLessThan(2);
    const commandInset = await desktopPage
      .locator(
        '.tool-disclosure[data-status="failed"][data-tool="run_command"] .tool-terminal-prompt',
      )
      .evaluate((node) => {
        const parent = node.parentElement;
        if (!parent) throw new Error("Missing console header");
        return (
          node.getBoundingClientRect().left -
          parent.getBoundingClientRect().left
        );
      });
    expect(commandInset).toBeLessThanOrEqual(16);
    await verifyEdits(desktopPage);
    if (captureDirectory)
      for (const theme of ["light", "dark"]) {
        await desktopPage.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await desktopPage.screenshot({
          path: resolve(captureDirectory, `tools-1280-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await desktopPage
          .locator('[data-tool="edit_file"]')
          .first()
          .screenshot({
            path: resolve(captureDirectory, `edit-1280-${theme}.png`),
            animations: "disabled",
          });
      }
    const live = desktopPage.locator(".live-tool");
    const updateTool = async (status: string, history = false) => {
      await desktopPage.evaluate(
        ({ status, history }) => {
          const update = Reflect.get(window, "updateTool");
          update(status, history);
        },
        { status, history },
      );
      await desktopPage.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await desktopPage.waitForFunction(
        ({ status, history }) => {
          const live = document.querySelector(".live-tool");
          return (
            live?.getAttribute("data-status") === status &&
            (history ||
              live.getAttribute("data-expanded") ===
                (status === "completed" ? "false" : "true"))
          );
        },
        { status, history },
      );
    };
    expect(await live.getAttribute("data-expanded")).toBe("true");
    await updateTool("completed");
    expect(await live.getAttribute("data-expanded")).toBe("false");
    await updateTool("failed");
    expect(await live.innerText()).toContain("Access denied");
    await updateTool("completed");
    await live.locator(".tool-disclosure-header").click();
    await updateTool("completed", true);
    expect(await live.getAttribute("data-expanded")).toBe("true");
    await live.locator(".tool-disclosure-header").click();
    await updateTool("running", true);
    expect(await live.getAttribute("data-expanded")).toBe("false");
    await desktop.close();
  } finally {
    await browser.close();
  }
}, 30000);
