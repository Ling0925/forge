import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("composer choices support keyboard selection, dismissal and focus restoration", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import {createRoot} from 'react-dom/client';
        import {useState} from 'react';
        import {ComposerDropdown} from './src/renderer/components/workbench/ComposerDropdown';
        function Harness() {
          const [value, setValue] = useState('workspace');
          return <>
            <ComposerDropdown value={value} onChange={setValue} ariaLabel="权限"
              options={[
                {value:'workspace', label:'工作区'},
                {value:'readonly', label:'只读'},
                {value:'unrestricted', label:'无限制'}
              ]} />
            <button>外部</button>
          </>;
        }
        createRoot(document.getElementById('root')).render(<Harness />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const script = bundle.outputFiles[0]?.text;
  if (!script) throw new Error("Missing mounted test bundle");
  const executablePath = process.env.FORGE_BROWSER_EXECUTABLE;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: script });
    const trigger = page.getByRole("button", { name: "权限", exact: true });
    const outside = page.getByRole("button", { name: "外部" });
    await trigger.focus();
    await trigger.press("ArrowDown");
    await page.getByRole("menuitemradio", { name: "工作区" }).waitFor();
    expect(await page.locator(":focus").innerText()).toBe("工作区");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(await trigger.innerText()).toBe("只读");
    expect(await trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      await trigger.evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await trigger.press("ArrowDown");
    await page.keyboard.press("End");
    expect(await page.locator(":focus").innerText()).toBe("无限制");
    await page.keyboard.press("Home");
    expect(await page.locator(":focus").innerText()).toBe("工作区");
    await page.keyboard.press("Escape");
    expect(await trigger.getAttribute("aria-expanded")).toBe("false");
    expect(await trigger.innerText()).toBe("只读");
    await trigger.click();
    await page.keyboard.press("Tab");
    expect(await trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      await outside.evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await trigger.click();
    await outside.click();
    expect(await page.getByRole("menu").count()).toBe(0);
  } finally {
    await browser.close();
  }
});
