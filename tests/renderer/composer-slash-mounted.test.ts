import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { SLASH_COMMANDS } from "../../src/cli/commands";

it("desktop uses the CLI catalog and executes arguments without sending prompts", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {Composer} from './src/renderer/components/workbench/Composer';
      window.calls=[];
      window.forge={listModels:async()=>['test/model'], getDiagnostics:async id=>({messageCount:3}),
        renameSession:async(id,title)=>{window.calls.push('rename:'+title);return {id,model:'test/model'};},
        createSession:async input=>{window.calls.push('new:'+input.model);return {id:'a',model:input.model};}};
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
          startRun:async(prompt)=>{window.calls.push('PROMPT:'+prompt);return false;},
          dispatch:()=>{},loadSessions:async()=>{},updateSettings:async()=>true
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
    const output = () => page.locator('.composer-slash-message').innerText();
    const calls = () => page.evaluate(() => (window as unknown as {calls: string[]}).calls);
    await input.fill('/');
    expect(await page.getByRole('option').locator('strong').allTextContents()).toEqual(SLASH_COMMANDS.map(c => c.name));
    await input.press('ArrowDown');
    await input.press('Tab');
    expect(await input.inputValue()).toBe('/steer');
    await input.press('Escape');
    expect(await page.getByRole('listbox').count()).toBe(0);
    await input.press('Enter');
    await expect.poll(output).toContain('尚未提供');
    await input.fill('/he');
    await input.dispatchEvent('keydown', {key:'Enter',isComposing:true});
    expect(await input.inputValue()).toBe('/he');
    await input.press('Enter');
    await expect.poll(output).toContain('/checkpoints');
    await input.fill('/settings');
    await input.press('Enter');
    await expect.poll(output).toContain('Unknown');
    await input.fill('/mode');
    await input.press('Enter');
    await expect.poll(output).toBe('Mode: build');
    await input.fill('/mode plan');
    await input.press('Enter');
    await expect.poll(() => page.locator('#run-mode').inputValue()).toBe('plan');
    await input.fill('/mode build');
    await input.press('Enter');
    await input.fill('/permission readonly');
    await input.press('Enter');
    await expect.poll(() => page.locator('#run-permission').inputValue()).toBe('readonly');
    await input.fill('/model vendor/other');
    await input.press('Enter');
    await expect.poll(output).toBe('Model: vendor/other');
    await input.fill('/rename title with spaces');
    await input.press('Enter');
    await expect.poll(calls).toEqual(['rename:title with spaces']);
    await input.fill('/diagnostics');
    await input.press('Enter');
    await expect.poll(output).toContain('messageCount');
    await input.fill('/new');
    await page.getByRole('option').click();
    await expect.poll(calls).toEqual(['rename:title with spaces','new:vendor/other']);
    expect((await calls()).some(c => c.startsWith('PROMPT:'))).toBe(false);
  } finally { await browser.close(); }
}, 30000);
