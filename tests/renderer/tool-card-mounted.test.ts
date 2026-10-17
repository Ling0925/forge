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
        import {createRoot} from 'react-dom/client';
        import {ToolDisclosure} from './src/renderer/components/primitives/ToolDisclosure';
        import './src/renderer/styles/global.css';
        import './src/renderer/components/primitives/tool-disclosure.css';
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
    await page.addStyleTag({ content: css });
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
    expect(errors).toEqual([]);
    await context.close();

    // Desktop fine-pointer cadence: the same card keeps a compact row instead
    // of inheriting the touch height, and toggling it never resizes the summary.
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const desktopPage = await desktop.newPage();
    await desktopPage.setContent('<div id="root"></div>');
    await desktopPage.addStyleTag({ content: css });
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
    await desktop.close();
  } finally {
    await browser.close();
  }
}, 30000);
