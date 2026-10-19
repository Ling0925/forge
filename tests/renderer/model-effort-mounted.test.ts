import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("combines model and effort with five readable levels on desktop and mobile", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {useState} from 'react';
      import {ModelPicker} from './src/renderer/components/workbench/ModelPicker';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/styles/workspace-theme.css';
      import './src/renderer/styles/settings-models.css';
      function App() {
        const [model,select] = useState('provider/long-model-name');
        const [effort,setEffort] = useState('default');
        const [disabled,disable] = useState(false);
        return <div className="wb-app"><div style={{position:'absolute',bottom:40,right:24}}>
          <ModelPicker value={model} models={['provider/long-model-name','provider/beta']} onSelect={select}
            onRefresh={()=>{}} loading={false} error="" reasoning={{value:effort,onChange:setEffort,disabled}} />
          <button onClick={()=>disable(value=>!value)}>切换禁用</button>
        </div></div>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "effort.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text;
  if (!js || !css) throw new Error("Missing bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(4000);
    await page.setContent(`<style>${css}</style><div id="root"></div>`);
    await page.addScriptTag({ content: js });
    for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const trigger = page.locator(".composer-model-summary");
      await trigger.click();
      const search = page.getByLabel("搜索模型或输入精确 ID");
      await search.waitFor();
      const labels = ["default", "none", "minimal", "low", "medium", "high", "xhigh"];
      expect(await page.locator(".effort-slider-labels > span").allTextContents()).toEqual(labels);
      expect(await page.locator(".model-effort-options legend").textContent()).toBe("思考等级");
      if (width === 390) expect(await search.evaluate(node => node === document.activeElement)).toBe(false);
      const slider = page.getByRole("slider", { name: "思考等级", exact: true });
      await slider.press("Home");
      expect(await page.locator(".effort-slider-heading").textContent()).toBe("default");
      for (const [index, label] of labels.entries()) {
        if (index) await slider.press("ArrowRight");
        expect(await slider.getAttribute("aria-valuetext")).toBe(label);
        expect(await page.locator(".effort-slider-heading output").textContent()).toBe(label);
        expect(await trigger.getAttribute("title")).toContain(`思考：${label}`);
        expect(await page.locator(".model-effort-meter > span").count()).toBe(5);
        expect(await page.locator(".model-effort-meter .is-filled").count()).toBe(Math.max(0, index - 1));
        expect(await page.locator(".model-effort-meter").getAttribute("aria-label")).toContain(label);
        if (index <= 1) expect(await page.locator(".model-effort-meter small").textContent()).toBe(label);
      }
      expect(await page.locator(".effort-slider-fill").evaluate(node => getComputedStyle(node, "::after").animationName)).toBe("effort-shimmer");
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.locator(".effort-slider-fill").evaluate(node => getComputedStyle(node, "::after").animationName)).toBe("none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.getByRole("button", { name: /beta.*provider\/beta/ }).click();
      expect(await page.locator("details[open]").count()).toBe(1);
      const panel = await page.locator(".composer-model-panel").boundingBox();
      if (!panel) throw new Error("Missing panel");
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `/tmp/forge-model-effort-${width}-${theme}.png` });
      const bounds = await slider.boundingBox();
      if (!bounds) throw new Error("Missing slider");
      await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 8 });
      expect(await slider.getAttribute("aria-valuetext")).toBe("low");
      expect(await page.locator(".model-effort-meter .is-filled").count()).toBe(5);
      await page.mouse.up();
      expect(await page.locator(".model-effort-meter .is-filled").count()).toBe(2);
      await page.keyboard.press("Escape");
      expect(await trigger.evaluate(node => node === document.activeElement)).toBe(true);
    }
    await page.getByRole("button", { name: "切换禁用" }).click();
    await page.locator(".composer-model-summary").click();
    expect(await page.getByRole("slider", { name: "思考等级", exact: true }).isDisabled()).toBe(true);
  } finally { await browser.close(); }
}, 20000);
