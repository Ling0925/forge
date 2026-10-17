import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("desktop slash commands stay local, filter, navigate, and preserve IME and literal prompts", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {Composer} from './src/renderer/components/workbench/Composer';
      window.calls=[]; window.forge={listModels:async()=>['test/model']};
      createRoot(document.getElementById('root')).render(<Composer/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "test.js",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "mock", setup(api) {
      api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({ loader: "tsx", resolveDir: resolve("."), contents: `
        import {defaultPublicSettings} from './src/shared/schemas';
        export const useWorkbench=()=>({
          state:{activeSessionId:'a',activeSnapshot:{model:'test/model',workspace:'/tmp'},sessions:[],
            settings:{...defaultPublicSettings,isConfigured:false},activeRuns:{}},
          startRun:async(prompt)=>{window.calls.push(prompt);return false;},
          openSettings:()=>window.calls.push('settings'),openNewSession:()=>window.calls.push('new'),
          cancelRun:async()=>window.calls.push('stop'),updateSettings:async()=>true
        });
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.js'))!.text });
    const input = page.locator('textarea');
    const calls = () => page.evaluate(() => (window as unknown as {calls: string[]}).calls);
    await input.fill('/');
    expect(await page.getByRole('option').count()).toBe(7);
    await input.press('ArrowDown');
    await input.press('Tab');
    expect(await input.inputValue()).toBe('/new');
    await input.press('Escape');
    expect(await page.getByRole('listbox').count()).toBe(0);
    expect(await input.inputValue()).toBe('/new');
    await input.press('Enter');
    expect(await calls()).toEqual(['new']);
    await input.fill('/he');
    await input.dispatchEvent('keydown', {key:'Enter',isComposing:true});
    expect(await input.inputValue()).toBe('/he');
    await input.press('Enter');
    expect(await page.locator('.composer-slash-message').innerText()).toContain('/permission');
    await input.fill('/unknown');
    await input.press('Enter');
    expect(await page.locator('.composer-slash-message').innerText()).toContain('未知命令');
    expect(await input.inputValue()).toBe('/unknown');
    await input.fill('/stop');
    await input.press('Enter');
    expect(await page.locator('.composer-slash-message').innerText()).toContain('没有正在执行');
    await input.fill('/mode');
    await input.press('Enter');
    await expect.poll(() => page.getByRole('menu', {name:'运行模式'}).count()).toBe(1);
    await page.getByRole('menuitemradio', {name:/Plan/}).click();
    await input.fill('/permission');
    await input.press('Enter');
    expect(await page.locator('.composer-slash-message').innerText()).toContain('不可用');
    await input.fill('/settings');
    await page.getByRole('option').click();
    expect(await calls()).toEqual(['new','settings']);
    await input.fill('//help');
    expect(await page.getByRole('listbox').count()).toBe(0);
    await input.press('Enter');
    expect(await calls()).toEqual(['new','settings']); // unconfigured ordinary sends remain blocked
  } finally { await browser.close(); }
}, 30000);
