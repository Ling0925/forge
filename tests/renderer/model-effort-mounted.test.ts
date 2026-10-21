import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("styles the model picker before Settings loads and preserves configured efforts on desktop and mobile", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {useState} from 'react';
      import {ModelPicker} from './src/renderer/components/workbench/ModelPicker';
      import {settingsFields} from './src/shared/schemas';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/styles/workspace-theme.css';
      // Do not preload Settings or its CSS: the picker must own its styles.
      function App() {
        const [model,select] = useState('provider/long-model-name');
        const [effort,setEffort] = useState('default');
        const [disabled,disable] = useState(false);
        const [options,setOptions] = useState(undefined);
        window.setEffortOptions = setOptions;
        return <div className="wb-app"><div style={{position:'absolute',bottom:40,right:24}}>
          <ModelPicker value={model} sourceLabel={model ? 'LingAPI' : undefined} models={['provider/long-model-name','provider/beta']} onSelect={select}
            onRefresh={()=>{}} loading={false} error="" disabled={disabled} reasoning={{value:effort,options,onChange:value=>setEffort(settingsFields.reasoningEffort.unwrap().parse(value)),disabled}} />
          <button onClick={()=>disable(value=>!value)}>切换禁用</button>
          <button onClick={()=>select('')}>清空模型</button>
          {['default','none','minimal'].map(value => <button key={value} onClick={()=>setEffort(value)}>{value}</button>)}
          <output id="saved-effort">{effort}</output>
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
    const labels = ["low", "medium", "high", "xhigh", "MAX"];
    const trigger = page.locator(".composer-model-summary");
    // Unknown capability retains the usual five choices plus the actual setting.
    for (const width of [1440, 390]) for (const configured of ["default", "none", "minimal"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: configured, exact: true }).click();
      await trigger.click();
      const slider = page.getByRole("slider", { name: "思考等级", exact: true });
      await slider.waitFor();
      expect(await page.locator(".model-picker-heading").evaluate(node => getComputedStyle(node).display)).toBe("flex");
      expect(await page.locator(".model-picker-current").evaluate(node => getComputedStyle(node).display)).toBe("flex");
      expect(await page.locator(".model-effort-options").evaluate(node => getComputedStyle(node).borderTopWidth)).toBe("0px");
      expect(await slider.evaluate(node => getComputedStyle(node).appearance)).toBe("none");
      expect(await page.locator(".effort-slider-labels").evaluate(node => getComputedStyle(node).display)).toBe("flex");
      expect(await page.locator(".effort-slider-labels > span").allTextContents()).toEqual([configured, ...labels]);
      expect(await page.locator("#saved-effort").textContent()).toBe(configured);
      expect(await slider.getAttribute("aria-valuetext")).toBe(configured);
      expect(await trigger.getAttribute("title")).toContain(`思考：${configured}`);
      expect(await page.locator(".model-effort-meter > span").count()).toBe(6);
      const labelBoxes = await page.locator(".effort-slider-labels > span").evaluateAll(nodes => nodes.map(node => {
        const { left, right } = node.getBoundingClientRect();
        return { left, right };
      }));
      for (let index = 1; index < labelBoxes.length; index++) {
        expect(labelBoxes[index]!.left - labelBoxes[index - 1]!.right).toBeGreaterThanOrEqual(4);
      }
      await slider.press("Home");
      expect(await page.locator("#saved-effort").textContent()).toBe(configured);
      await slider.press("ArrowRight");
      expect(await page.locator("#saved-effort").textContent()).toBe("low");
      await page.keyboard.press("Escape");
    }
    for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await trigger.click();
      const currentModel = page.getByRole("button", { name: /^选择模型：/ });
      await currentModel.waitFor();
      expect(await currentModel.locator("small").textContent()).toBe("LingAPI");
      for (const selector of [".model-picker-heading > *", ".model-picker-current > *", ".effort-slider-labels > span"]) {
        const boxes = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
          const { left, right } = node.getBoundingClientRect();
          return { left, right };
        }));
        for (let index = 1; index < boxes.length; index++) {
          expect(boxes[index]!.left - boxes[index - 1]!.right).toBeGreaterThanOrEqual(4);
        }
      }
      expect(await page.locator(".model-catalog").count()).toBe(0);
      expect(await currentModel.evaluate(node => node === document.activeElement)).toBe(true);
      expect(await page.locator(".effort-slider-labels > span").allTextContents()).toEqual(labels);
      expect(await page.locator(".model-effort-options legend").textContent()).toBe("思考等级");
      expect(await page.locator(".composer-model-panel").textContent()).not.toMatch(/默认|default/);
      const slider = page.getByRole("slider", { name: "思考等级", exact: true });
      expect(await slider.getAttribute("max")).toBe("4");
      await slider.press("Home");
      expect(await page.locator(".effort-slider-heading").textContent()).toBe("low");
      for (const [index, label] of labels.entries()) {
        if (index) await slider.press("ArrowRight");
        expect(await slider.getAttribute("aria-valuetext")).toBe(label);
        expect(await page.locator("#saved-effort").textContent()).toBe(label.toLowerCase());
        expect(await page.locator(".effort-slider-heading output").textContent()).toBe(label);
        expect(await trigger.getAttribute("title")).toContain(`思考：${label}`);
        expect(await page.locator(".model-effort-meter > span").count()).toBe(5);
        expect(await page.locator(".model-effort-meter .is-filled").count()).toBe(index + 1);
        expect(await page.locator(".model-effort-meter").getAttribute("aria-label")).toBe(`思考等级：${label}，${index + 1}/5`);
        expect(await page.locator(".effort-slider").getAttribute("data-max")).toBe(String(label === "MAX"));
      }
      await slider.press("ArrowRight");
      expect(await slider.getAttribute("aria-valuetext")).toBe("MAX");
      expect(await page.locator(".effort-slider-fill").evaluate(node => getComputedStyle(node, "::after").animationName)).toBe("effort-shimmer");
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.locator(".effort-slider-fill").evaluate(node => getComputedStyle(node, "::after").animationName)).toBe("none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await currentModel.click();
      const search = page.getByLabel("搜索模型或输入精确 ID");
      await search.waitFor();
      expect(await page.locator(".model-catalog-list").evaluate(node => getComputedStyle(node).display)).toBe("flex");
      expect(await page.locator(".model-catalog-option").first().evaluate(node => getComputedStyle(node).display)).toBe("flex");
      expect(await slider.count()).toBe(0);
      expect(await search.evaluate(node => node === document.activeElement)).toBe(width > 768);
      expect(await page.locator(".composer-model-panel").textContent()).not.toMatch(/默认|default/);
      const catalogPanel = await page.locator(".composer-model-panel").boundingBox();
      if (!catalogPanel) throw new Error("Missing catalog panel");
      expect(catalogPanel.x).toBeGreaterThanOrEqual(0);
      expect(catalogPanel.x + catalogPanel.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      expect(await page.locator(".model-catalog").count()).toBe(0);
      expect(await currentModel.evaluate(node => node === document.activeElement)).toBe(true);
      await currentModel.press("Enter");
      await page.getByRole("button", { name: "返回模型设置" }).click();
      expect(await page.locator(".model-catalog").count()).toBe(0);
      await currentModel.click();
      await page.getByRole("button", { name: /beta.*provider\/beta/ }).click();
      expect(await page.locator("details[open]").count()).toBe(1);
      expect(await page.locator(".model-catalog").count()).toBe(0);
      expect(await currentModel.textContent()).toContain("beta");
      expect(await currentModel.evaluate(node => node === document.activeElement)).toBe(true);
      const panel = await page.locator(".composer-model-panel").boundingBox();
      if (!panel) throw new Error("Missing panel");
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `/tmp/forge-model-effort-${width}-${theme}.png` });
      const bounds = await slider.boundingBox();
      if (!bounds) throw new Error("Missing slider");
      await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 4, bounds.y + bounds.height / 2, { steps: 8 });
      expect(await slider.getAttribute("aria-valuetext")).toBe("medium");
      expect(await page.locator(".model-effort-meter .is-filled").count()).toBe(5);
      await page.mouse.up();
      expect(await page.locator(".model-effort-meter .is-filled").count()).toBe(2);
      await page.keyboard.press("Escape");
      expect(await trigger.evaluate(node => node === document.activeElement)).toBe(true);
    }
    await page.getByRole("button", { name: "切换禁用" }).click();
    await trigger.click();
    expect(await page.getByRole("slider", { name: "思考等级", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: /^选择模型：/ }).click();
    expect(await page.locator(".model-catalog-option[aria-pressed]").evaluateAll(nodes => nodes.every(node => (node as HTMLButtonElement).disabled))).toBe(true);
    await page.getByRole("button", { name: "切换禁用" }).click();
    expect(await page.locator("details[open]").count()).toBe(0);
    await trigger.click();
    expect(await page.locator(".model-catalog").count()).toBe(0);
    await page.getByRole("button", { name: "清空模型" }).click();
    await trigger.click();
    expect(await page.getByRole("button", { name: "选择模型：选择模型", exact: true }).textContent()).toBe("选择模型");
    expect(await page.locator(".composer-model-panel").textContent()).not.toMatch(/默认|default/);
    await page.getByRole("button", { name: "选择模型：选择模型", exact: true }).click();
    expect(await page.locator(".model-catalog-option[aria-pressed='true']").count()).toBe(0);
    expect(await page.locator(".model-catalog-option[aria-pressed]").count()).toBe(2);
    expect(await page.locator(".composer-model-panel").textContent()).not.toMatch(/默认|default/);

    // Configured levels can include none/minimal, but not unknown wire values.
    await page.getByRole("button", { name: "none", exact: true }).click();
    await page.evaluate(() => Reflect.get(window, "setEffortOptions")(["none", "minimal", "high", "vendor-only", "high"]));
    await trigger.click();
    const configured = page.getByRole("slider", { name: "思考等级", exact: true });
    await expect.poll(() => page.locator(".effort-slider-labels > span").allTextContents()).toEqual(["none", "minimal", "high"]);
    expect(await trigger.getAttribute("title")).toContain("思考：none");
    await configured.press("ArrowRight");
    expect(await page.locator("#saved-effort").textContent()).toBe("minimal");

    // Keep the current setting until an explicit choice changes it. Once only
    // one level remains, the slider must still have a finite fill width.
    await page.evaluate(() => Reflect.get(window, "setEffortOptions")(["max"]));
    await expect.poll(() => page.locator(".effort-slider-labels > span").allTextContents()).toEqual(["minimal", "MAX"]);
    expect(await configured.getAttribute("aria-valuetext")).toBe("minimal");
    await configured.press("End");
    await expect.poll(() => page.locator("#saved-effort").textContent()).toBe("max");
    await expect.poll(() => configured.getAttribute("max")).toBe("0");
    expect(await page.locator(".effort-slider-fill").evaluate(node => (node as HTMLElement).style.width)).toBe("0%");
    await page.evaluate(() => Reflect.get(window, "setEffortOptions")(["vendor-only"]));
    await expect.poll(() => page.locator(".effort-slider-labels > span").allTextContents()).toEqual(["MAX"]);
    expect(await configured.getAttribute("aria-valuetext")).toBe("MAX");
    expect(await page.getByRole("button", { name: /^选择模型：/ }).count()).toBe(1);
  } finally { await browser.close(); }
}, 20000);
