import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("imports sources, manages routes and credentials, logs in and reads quota", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import {createRoot} from 'react-dom/client';
        import {ProviderSources} from './src/renderer/components/workbench/ProviderSources';
        import {providerPresets} from './src/provider/presets';
        import {ProviderAttemptNote} from './src/renderer/components/workbench/ModelAccessPanels';
        import {TestProvider} from './src/renderer/state/workbench-context';
        import './src/renderer/styles/global.css';
        import './src/renderer/components/workbench/model-access.css';
        import './src/renderer/components/workbench/provider-sources.css';
        window.access=[]; window.sources=[]; window.routes=[]; window.external=[];
        window.loginReady=false; window.loginCompleted=false;
        window.forge={
          modelAccess: async input => {
            window.access.push(input);
            if(input.type==='catalog')
              return {type:'catalog',sourceId:input.sourceId,models:[
                {id:'a/one',displayName:'One',contextWindowTokens:128000,maxOutputTokens:8192,tools:false,vision:undefined,reasoningEfforts:['low','high'],pricing:{input:1,output:2,currency:'USD',source:'catalog',updatedAt:'2026-01-01'},provenance:{tools:'catalog',contextWindowTokens:'catalog'}},
                {id:'a/two',contextWindowTokens:null}
              ]};
            if(input.type==='presets') return {type:'presets',presets:providerPresets};
            if(input.type==='import-preview')
              return {type:'import-preview',previewId:'preview-1',warnings:['导入源 B 已存在'],sources:[
                {id:'import-a',label:'导入源 A',baseUrl:'https://import-a.test/v1',model:'m-a',credentialCount:1,warnings:[]},
                {id:'import-b',label:'导入源 B',baseUrl:'https://import-b.test/v1',model:'m-b',credentialCount:1,warnings:['已存在']}
              ]};
            if(input.type==='import-apply') return {type:'import-apply',applied:input.sourceIds};
            if(input.type==='login-start')
              return {type:'login-start',login:{loginId:'login-1',platform:input.platform,mode:'device',status:'waiting',expiresAt:Date.now()+300000,verificationUrl:'https://login.test/device',userCode:'ABCD-EFGH'}};
            if(input.type==='login-poll'){
              if(!window.loginReady)
                return {type:'login-poll',login:{loginId:'login-1',platform:'copilot',mode:'device',status:'waiting',expiresAt:Date.now()+300000,verificationUrl:'https://login.test/device',userCode:'ABCD-EFGH'}};
              window.loginCompleted=true;
              return {type:'login-poll',login:{loginId:'login-1',platform:'copilot',mode:'device',status:'done',expiresAt:Date.now()+300000,credentialId:'codex-2',account:{platform:'copilot',user:'copilot-user',plan:'pro'}}};
            }
            if(input.type==='login-cancel')
              return {type:'login-cancel',login:{loginId:'login-1',platform:'copilot',mode:'device',status:'canceled',expiresAt:Date.now()}};
            if(input.type==='quota')
              return {type:'quota',quota:{platform:'codex',plan:'plus',updatedAt:1,windows:[
                {id:'week',name:'每周',remaining:10,limit:20,used:10,usedPercent:50,resetAt:null,unlimited:false}
              ]}};
            throw new Error('unexpected access '+input.type);
          },
          openExternal: async url => { window.external.push(url); }
        };
        createRoot(document.getElementById('root')).render(<TestProvider><ProviderSources onBusy={()=>{}}/>
          <ProviderAttemptNote sessionId="s-attempt" events={[
            {type:'provider_attempt',timestamp:'2026-01-01T00:00:00.000Z',sessionId:'s-attempt',selection:{sourceId:'a',model:'a/one',apiMode:'chat-completions',groupId:'r1',attempt:1,reason:'selected',outcome:'succeeded',timestamp:'2026-01-01T00:00:00.000Z',credentialId:'codex-1'}}
          ]} routeGroupId="r1" routeGroupLabel="路由 A"/>
          <ProviderAttemptNote sessionId="s-none" events={[]} routeGroupId="r1" routeGroupLabel="路由 A"/>
        </TestProvider>);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "model-access.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "source-host",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            loader: "tsx",
            resolveDir: resolve("."),
            contents: `
              import {createContext,useContext,useState} from 'react';
              import {defaultPublicSettings} from './src/shared/schemas';
              const C=createContext(null);export const useWorkbench=()=>useContext(C);
              export function TestProvider({children}){
                const [settings,setSettings]=useState({...defaultPublicSettings,isConfigured:true,baseUrl:'https://a.test/v1',model:'a/one',activeSourceId:'a',
                  providerSources:[{id:'a',label:'源 A',baseUrl:'https://a.test/v1',model:'a/one',apiMode:'chat-completions',revision:1,hasApiKey:true,
                    credentials:[
                      {id:'default',label:'默认',enabled:true,type:'api-key',status:'ready'},
                      {id:'codex-1',label:'Codex 账号',enabled:true,type:'account',status:'ready',platform:'codex'}
                    ],
                    modelSelection:{mode:'selected',models:['a/one']},preset:'openai'}],
                  routeGroups:[{id:'r1',label:'路由 A',strategy:'order',sticky:false,members:[{sourceId:'a',model:'a/one',credentialId:'default',enabled:true}]}]});
                const loadSettings=async()=>{
                  if(window.loginCompleted){
                    const source=settings.providerSources.find(s=>s.id==='a');
                    if(source&&!source.credentials.some(c=>c.id==='codex-2')){
                      const next={...settings,providerSources:settings.providerSources.map(s=>s.id==='a'?{...s,credentials:[...s.credentials,{id:'codex-2',label:'Codex 新账号',enabled:true,type:'account',status:'ready',platform:'copilot'}]}:s)};
                      setSettings(next);
                      return next;
                    }
                  }
                  return settings;
                };
                const updateSettings=async input=>{
                  if(input.route){
                    window.routes.push(input.route);
                    const op=input.route;
                    const groups=settings.routeGroups??[];
                    if(op.type==='remove')
                      return set({...settings,routeGroups:groups.filter(g=>g.id!==op.id)});
                    return set({...settings,routeGroups:[...groups.filter(g=>g.id!==op.group.id),op.group]});
                  }
                  if(input.source){
                    window.sources.push(input.source);
                    const op=input.source;
                    if(op.type==='remove')
                      return set({...settings,providerSources:settings.providerSources.filter(s=>s.id!==op.id)});
                    const prior=settings.providerSources.find(s=>s.id===op.source.id);
                    const saved={...op.source,revision:(prior?.revision??0)+1,
                      hasApiKey:op.source.credentials?.some(c=>c.type==='api-key')??!!prior?.hasApiKey,
                      credentials:(op.credentials??[]).map(c=>({...c,status:'ready'}))};
                    return set({...settings,providerSources:[...settings.providerSources.filter(s=>s.id!==saved.id),saved]});
                  }
                  return {ok:false,error:'unexpected settings patch'};
                };
                const set=next=>{setSettings(next);return {ok:true,settings:next};};
                return <C.Provider value={{state:{settings,isSettingsOpen:true,sessions:[]},updateSettings,loadSettings,openSettings:()=>{}}}>{children}</C.Provider>;
              }
            `,
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(5000);
    await page.route("https://forge.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      }),
    );
    await page.goto("https://forge.test/");
    await page.addStyleTag({
      content:
        bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ??
        "",
    });
    await page.addScriptTag({
      content:
        bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text ??
        "",
    });

    await expect
      .poll(() => page.locator(".provider-source-card").count())
      .toBe(1);
    await expect
      .poll(() => page.locator(".model-access-route-card").count())
      .toBe(1);
    const card = page.locator(".model-access-route-card");
    await expect.poll(() => card.innerText()).toContain("源 A / a/one / 默认");

    // The attempt note distinguishes the chosen route from the actual request,
    // and renders nothing when no provider attempt has been observed.
    await expect
      .poll(() => page.locator(".composer-provider-attempt").count())
      .toBe(1);
    const attempt = page.locator(".composer-provider-attempt");
    await expect.poll(() => attempt.innerText()).toContain("选择 路由 A");
    await expect
      .poll(() => attempt.innerText())
      .toContain("实际 a/a/one · codex-1 · 成功");

    // URL/JSON import previews into selectable sources with operation warnings.
    await page.locator("details.model-access-import > summary").click();
    await page.locator("#model-access-import-text").fill('{"sources":[]}');
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect
      .poll(() => page.locator(".model-access-preview-row").count())
      .toBe(2);
    await expect
      .poll(() => page.locator(".model-access-preview-row").first().innerText())
      .toContain("导入源 A");
    await page
      .locator(".model-access-preview-row")
      .filter({ hasText: "导入源 B" })
      .getByRole("checkbox")
      .uncheck();
    await expect
      .poll(() => page.locator(".model-access-warnings").innerText())
      .toContain("导入源 B 已存在");
    await page.getByRole("button", { name: "应用导入" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          Reflect.get(window, "access")
            .filter((call: { type: string }) => call.type === "import-apply")
            .at(-1),
        ),
      )
      .toMatchObject({ previewId: "preview-1", sourceIds: ["import-a"] });

    // Route members keep the exact source/model/credential triple.
    await page.getByRole("button", { name: "编辑路由组" }).click();
    await page.getByRole("dialog", { name: "编辑路由组" }).waitFor();
    expect(await page.locator("#route-source-0").inputValue()).toBe("a");
    expect(await page.locator("#route-model-0").inputValue()).toBe("a/one");
    expect(await page.locator("#route-credential-0").inputValue()).toBe(
      "default",
    );
    await page.locator("#route-model-0").fill("a/two");
    await page.getByRole("button", { name: "保存路由组" }).click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "routes").at(-1)))
      .toMatchObject({
        type: "save",
        group: {
          id: "r1",
          label: "路由 A",
          members: [{ sourceId: "a", model: "a/two", credentialId: "default" }],
        },
      });
    await expect.poll(() => card.innerText()).toContain("a/two");

    await page.getByRole("button", { name: "添加路由组" }).click();
    await page.getByRole("dialog", { name: "添加路由组" }).waitFor();
    await page.getByLabel("名称", { exact: true }).fill("路由 B");
    await page.locator("#route-source-0").selectOption("a");
    await page.locator("#route-model-0").fill("a/one");
    await page.locator("#route-credential-0").selectOption("codex-1");
    await page.getByRole("button", { name: "保存路由组" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          Reflect.get(window, "routes")
            .filter((op: { type: string }) => op.type === "save")
            .at(-1),
        ),
      )
      .toMatchObject({
        group: {
          label: "路由 B",
          members: [{ sourceId: "a", model: "a/one", credentialId: "codex-1" }],
        },
      });
    const routeB = page
      .locator(".model-access-route-card")
      .filter({ hasText: "路由 B" });
    await routeB.getByRole("button", { name: "删除路由组" }).click();
    await routeB.getByRole("button", { name: "确认删除路由组" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() => Reflect.get(window, "routes").at(-1)),
      )
      .toMatchObject({ type: "remove", id: expect.any(String) });

    // Account login uses explicit start/open/poll, then reloads public settings.
    await page.getByRole("button", { name: "编辑源 A" }).click();
    await page.getByRole("dialog", { name: "编辑来源 · 源 A" }).waitFor();
    // Catalog metadata keeps unknown capabilities as unknown instead of false,
    // and saved API keys are never echoed into the form.
    await expect
      .poll(() => page.locator(".model-access-catalog").innerText())
      .toContain("上下文 128K");
    await expect
      .poll(() => page.locator(".model-access-catalog").innerText())
      .toContain("输出 8.2K");
    await expect
      .poll(() => page.locator(".model-access-catalog").innerText())
      .toContain("工具 否");
    await expect
      .poll(() => page.locator(".model-access-catalog").innerText())
      .toContain("视觉 ?");
    await expect
      .poll(() => page.locator(".model-access-catalog").innerText())
      .toContain("推理 low/high");
    await expect
      .poll(() => page.locator(".model-access-catalog").innerText())
      .toContain("价格 1 USD / 2 USD · catalog");
    expect(
      await page
        .getByRole("textbox", { name: "凭据密钥 默认", exact: true })
        .inputValue(),
    ).toBe("");
    await page
      .getByRole("combobox", { name: "账号平台" })
      .selectOption("copilot");
    await page.getByRole("button", { name: "开始登录" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          Reflect.get(window, "access")
            .filter((call: { type: string }) => call.type === "login-start")
            .at(-1),
        ),
      )
      .toMatchObject({ sourceId: "a", platform: "copilot" });
    await expect
      .poll(() => page.locator(".model-access-login").innerText())
      .toContain("ABCD-EFGH");
    await page.getByRole("button", { name: "打开登录页面" }).click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "external")))
      .toEqual(["https://login.test/device"]);
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.evaluate(() => {
      Reflect.set(window, "loginReady", true);
    });
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect
      .poll(() => page.locator(".model-access-login").innerText())
      .toContain("登录完成");
    await expect
      .poll(() => page.getByLabel("凭据标签").last().inputValue())
      .toBe("Codex 新账号");
    await expect
      .poll(() => page.locator(".provider-feedback").innerText())
      .toContain("登录完成。");

    await page.getByRole("button", { name: "查询额度 Codex 账号" }).click();
    await expect
      .poll(() => page.locator(".model-access-quota").innerText())
      .toContain("codex · plus");
    await expect
      .poll(() => page.locator(".model-access-quota").innerText())
      .toContain("10 / 20");

    // API key credentials: secret only in the save payload, selection is explicit.
    await page.getByRole("button", { name: "添加凭据" }).click();
    const newLabel = page.getByLabel("凭据标签").last();
    await newLabel.fill("备用密钥");
    await page
      .getByRole("textbox", { name: "凭据密钥 备用密钥", exact: true })
      .fill("sk-fixture-2");
    await page.getByRole("radio", { name: "选择凭据 备用密钥" }).check();
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const keySave = await page.evaluate(() =>
      Reflect.get(window, "sources").at(-1),
    );
    const backup = keySave.credentials.find(
      (item: { label: string }) => item.label === "备用密钥",
    );
    expect(backup).toMatchObject({
      enabled: true,
      type: "api-key",
      apiKey: "sk-fixture-2",
    });
    expect(keySave.source.activeCredentialId).toBe(backup.id);
    const untouchedDefault = keySave.credentials.find(
      (item: { id: string }) => item.id === "default",
    );
    expect(untouchedDefault.apiKey).toBeUndefined();
    expect(
      keySave.credentials.filter(
        (item: { type: string }) => item.type === "account",
      ),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ apiKey: expect.anything() }),
      ]),
    );

    await page.getByRole("button", { name: "编辑源 A" }).click();
    await page.getByRole("dialog", { name: "编辑来源 · 源 A" }).waitFor();
    await page.getByRole("button", { name: "删除凭据 备用密钥" }).click();
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const deletedKey = await page.evaluate(() =>
      Reflect.get(window, "sources").at(-1),
    );
    expect(
      deletedKey.credentials.map((item: { label: string }) => item.label),
    ).not.toContain("备用密钥");

    // Deleting an account removes the credential entry without reading its token.
    await page.getByRole("button", { name: "编辑源 A" }).click();
    await page.getByRole("dialog", { name: "编辑来源 · 源 A" }).waitFor();
    await page.getByRole("button", { name: "删除账号 Codex 账号" }).click();
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const deletedAccount = await page.evaluate(() =>
      Reflect.get(window, "sources").at(-1),
    );
    expect(
      deletedAccount.credentials.map((item: { id: string }) => item.id),
    ).not.toContain("codex-1");
    expect(
      deletedAccount.credentials.map((item: { id: string }) => item.id),
    ).toContain("codex-2");

    await page.getByRole("button", { name: "添加来源" }).click();
    await page.getByLabel("预设", { exact: true }).selectOption("google");
    expect(await page.getByLabel("协议", { exact: true }).inputValue()).toBe("gemini");
    expect(await page.getByLabel("API 地址", { exact: true }).inputValue()).toBe("https://generativelanguage.googleapis.com/v1beta");
    await page.getByLabel("预设", { exact: true }).selectOption("azure");
    expect(await page.getByLabel("API 地址", { exact: true }).inputValue()).toBe("");
    await page.getByLabel("预设", { exact: true }).selectOption("bedrock");
    await page.getByLabel("Region", { exact: true }).selectOption("eu-central-1");
    expect(await page.getByLabel("API 地址", { exact: true }).inputValue()).toBe("https://bedrock-runtime.eu-central-1.amazonaws.com/openai/v1");
    const captureDir = process.env.FORGE_MODEL_ACCESS_CAPTURE_DIR;
    if (captureDir) {
      await mkdir(captureDir, { recursive: true });
      for (const theme of ["light", "dark"]) for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        await page.screenshot({ path: resolve(captureDir, `providers-${theme}-${width}.png`), fullPage: true });
        expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
  } finally {
    await browser.close();
  }
});

