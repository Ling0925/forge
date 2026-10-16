import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { sessionUsage } from "../../src/renderer/state/session-usage";
import { agentEventSchema } from "../../src/shared/schemas";

const base = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  timestamp: new Date().toISOString(),
};
const context = (
  promptTokens: number,
  cachedPromptTokens?: number,
  windowTokens: number | null = 10000,
) =>
  agentEventSchema.parse({
    ...base,
    type: "context_usage",
    usage: {
      promptTokens,
      completionTokens: 100,
      usedTokens: promptTokens + 100,
      windowTokens,
      estimated: true,
      basis: "request-with-output",
      ...(cachedPromptTokens === undefined ? {} : { cachedPromptTokens }),
      parts: {
        instructions: 0,
        memory: 0,
        conversation: promptTokens + 100,
        tools: 0,
      },
    },
  });
const finished = agentEventSchema.parse({
  ...base,
  type: "run_finished",
  status: "completed",
  turns: 1,
  toolCalls: 0,
  usage: {
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cachedPromptTokens: 900,
  },
  usageComplete: true,
});

it("separates context from session totals, replaces live usage on completion and preserves unknown cache", () => {
  const first = context(1000, 900);
  expect(sessionUsage([first]).total?.totalTokens).toBe(1100);
  expect(sessionUsage([first, finished]).total?.totalTokens).toBe(1100);
  expect(sessionUsage([finished]).cacheRead).toBe(900);
  expect(sessionUsage([finished]).latestCache).toBeUndefined();
  const result = sessionUsage([first, finished, context(2000)]);
  expect(result.total).toEqual({
    promptTokens: 3000,
    completionTokens: 200,
    totalTokens: 3200,
  });
  expect(result.context?.usedTokens).toBe(2100);
  expect(result.latestCache).toBeUndefined();
  expect(result.averageCache).toBe(0.9);
  expect(result.cachePartial).toBe(true);
  expect(sessionUsage([context(1000, 0)]).latestCache).toBe(0);
  expect(
    sessionUsage([context(1000, undefined, null)]).context?.windowTokens,
  ).toBeNull();
  expect(sessionUsage([]).total).toBeUndefined();
});

it("usage popover stays readable and dismissible on desktop/mobile in both themes", async () => {
  const events = [
    context(1000, 900),
    finished,
    context(486300, 474628, 1048576),
  ];
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
    import {createRoot} from 'react-dom/client';
    import {UsagePopover} from './src/renderer/components/workbench/UsagePopover';
    import './src/renderer/styles/global.css';
    import './src/renderer/components/workbench/app.css';
    import './src/renderer/styles/workspace-theme.css';
    createRoot(document.getElementById('root')).render(<div className="wb-app"><UsagePopover events={${JSON.stringify(events)}} /></div>);
  `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "usage.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    await page.setContent(
      '<div id="root"></div><button id="outside">外部</button>',
    );
    for (const file of bundle.outputFiles) {
      if (file.path.endsWith(".css"))
        await page.addStyleTag({ content: file.text });
      else if (file.path.endsWith(".js"))
        await page.addScriptTag({ content: file.text });
    }
    await page.addStyleTag({
      content:
        ".wb-app{height:650px!important;align-items:flex-end;justify-content:flex-end;padding:24px}",
    });
    for (const width of [1440, 390])
      for (const theme of ["dark", "light"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const trigger = page.getByText("≈46.4%", { exact: true });
        await trigger.click();
        const panel = page.getByRole("region", { name: "用量详情" });
        expect(await panel.innerText()).toContain("46.4% / 486.4K");
        expect(await panel.innerText()).toContain("97.6%");
        const rect = await panel.boundingBox();
        if (!rect) throw new Error("Missing usage panel");
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `/tmp/forge-usage-${width}-${theme}.png`,
        });
        await page.keyboard.press("Escape");
        expect(await panel.count()).toBe(0);
        await trigger.click();
        await page.locator("#outside").click();
        expect(await panel.count()).toBe(0);
      }
  } finally {
    await browser.close();
  }
}, 20000);
