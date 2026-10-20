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
    window.calls=[]; window.reads=[]; window.refreshes=[]; window.failModels=false; window.failSave=false; window.extraModels=[];
    window.forge={listModels:async(id,refresh)=>{window.reads.push(id);if(refresh)window.refreshes.push(id);if(window.failModels)throw Error('目录请求失败');return [id+'/one',id+'/two',...window.extraModels]}};
    createRoot(document.getElementById('root')).render(<TestProvider><Settings/></TestProvider>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'sources.js', loader: { '.woff2': 'dataurl' }, define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'source-host', setup(api) {
    api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({ loader: 'tsx', resolveDir: resolve('.'), contents: `
      import {createContext,useContext,useState} from 'react';
      import {defaultPublicSettings} from './src/shared/schemas';
      const C=createContext(null);export const useWorkbench=()=>useContext(C);
      let revision=1;
      export function TestProvider({children}){
        const [settings,setSettings]=useState({...defaultPublicSettings,baseUrl:'https://a.test/v1',model:'a/one',isConfigured:true,activeSourceId:'a',providerSources:[{id:'a',label:'源 A',baseUrl:'https://a.test/v1',model:'a/one',revision:1,hasApiKey:true}]});
        const [isSettingsOpen,openSettings]=useState(true);
        const commit=next=>{setSettings(next);return {ok:true,settings:next};};
        const updateSettings=async input=>{window.calls.push(input);if(window.failSave)return {ok:false,error:'来源保存失败，输入已保留。请检查地址与配置后重试。'};
          const op=input.source;
          if(!op)return {ok:false,error:'unexpected settings patch'};
          const sources=settings.providerSources;
          if(op.type==='activate'){
            const selected=sources.find(s=>s.id===op.id);
            return commit({...settings,activeSourceId:op.id,baseUrl:selected.baseUrl,model:selected.model});
          }
          if(op.type==='remove'){
            return commit({...settings,providerSources:sources.filter(s=>s.id!==op.id)});
          }
          const prior=sources.find(s=>s.id===op.source.id);
          if(op.expectedRevision!==undefined&&prior&&prior.revision!==op.expectedRevision)
            return {ok:false,error:'该来源已被其他窗口或 CLI 修改。请重新加载设置后再保存，避免覆盖对方的改动。'};
          const saved={...op.source,revision:++revision,hasApiKey:op.apiKey===undefined?!!prior?.hasApiKey:!!op.apiKey};
          return commit({...settings,providerSources:[...sources.filter(s=>s.id!==saved.id),saved]});
        };
        return <C.Provider value={{state:{settings,isSettingsOpen},updateSettings,openSettings}}><output id="active" hidden>{settings.activeSourceId}</output>{children}</C.Provider>
      }` }));
  } }] });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(3000);
    await page.route('https://forge.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('https://forge.test/');
    await page.addStyleTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.js'))!.text });
    expect(await page.getByLabel('来源名称').count()).toBe(0);
    await expect.poll(() => page.locator('.provider-source-card').first().innerText()).toContain('a/one');
    expect(await page.evaluate(() => Reflect.get(window, 'reads'))).toEqual(['a']);
    // A new page/module instance must reuse localStorage without another remote request.
    await page.reload();
    await page.addStyleTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.css'))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.js'))!.text });
    await expect.poll(() => page.locator('.provider-source-card').first().innerText()).toContain('a/one');
    expect(await page.evaluate(() => Reflect.get(window, 'reads'))).toEqual([]);
    await page.getByRole('button', { name: '编辑源 A', exact: true }).click();
    await page.getByRole('dialog', { name: '编辑来源 · 源 A' }).waitFor();
    await page.getByRole('button', { name: 'a/two', exact: true }).waitFor();
    expect(await page.evaluate(() => Reflect.get(window, 'reads'))).toEqual([]);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '添加来源' }).click();
    await page.getByRole('dialog', { name: '添加来源', exact: true }).waitFor();
    expect(await page.getByLabel('来源名称').evaluate(el => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Shift+Tab');
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
    await page.getByRole('button', { name: '添加来源' }).click();
    // The endpoint is validated before saving, so an invalid URL never reaches the store.
    await page.getByLabel('来源名称').fill('源 B');
    await page.getByLabel('API 地址', { exact: true }).fill('not-a-url');
    await page.getByText('API 地址必须是完整的 http(s) URL。').waitFor();
    expect(await page.getByRole('button', { name: '保存来源', exact: true }).isDisabled()).toBe(true);
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
    await page.getByText('来源已保存。选择一个模型即可自动使用该来源。').waitFor();
    expect(await page.locator('#active').innerText()).toBe('a');
    const saved = await page.evaluate(() => Reflect.get(window, 'calls').at(-1));
    expect(saved.source.source).toMatchObject({ label: '源 B', apiMode: 'anthropic' });
    expect(saved.source.apiKey).toBe('fixture-b');
    expect(await page.getByRole('dialog').count()).toBe(0);
    const b = saved.source.source.id;
    expect(await page.locator('.provider-source-card').count()).toBe(2);
    const cards = await page.locator('.provider-source-card').allInnerTexts();
    expect(cards[0]).toContain('默认');
    expect(cards[1]).toContain('源 B');
    await page.getByRole('button', { name: '刷新源 B的模型' }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'reads'))).toContain(b);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'refreshes'))).toContain(b);
    await page.evaluate(() => Reflect.set(window, 'failModels', true));
    await page.getByRole('button', { name: '刷新源 A的模型' }).click();
    await page.getByText('目录加载失败：目录请求失败').waitFor();
    await page.evaluate(() => Reflect.set(window, 'failModels', false));
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator('.settings-page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.locator('.settings-navigation').evaluate(el => el.clientWidth <= 390)).toBe(true);
    expect(await page.locator('.settings-save-bar').evaluate(el => el.clientWidth <= 390)).toBe(true);
    expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
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
    await page.getByRole('button', { name: '编辑源 B', exact: true }).click();
    await page.getByRole('dialog', { name: '编辑来源 · 源 B' }).waitFor();
    await page.getByLabel('搜索模型').fill('no-such-model');
    await page.getByText('没有匹配的模型，试试其他关键词。').waitFor();
    await page.getByLabel('搜索模型').fill('/two');
    expect(await page.locator('.model-catalog-option').count()).toBe(1);
    await page.locator('.model-catalog-option').filter({ hasText: b + '/two' }).click();
    expect(await page.getByLabel('默认模型 ID').inputValue()).toBe(b + '/two');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.getByText('来源已保存。选择一个模型即可自动使用该来源。').waitFor();
    expect((await page.evaluate(() => Reflect.get(window, 'calls').at(-1))).source.apiKey).toBeUndefined();
    expect(await page.getByRole('dialog').count()).toBe(0);
    await page.getByRole('button', { name: '编辑源 A', exact: true }).click();
    expect(await page.getByLabel('默认模型 ID').inputValue()).toBe('a/one');
    expect(await page.getByLabel('来源 API 密钥').inputValue()).toBe('');
    await page.getByLabel('协议', { exact: true }).selectOption('responses');
    await page.getByRole('button', { name: '放弃此来源修改' }).click();
    await page.getByLabel('API 地址', { exact: true }).fill('https://changed.test/v1');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    expect(await page.getByRole('alert').innerText()).toContain('重新填写密钥');
    await page.getByRole('button', { name: '放弃此来源修改' }).click();
    await page.evaluate(() => Reflect.set(window, 'failModels', true));
    await page.getByRole('button', { name: '从 /models 拉取' }).click();
    expect(await page.getByRole('alert').innerText()).toBe('目录请求失败');
    expect(await page.locator('#active').innerText()).toBe('a');
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
    // The editor is a true modal now: settings navigation cannot be clicked
    // behind it, so a hidden-but-open dialog is no longer possible.
    expect(await page.getByRole('button', { name: '外观', exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    expect(await page.getByRole('dialog').count()).toBe(0);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name: '模型连接', exact: true }).click();
    await page.getByRole('button', { name: '编辑源 A', exact: true }).click();
    await page.getByRole('button', { name: '删除来源', exact: true }).click();
    expect(await page.getByText('删除“源 A”及其保存的密钥？此操作不可撤销。').count()).toBe(1);
    await page.getByRole('button', { name: '确认删除来源' }).click();
    await page.getByText('来源已删除。其他来源不受影响。').waitFor();
    expect(await page.locator('.provider-source-card').count()).toBe(1);
    expect(await page.locator('.provider-source-card').first().innerText()).toContain('源 B');
  } finally { await browser.close(); }
}, 30000);
