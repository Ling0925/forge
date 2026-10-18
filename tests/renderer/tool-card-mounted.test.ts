import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
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
        import './src/renderer/styles/global.css';
        import './src/renderer/styles/workspace-theme.css';
        import './src/renderer/components/primitives/tool-disclosure.css';
        function LiveTool() {
          const [status, setStatus] = useState('running');
          const [autoCollapsed, setAutoCollapsed] = useState(false);
          window.updateTool = (status, history = false) => { setStatus(status); setAutoCollapsed(history); };
          return <ToolDisclosure className="live-tool" toolName="read_file" target="src/renderer/components/primitives/ToolDisclosure.tsx" status={status} autoCollapsed={autoCollapsed} output={status === 'failed' ? 'Access denied' : 'content'} />;
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
    const failedCard = page.locator('.tool-disclosure[data-status="failed"]');
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
    expect(fineHeight).toBeLessThan(40);
    await desktopHeader.click();
    const collapsedHeight = await desktopHeader.evaluate(
      (node) => node.getBoundingClientRect().height,
    );
    expect(Math.abs(collapsedHeight - fineHeight)).toBeLessThan(2);
    const commandInset = await desktopPage
      .locator('.tool-disclosure[data-status="failed"] .tool-terminal-prompt')
      .evaluate((node) => {
        const parent = node.parentElement;
        if (!parent) throw new Error("Missing console header");
        return (
          node.getBoundingClientRect().left -
          parent.getBoundingClientRect().left
        );
      });
    expect(commandInset).toBeLessThanOrEqual(16);
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
