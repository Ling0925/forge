import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("Android's presentation reader follows actual page edges, live theme changes and transparent fallback", async () => {
  const script = await readFile("android/app/src/main/assets/read-system-bar-theme.js", "utf8");
  const tokens = await readFile("src/renderer/styles/workspace-theme.css", "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(`<!doctype html><html data-theme="dark"><head><style>${tokens}
      body{margin:0;background:var(--canvas-bg)}
      header{position:fixed;inset:0 0 auto;height:44px;background:var(--canvas-bg)}
      footer{position:fixed;inset:auto 0 0;height:48px;background:var(--sidebar-bg)}
      .transparent{position:fixed;inset:0;pointer-events:none}
    </style></head><body><header><span>Fixture</span></header><footer></footer><div class="transparent"></div></body></html>`);
    expect(await page.evaluate(script)).toEqual({ dark: true, top: "#171716", bottom: "#121211" });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    expect(await page.evaluate(script)).toEqual({ dark: false, top: "#faf9f6", bottom: "#f2f1ed" });
    await page.evaluate(() => { document.querySelector("header")!.style.backgroundColor = "#ffffff"; });
    expect(await page.evaluate(script)).toEqual({ dark: false, top: "#ffffff", bottom: "#f2f1ed" });
    await page.evaluate(() => {
      for (const element of [document.body, document.querySelector("header"), document.querySelector("footer")]) {
        (element as HTMLElement).style.backgroundColor = "transparent";
      }
    });
    expect(await page.evaluate(script)).toEqual({ dark: false, top: "#faf9f6", bottom: "#faf9f6" });
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    expect(await page.evaluate(script)).toBeNull();
  } finally { await browser.close(); }
});
