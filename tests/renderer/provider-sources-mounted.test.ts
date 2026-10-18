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
    import './src/renderer/components/workbench/app.css';
    window.calls=[]; window.reads=[]; window.failModels=false; window.failSave=false; window.extraModels=[];
    window.forge={listModels:async(id)=>{window.reads.push(id);if(window.failModels)throw Error('目录请求失败');return [id+'/one',id+'/two',...window.extraModels]}};
    createRoot(document.getElementById('root')).render(<TestProvider><Settings/></TestProvider>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'sources.js', loader: { '.woff2': 'dataurl' }, define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'source-host', setup(api) {
    api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({ loader: 'tsx', resolveDir: resolve('.'), contents: `
      import {createContext,useContext,useState} from 'react';
      import {defaultPublicSettings} from './src/shared/schemas';
      const C=createContext(null);export const useWorkbench=()=>useContext(C);
      export function TestProvider({children}){
        const [settings,setSettings]=useState({...defaultPublicSettings,baseUrl:'https://a.test/v1',model:'a/one',isConfigured:true,activeSourceId:'a',providerSources:[{id:'a',label:'源 A',baseUrl:'https://a.test/v1',model:'a/one',hasApiKey:true}]});
        const [isSettingsOpen,openSettings]=useState(true);
        const updateSettings=async input=>{window.calls.push(input);if(window.failSave)return false;setSettings(old=>{
          if(!input.source)return {...old,...input.settings};
          const op=input.source;let sources=old.providerSources;let active=old.activeSourceId;
          if(op.type==='save'){const prior=sources.find(s=>s.id===op.source.id);sources=[...sources.filter(s=>s.id!==op.source.id),{...op.source,hasApiKey:op.apiKey===undefined?!!prior?.hasApiKey:!!op.apiKey}];}
          if(op.type==='activate')active=op.id;
          if(op.type==='remove')sources=sources.filter(s=>s.id!==op.id);
          const selected=sources.find(s=>s.id===active);return {...old,providerSources:sources,activeSourceId:active,baseUrl:selected.baseUrl,model:selected.model,hasApiKey:selected.hasApiKey};
        });return true};
        return <C.Provider value={{state:{settings,isSettingsOpen},updateSettings,openSettings}}><output id="active" hidden>{settings.activeSourceId}</output>{children}</C.Provider>
      }` }));
  } }] });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(3000);
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.js'))!.text });
    expect(await page.getByLabel('来源名称').count()).toBe(0);
    await page.getByRole('region', { name: '源 A的模型' }).getByText('a/two', { exact: true }).waitFor();
    await page.getByRole('button', { name: /源 A.*https:\/\/a.test/ }).click();
    await page.getByRole('dialog', { name: '编辑来源 · 源 A' }).waitFor();
    await page.getByRole('button', { name: 'a/two', exact: true }).waitFor();
    expect(await page.evaluate(() => Reflect.get(window, 'reads'))).toEqual(['a']);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '添加来源' }).click();
    await page.getByRole('dialog', { name: '添加来源', exact: true }).waitFor();
    expect(await page.getByLabel('来源名称').evaluate(el => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await page.getByRole('button', { name: '关闭面板' }).evaluate(el => el === document.activeElement)).toBe(true);
    await page.locator('.provider-heading > button').first().evaluate(el => el.focus());
    expect(await page.getByRole('button', { name: '关闭面板' }).evaluate(el => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.getByLabel('来源名称').evaluate(el => el === document.activeElement)).toBe(true);
    await page.getByLabel('来源名称').fill('未保存来源');
    await page.keyboard.press('Escape');
    await page.getByText('此来源有未保存的修改，确定放弃并关闭？').waitFor();
    expect(await page.getByRole('button', { name: '继续编辑' }).evaluate(el => el === document.activeElement)).toBe(true);
    await page.getByRole('button', { name: '继续编辑' }).click();
    expect(await page.getByLabel('来源名称').inputValue()).toBe('未保存来源');
    await page.getByRole('button', { name: '关闭面板' }).click();
    await page.getByRole('button', { name: '放弃修改并关闭' }).click();
    expect(await page.getByRole('dialog').count()).toBe(0);
    expect(await page.getByRole('button', { name: '添加来源' }).evaluate(el => el === document.activeElement)).toBe(true);
    await page.getByRole('button', { name: '添加来源' }).click();
    await page.getByLabel('来源名称').fill('源 B');
    await page.getByLabel('API 地址', { exact: true }).fill('https://b.test/v1');
    await page.getByLabel('来源 API 密钥').fill('fixture-b');
    expect(await page.getByLabel('协议', { exact: true }).inputValue()).toBe('chat-completions');
    await page.getByLabel('协议', { exact: true }).selectOption('anthropic');
    await page.evaluate(() => Reflect.set(window, 'failSave', true));
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '来源保存失败' }).waitFor();
    expect(await page.getByLabel('来源 API 密钥').inputValue()).toBe('fixture-b');
    expect(await page.getByLabel('协议', { exact: true }).inputValue()).toBe('anthropic');
    await page.evaluate(() => Reflect.set(window, 'failSave', false));
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.getByText('来源已保存，可以从 /models 拉取模型。').waitFor();
    expect(await page.locator('#active').innerText()).toBe('a');
    const saved = await page.evaluate(() => Reflect.get(window, 'calls').at(-1));
    expect(saved.source.apiKey).toBe('fixture-b');
    expect(saved.source.source.apiMode).toBe('anthropic');
    expect(await page.getByRole('dialog').count()).toBe(0);
    expect(await page.locator('.provider-source-row').count()).toBe(2);
    const b = saved.source.source.id;
    await page.getByRole('region', { name: '源 B的模型' }).getByText(`${b}/two`, { exact: true }).waitFor();
    await page.getByLabel('搜索所有来源的模型').fill('/two');
    expect(await page.locator('.provider-overview-models li').count()).toBe(2);
    await page.getByLabel('搜索所有来源的模型').fill('源 B');
    expect(await page.getByRole('region', { name: '源 A的模型' }).locator('li').count()).toBe(0);
    expect(await page.getByRole('region', { name: '源 B的模型' }).locator('li').count()).toBe(2);
    await page.getByLabel('搜索所有来源的模型').fill('');
    await page.evaluate(() => Reflect.set(window, 'failModels', true));
    await page.getByRole('button', { name: '刷新源 A的模型' }).click();
    await page.getByText('目录请求失败。可点击刷新重试。').waitFor();
    expect(await page.locator('.provider-overview-models li').count()).toBe(4);
    await page.evaluate(() => Reflect.set(window, 'failModels', false));
    const captureDirectory = process.env.FORGE_QA_DIR;
    if (captureDirectory) {
      await mkdir(captureDirectory, { recursive: true });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      for (const width of [390, 1440, 1920]) {
        for (const theme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme: theme });
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          expect(await page.locator('.settings-page-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
          await page.screenshot({ path: resolve(captureDirectory, `provider-${width}-${theme}.png`), animations: 'disabled' });
        }
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    }
    await page.getByRole('button', { name: /源 B.*https:\/\/b.test/ }).click();
    if (captureDirectory) {
      for (const width of [390, 1440]) {
        for (const theme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          await page.getByLabel('搜索模型').evaluate(element => element.scrollIntoView({ block: 'center' }));
          expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
          await page.screenshot({ path: resolve(captureDirectory, `catalog-${width}-${theme}.png`), animations: 'disabled' });
        }
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    }
    await page.getByLabel('搜索模型').fill('no-such-model');
    await page.getByText('没有匹配的模型，试试其他关键词。').waitFor();
    await page.getByLabel('搜索模型').fill('/two');
    expect(await page.locator('.model-catalog-option').count()).toBe(1);
    await page.locator('.model-catalog-option').filter({ hasText: b+'/two' }).click();
    expect(await page.getByLabel('默认模型 ID').inputValue()).toBe(b+'/two');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.getByText('来源已保存，可以从 /models 拉取模型。').waitFor();
    expect((await page.evaluate(() => Reflect.get(window, 'calls').at(-1))).source.apiKey).toBeUndefined();
    await page.getByRole('button', { name: /源 B.*https:\/\/b.test/ }).click();
    await page.getByRole('button', { name: '设为当前来源' }).click();
    await expect.poll(() => page.locator('#active').innerText()).toBe(b);
    expect(await page.getByRole('button', { name: '删除来源', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: /源 A.*https:\/\/a.test/ }).click();
    expect(await page.evaluate(() => Reflect.get(window, 'reads'))).toEqual(['a', b, 'a']);
    expect(await page.getByLabel('默认模型 ID').inputValue()).toBe('a/one');
    expect(await page.getByLabel('来源 API 密钥').inputValue()).toBe('');
    await page.getByLabel('协议', { exact: true }).selectOption('responses');
    expect(await page.locator('.model-catalog-option').count()).toBe(0);
    expect(await page.locator('.provider-heading > button').first().isDisabled()).toBe(true);
    await page.getByRole('button', { name: '放弃此来源修改' }).click();
    await page.getByRole('button', { name: 'a/two', exact: true }).waitFor();
    await page.getByLabel('API 地址', { exact: true }).fill('https://changed.test/v1');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    expect(await page.getByRole('alert').innerText()).toContain('重新填写密钥');
    await page.getByRole('button', { name: '放弃此来源修改' }).click();
    await page.getByRole('button', { name: 'a/two', exact: true }).waitFor();
    await page.evaluate(() => Reflect.set(window, 'failModels', true));
    await page.getByRole('button', { name: '从 /models 拉取' }).click();
    expect(await page.getByRole('alert').innerText()).toBe('目录请求失败');
    expect(await page.getByRole('button', { name: 'a/two', exact: true }).count()).toBe(1);
    expect(await page.locator('#active').innerText()).toBe(b);
    await page.evaluate(() => {
      Reflect.set(window, 'failModels', false);
      Reflect.set(window, 'extraModels', Array.from({ length: 65 }, (_, index) => 'long-provider/'.repeat(12) + index));
    });
    await page.getByRole('button', { name: '从 /models 拉取' }).click();
    await expect.poll(() => page.locator('.model-catalog-option').count()).toBe(50);
    await page.getByRole('button', { name: '显示更多（剩余 17 个）' }).click();
    expect(await page.locator('.model-catalog-option').count()).toBe(67);
    await page.setViewportSize({ width: 390, height: 900 });
    expect(await page.locator('.provider-catalog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    const outsideModels = page.getByRole('region', { name: '源 A的模型' }).locator('.provider-overview-models');
    expect(await outsideModels.locator('li').count()).toBe(67);
    await outsideModels.locator('li').last().scrollIntoViewIfNeeded();
    expect(await outsideModels.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: /源 A.*https:\/\/a.test/ }).click();
    await page.getByRole('button', { name: '删除来源', exact: true }).click();
    expect(await page.getByText('删除“源 A”及其保存的密钥？此操作不可撤销。').count()).toBe(1);
    await page.getByRole('button', { name: '确认删除来源' }).click();
    await page.getByText('来源已删除。其他来源不受影响。').waitFor();
    expect(await page.getByRole('button', { name: /源 A.*https:\/\/a.test/ }).count()).toBe(0);
  } finally { await browser.close(); }
}, 20000);
