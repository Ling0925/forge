import { resolve } from "node:path";
import { build } from "esbuild";
import { type Page, chromium } from "playwright";
import { expect, it } from "vitest";

// Real mounted CSS is required: global reduced-motion forces every animation
// to 0.01ms, which a markup snapshot cannot observe.
// Uses the normal Playwright browser; set FORGE_BROWSER_EXECUTABLE when the
// bundled browser is not on disk.
const executablePath = process.env.FORGE_BROWSER_EXECUTABLE;
const label = "保存并读取模型列表 / 重试";

async function mount(page: Page, css: string, js: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await page.getByRole("button", { name: label }).waitFor();
  return errors;
}

async function busyReport(page: Page) {
  return page.evaluate((expected: string) => {
    const button = document.querySelector("button.btn");
    const status = button?.querySelector(".btn-busy-status");
    const mark = button?.querySelector(".btn-spinner");
    if (!(button instanceof HTMLButtonElement))
      throw new Error("missing button");
    if (!(status instanceof HTMLElement) || !(mark instanceof HTMLElement)) {
      throw new Error("busy status or mark is not mounted");
    }
    const buttonStyle = getComputedStyle(button);
    const markStyle = getComputedStyle(mark);
    const statusStyle = getComputedStyle(status);
    const box = button.getBoundingClientRect();
    return {
      text: button.textContent ?? "",
      keepsLabel: (button.textContent ?? "").includes(expected),
      statusText: status.textContent ?? "",
      disabled: button.disabled,
      ariaBusy: button.getAttribute("aria-busy"),
      statusVisible:
        statusStyle.display !== "none" &&
        statusStyle.visibility !== "hidden" &&
        Number.parseFloat(statusStyle.opacity) > 0 &&
        status.getClientRects().length > 0,
      markName: markStyle.animationName,
      markDuration: markStyle.animationDuration,
      markIteration: markStyle.animationIterationCount,
      markRadius: markStyle.borderRadius,
      width: box.width,
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
      whiteSpace: buttonStyle.whiteSpace,
    };
  }, label);
}

it("mounted loading button stays visibly busy under reduced motion and returns idle", async () => {
  const bundle = await build({
    stdin: {
      contents: `
      import './src/renderer/styles/global.css';
      import {createRoot} from 'react-dom/client';
      import {useState} from 'react';
      import {Button} from './src/renderer/components/primitives/Button';
      function Harness() {
        const [loading, setLoading] = useState(true);
        return (
          <>
            <Button loading={loading}>${label}</Button>
            <button type="button" id="stop-busy" onClick={() => setLoading(false)}>
              结束
            </button>
          </>
        );
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    `,
      resolveDir: resolve("."),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "button-busy-bundle.js",
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
    ],
  });

  const js =
    bundle.outputFiles.find((file) =>
      file.path.endsWith("button-busy-bundle.js"),
    )?.text ?? "";
  const css =
    bundle.outputFiles.find((file) =>
      file.path.endsWith("button-busy-bundle.css"),
    )?.text ?? "";
  expect(js).not.toBe("");
  expect(css).toContain(".btn-spinner");
  expect(css).toContain("animation-duration: 0.01ms");
  expect(css).toContain(".btn-busy-status");

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const normal = await browser.newPage({
      viewport: { width: 390, height: 800 },
    });
    normal.setDefaultTimeout(5000);
    const normalErrors = await mount(normal, css, js);
    const moving = await busyReport(normal);
    expect(moving.keepsLabel).toBe(true);
    expect(moving.statusText).toBe("进行中");
    expect(moving.statusVisible).toBe(true);
    expect(moving.disabled).toBe(true);
    expect(moving.ariaBusy).toBe("true");
    expect(moving.markName).toContain("btn-spin");
    expect(moving.markDuration).not.toBe("0s");
    expect(moving.markIteration).toBe("infinite");
    expect(moving.width).toBeLessThanOrEqual(390);
    expect(moving.scrollWidth).toBeLessThanOrEqual(moving.clientWidth + 1);
    expect(moving.whiteSpace).toBe("normal");
    await normal.locator("#stop-busy").click();
    await normal.waitForFunction(
      () => document.querySelector(".btn-busy-status") === null,
    );
    const idle = await normal.evaluate(() => {
      const button = document.querySelector("button.btn");
      if (!(button instanceof HTMLButtonElement))
        throw new Error("missing button");
      return {
        text: button.textContent ?? "",
        disabled: button.disabled,
        ariaBusy: button.getAttribute("aria-busy"),
        status: button.querySelector(".btn-busy-status") !== null,
        spinner: button.querySelector(".btn-spinner") !== null,
      };
    });
    expect(idle.text).toBe(label);
    expect(idle.disabled).toBe(false);
    expect(idle.ariaBusy).toBeNull();
    expect(idle.status).toBe(false);
    expect(idle.spinner).toBe(false);
    expect(normalErrors).toEqual([]);

    const reduced = await browser.newPage({
      viewport: { width: 390, height: 800 },
      reducedMotion: "reduce",
    });
    reduced.setDefaultTimeout(5000);
    const reducedErrors = await mount(reduced, css, js);
    const still = await busyReport(reduced);
    expect(still.keepsLabel).toBe(true);
    expect(still.statusText).toBe("进行中");
    expect(still.statusVisible).toBe(true);
    expect(still.disabled).toBe(true);
    expect(still.ariaBusy).toBe("true");
    expect(still.markName).toBe("none");
    // Global reduced-motion reports the frozen 0.01ms duration, not 0s.
    expect(Number.parseFloat(still.markDuration)).toBeLessThan(0.001);
    expect(still.markRadius).not.toContain("50%");
    expect(still.width).toBeLessThanOrEqual(390);
    expect(still.scrollWidth).toBeLessThanOrEqual(still.clientWidth + 1);
    expect(reducedErrors).toEqual([]);
  } finally {
    await browser.close();
  }
});
