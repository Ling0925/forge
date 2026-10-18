import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("manages independent sources, fetches selected /models, saves model selection and confirms deletion", async () => {
  const bundle = await build({ stdin: { resolveDir: resolve('.'), loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';
    import {Settings} from './src/renderer/components/workbench/Settings';
    import {TestProvider} from './src/renderer/state/workbench-context';
    import './src/renderer/styles/global.css';
    window.calls=[]; window.reads=[]; window.failModels=false;
    window.forge={listModels:async(id)=>{window.reads.push(id);if(window.failModels)throw Error('目录请求失败');return [id+'/one',id+'/two']}};
    createRoot(document.getElementById('root')).render(<TestProvider><Settings/></TestProvider>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'sources.js', loader: { '.woff2': 'dataurl' }, define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'source-host', setup(api) {
    api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({ loader: 'tsx', resolveDir: resolve('.'), contents: `
      import {createContext,useContext,useState} from 'react';
      import {defaultPublicSettings} from './src/shared/schemas';
      const C=createContext(null);export const useWorkbench=()=>useContext(C);
      export function TestProvider({children}){
        const [settings,setSettings]=useState({...defaultPublicSettings,baseUrl:'https://a.test/v1',model:'a/one',isConfigured:true,activeSourceId:'a',providerSources:[{id:'a',label:'源 A',baseUrl:'https://a.test/v1',model:'a/one',hasApiKey:true}]});
        const [isSettingsOpen,openSettings]=useState(true);
        const updateSettings=async input=>{window.calls.push(input);setSettings(old=>{
          if(!input.source)return {...old,...input.settings};
          const op=input.source;let sources=old.providerSources;let active=old.activeSourceId;
          if(op.type==='save'){const prior=sources.find(s=>s.id===op.source.id);sources=[...sources.filter(s=>s.id!==op.source.id),{...op.source,hasApiKey:op.apiKey===undefined?!!prior?.hasApiKey:!!op.apiKey}];}
          if(op.type==='activate')active=op.id;
          if(op.type==='remove')sources=sources.filter(s=>s.id!==op.id);
          const selected=sources.find(s=>s.id===active);return {...old,providerSources:sources,activeSourceId:active,baseUrl:selected.baseUrl,model:selected.model,hasApiKey:selected.hasApiKey};
        });return true};
        return <C.Provider value={{state:{settings,isSettingsOpen},updateSettings,openSettings}}><output id="active">{settings.activeSourceId}</output>{children}</C.Provider>
      }` }));
  } }] });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(3000);
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.js'))!.text });
    await page.getByRole('button', { name: '从 /models 拉取' }).click();
    await page.getByRole('button', { name: /two.*a\/two/ }).waitFor();
    expect(await page.evaluate(() => Reflect.get(window, 'reads'))).toEqual(['a']);
    await page.getByRole('button', { name: '添加来源' }).click();
    await page.getByLabel('来源名称').fill('源 B');
    await page.getByLabel('API 地址', { exact: true }).fill('https://b.test/v1');
    await page.getByLabel('来源 API 密钥').fill('fixture-b');
    expect(await page.getByLabel('协议', { exact: true }).inputValue()).toBe('chat-completions');
    await page.getByLabel('协议', { exact: true }).selectOption('anthropic');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.getByText('来源已保存，可以从 /models 拉取模型。').waitFor();
    expect(await page.locator('#active').innerText()).toBe('a');
    const saved = await page.evaluate(() => Reflect.get(window, 'calls').at(-1));
    expect(saved.source.apiKey).toBe('fixture-b');
    expect(saved.source.source.apiMode).toBe('anthropic');
    const captureDirectory = process.env.FORGE_QA_DIR;
    if (captureDirectory) {
      await mkdir(captureDirectory, { recursive: true });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      for (const width of [390, 1440]) {
        for (const theme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme: theme });
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          await page.getByLabel('协议', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
          await page.screenshot({ path: resolve(captureDirectory, `provider-${width}-${theme}.png`), animations: 'disabled' });
        }
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    }
    const b = saved.source.source.id;
    await page.getByRole('button', { name: '从 /models 拉取' }).click();
    await page.locator('.model-catalog-option').filter({ hasText: b+'/two' }).click();
    expect(await page.getByLabel('默认模型 ID').inputValue()).toBe(b+'/two');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.getByText('来源已保存，可以从 /models 拉取模型。').waitFor();
    expect((await page.evaluate(() => Reflect.get(window, 'calls').at(-1))).source.apiKey).toBeUndefined();
    await page.getByRole('button', { name: '设为当前来源' }).click();
    await expect.poll(() => page.locator('#active').innerText()).toBe(b);
    expect(await page.getByRole('button', { name: '删除来源', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: /源 A.*https:\/\/a.test/ }).click();
    expect(await page.getByLabel('默认模型 ID').inputValue()).toBe('a/one');
    expect(await page.getByLabel('来源 API 密钥').inputValue()).toBe('');
    await page.getByLabel('API 地址', { exact: true }).fill('https://changed.test/v1');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    expect(await page.getByRole('alert').innerText()).toContain('重新填写密钥');
    await page.getByRole('button', { name: '放弃此来源修改' }).click();
    await page.evaluate(() => Reflect.set(window, 'failModels', true));
    await page.getByRole('button', { name: '从 /models 拉取' }).click();
    expect(await page.getByRole('alert').innerText()).toBe('目录请求失败');
    expect(await page.locator('#active').innerText()).toBe(b);
    await page.getByRole('button', { name: '删除来源', exact: true }).click();
    expect(await page.getByText('删除“源 A”及其保存的密钥？此操作不可撤销。').count()).toBe(1);
    await page.getByRole('button', { name: '确认删除来源' }).click();
    await page.getByText('来源已删除。其他来源不受影响。').waitFor();
    expect(await page.getByRole('button', { name: /源 A.*https:\/\/a.test/ }).count()).toBe(0);
  } finally { await browser.close(); }
}, 20000);