it("shows actual route, source and credential usage in the stats panel", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import {createRoot} from 'react-dom/client';
        import {UsageDashboard} from './src/renderer/components/workbench/UsageDashboard';
        import {TestProvider} from './src/renderer/state/workbench-context';
        import './src/renderer/styles/global.css';
        import './src/renderer/components/workbench/usage-dashboard.css';
        window.filters=[];
        window.forge={ getUsageStats: async filter => {
          window.filters.push(filter);
          return {
            totalPromptTokens:130,totalCompletionTokens:85,totalCachedTokens:0,totalTokens:215,
            totalSessions:1,totalRuns:2,averageCacheRate:0,
            models:[{model:'a/one',promptTokens:120,completionTokens:80,cachedTokens:0,totalTokens:200,runCount:1}],
            daily:[],topSessions:[],
            routes:[
              {groupId:'r1',sourceId:'a',credentialId:'codex-1',model:'a/one',apiMode:'chat-completions',attempts:3,succeeded:2,failed:1,unknownUsage:1,promptTokens:120,completionTokens:80,cachedTokens:0,totalTokens:200},
              {sourceId:'b',model:'b/one',apiMode:'responses',attempts:1,succeeded:1,failed:0,unknownUsage:0,promptTokens:10,completionTokens:5,cachedTokens:0,totalTokens:15}
            ]
          };
        }};
        createRoot(document.getElementById('root')).render(<TestProvider><UsageDashboard/></TestProvider>);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "usage-routes.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "source-host",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            loader: "tsx",
            resolveDir: resolve("."),
            contents: `
              import {createContext,useContext} from 'react';
              const C=createContext(null);export const useWorkbench=()=>useContext(C);
              export function TestProvider({children}){
                const state={isUsageDashboardOpen:true,sessions:[],
                  settings:{routeGroups:[{id:'r1',label:'路由 A',strategy:'order',sticky:false,members:[]}]}};
                return <C.Provider value={{state,openUsageDashboard:()=>{},selectSession:async()=>{}}}>{children}</C.Provider>;
              }
            `,
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(5000);
    await page.route("https://forge.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      }),
    );
    await page.goto("https://forge.test/");
    await page.addStyleTag({
      content:
        bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ??
        "",
    });
    await page.addScriptTag({
      content:
        bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text ??
        "",
    });

    const section = page
      .locator(".usage-dashboard-section")
      .filter({ hasText: "来源调用记录" });
    await expect.poll(() => section.count()).toBe(1);
    const text = await section.innerText();
    // The route group resolves to its label; the actual source, credential,
    // protocol and outcome counts stay visible, including callers without a group.
    expect(text).toContain("2 条");
    expect(text).toContain("路由 A");
    expect(text).toContain("codex-1");
    expect(text).toContain("a/one");
    expect(text).toContain("chat-completions");
    expect(text).toContain("3 / 2 / 1 · 未计 1");
    expect(text).toContain("b/one");
    expect(text).toContain("responses");
    expect(text).toContain("1 / 1 / 0");
    expect(
      await section
        .locator("tbody tr")
        .nth(1)
        .locator("td")
        .first()
        .innerText(),
    ).toBe("—");

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await browser.close();
  }
}, 40000);
