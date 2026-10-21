import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("adds sources from presets, keeps drafts, reports stale catalogs and cancels tests", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import {createRoot} from 'react-dom/client';
        import {Settings} from './src/renderer/components/workbench/Settings';
        import {TestProvider} from './src/renderer/state/workbench-context';
        import './src/renderer/styles/global.css';
        import './src/renderer/components/workbench/app.css';
        window.calls=[]; window.cancels=[]; window.failSave=false; window.conflict=false;
        window.stale=false; window.holdTests=false; window.pendingTest=null;
        window.forge={
          modelAccess: async input => {
            window.calls.push(input);
            if(input.type==='presets') return {type:'presets',presets:[
              {id:'openai',name:'OpenAI',kind:'vendor',endpoints:{'chat-completions':'https://api.openai.com/v1',responses:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com'},regionLabel:'区域',regions:[{id:'cn',name:'中国',endpoints:{'chat-completions':'https://cn.openai.test/v1'}}]},
              {id:'local',name:'本地',kind:'local',endpoints:{'chat-completions':'http://127.0.0.1:11434/v1'},noKey:true}
            ]};
            if(input.type==='catalog'){
              const models = input.sourceId==='a'
                ? [{id:'a/one',contextWindowTokens:128000,tools:true,vision:undefined},{id:'a/two',contextWindowTokens:null}]
                : [{id:input.sourceId+'/one',contextWindowTokens:null}];
              if(input.refresh && window.stale)
                return {type:'catalog',sourceId:input.sourceId,models,stale:true,fetchedAt:'2026-01-01T00:00:00.000Z',error:'目录请求失败'};
              return {type:'catalog',sourceId:input.sourceId,models};
            }
            if(input.type==='test'){
              if(window.holdTests)
                return new Promise(resolve => { window.pendingTest=resolve; });
              return {type:'test',sourceId:input.sourceId,kind:input.kind,ok:true,latencyMs:input.kind==='catalog'?12:34,...(input.model?{model:input.model}:{})};
            }
            if(input.type==='cancel'){ window.cancels.push(input.requestId); return {type:'cancel',cancelled:true}; }
            if(input.type==='quota') return {type:'quota',quota:{platform:'codex',updatedAt:1,windows:[]}};
            throw new Error('unexpected access '+input.type);
          },
          openExternal: async () => undefined
        };
        window.root=createRoot(document.getElementById('root'));window.root.render(<TestProvider><Settings/></TestProvider>);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "sources.js",
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
                  providerSources:[{id:'a',label:'源 A',baseUrl:'https://a.test/v1',model:'a/one',revision:1,hasApiKey:true,
                    credentials:[{id:'default',label:'默认',enabled:true,type:'api-key',status:'ready'}],
                    modelSelection:{mode:'all'},preset:'openai'}],
                  routeGroups:[]});
                const [isSettingsOpen]=useState(true);
                const loadSettings=async()=>settings;
                const updateSettings=async input=>{
                  window.calls.push(input);
                  if(window.failSave) return {ok:false,error:'来源保存失败。'};
                  if(window.conflict) return {ok:false,error:'该来源已被其他窗口或 CLI 修改。'};
                  const sources=settings.providerSources;
                  if(input.route){
                    const op=input.route;
                    if(op.type==='remove')
                      return set({...settings,routeGroups:(settings.routeGroups??[]).filter(g=>g.id!==op.id)});
                    const groups=settings.routeGroups??[];
                    return set({...settings,routeGroups:[...groups.filter(g=>g.id!==op.group.id),op.group]});
                  }
                  if(input.source){
                    const op=input.source;
                    if(op.type==='activate'){
                      const selected=sources.find(s=>s.id===op.id);
                      return set({...settings,activeSourceId:op.id,baseUrl:selected.baseUrl,model:selected.model});
                    }
                    if(op.type==='remove')
                      return set({...settings,providerSources:sources.filter(s=>s.id!==op.id)});
                    const prior=sources.find(s=>s.id===op.source.id);
                    if(op.expectedRevision!==undefined&&prior&&prior.revision!==op.expectedRevision)
                      return {ok:false,error:'该来源已被其他窗口或 CLI 修改。'};
                    const saved={...op.source,revision:(prior?.revision??0)+1,
                      hasApiKey:op.apiKey===undefined?!!prior?.hasApiKey:!!op.apiKey,
                      connection:op.connection?{
                        headerNames:Object.keys(op.connection.headers??{}),
                        hasExtraBody:Object.keys(op.connection.extraBody??{}).length>0,
                        hasProxy:!!op.connection.proxyUrl,
                        ...(op.connection.vertex?{hasVertex:true}:{})
                      }:prior?.connection,
                      credentials:(op.credentials??[]).map(c=>({...c,status:c.type==='account'?'ready':'ready'}))};
                    return set({...settings,providerSources:[...sources.filter(s=>s.id!==saved.id),saved]});
                  }
                  return {ok:false,error:'unexpected settings patch'};
                };
                const set=next=>{setSettings(next);return {ok:true,settings:next};};
                return <C.Provider value={{state:{settings,isSettingsOpen,sessions:[]},updateSettings,loadSettings,openSettings:()=>{}}}>{children}</C.Provider>;
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
      content: bundle.outputFiles.find((file) => file.path.endsWith(".css"))!
        .text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith(".js"))!
        .text,
    });

    await expect
      .poll(() => page.locator(".provider-source-card").count())
      .toBe(1);
    await expect
      .poll(() => page.locator(".provider-source-card").first().innerText())
      .toContain("目录 2");
    // Initial catalog load must not be labeled as a refresh.
    expect(
      (await page.evaluate(() => Reflect.get(window, "calls"))).filter(
        (call: { type: string }) => call.type === "catalog",
      ),
    ).toMatchObject([{ type: "catalog", sourceId: "a" }]);

    // Preset fills one endpoint per protocol; region and protocol switches keep
    // the URL in sync while custom entry remains available.
    await page.getByRole("button", { name: "添加来源" }).click();
    await page.getByRole("dialog", { name: "添加来源", exact: true }).waitFor();
    await page.getByLabel("预设", { exact: true }).selectOption("openai");
    expect(await page.getByLabel("协议", { exact: true }).inputValue()).toBe(
      "chat-completions",
    );
    expect(
      await page.getByLabel("API 地址", { exact: true }).inputValue(),
    ).toBe("https://api.openai.com/v1");
    await page.getByLabel("协议", { exact: true }).selectOption("anthropic");
    expect(
      await page.getByLabel("API 地址", { exact: true }).inputValue(),
    ).toBe("https://api.anthropic.com");
    await page.getByLabel("区域", { exact: true }).selectOption("cn");
    await page
      .getByLabel("协议", { exact: true })
      .selectOption("chat-completions");
    expect(
      await page.getByLabel("API 地址", { exact: true }).inputValue(),
    ).toBe("https://cn.openai.test/v1");
    await page
      .getByLabel("API 地址", { exact: true })
      .fill("https://custom.test/v1");
    await page.getByLabel("来源名称").fill("源 B");
    await page
      .getByLabel("凭据密钥 默认", { exact: true })
      .fill("sk-fixture-b");
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    await expect
      .poll(() => page.locator(".provider-source-card").count())
      .toBe(2);
    const saved = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(saved.source.source.preset).toBe("openai");
    expect(saved.source.source.endpoints["chat-completions"]).toBe(
      "https://custom.test/v1",
    );
    expect(saved.source.source.endpoints.anthropic).toBe(
      "https://api.anthropic.com",
    );
    expect(saved.source.source.modelSelection).toMatchObject({ mode: "all" });
    expect(saved.source.credentials).toMatchObject([
      {
        id: "default",
        label: "默认",
        enabled: true,
        type: "api-key",
        apiKey: "sk-fixture-b",
      },
    ]);

    // Vertex credentials are entered as JSON, never echoed, and can be cleared
    // explicitly with null while a blank field preserves the saved value.
    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.locator("details.model-access-connection > summary").click();
    await page.getByRole("checkbox", { name: "修改 Vertex" }).check();
    const vertex = page.locator("#model-access-vertex");
    await vertex.fill(
      '{"project":"vertex-project","location":"us-central1","credentials":{"client_email":"svc@example.test","private_key":"secret"}}',
    );
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const withVertex = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(withVertex.source.connection.vertex).toMatchObject({
      project: "vertex-project",
      location: "us-central1",
    });
    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.locator("details.model-access-connection > summary").click();
    expect(await page.locator("#model-access-vertex").count()).toBe(0);
    await expect
      .poll(async () =>
        page
          .locator(".model-access-connection-row")
          .filter({ hasText: "Vertex JSON" })
          .innerText(),
      )
      .toContain("已保存");
    await page.getByRole("button", { name: "清除 Vertex 配置" }).click();
    expect(await page.locator("#model-access-vertex").inputValue()).toBe(
      "null",
    );
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const cleared = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(cleared.source.connection.vertex).toBeNull();

    // Extra parameters: blank preserves, `{}` clears; request headers are
    // re-entered only when changed and can be cleared explicitly.
    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.locator("details.model-access-connection > summary").click();
    await page.getByRole("checkbox", { name: "修改额外参数" }).check();
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const blankExtra = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(blankExtra.source.connection).toBeUndefined();

    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.locator("details.model-access-connection > summary").click();
    await page.getByRole("checkbox", { name: "修改额外参数" }).check();
    await page.locator("#model-access-extra-body").fill('{"temperature":0.2}');
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const withExtra = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(withExtra.source.connection.extraBody).toEqual({ temperature: 0.2 });

    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.locator("details.model-access-connection > summary").click();
    await expect
      .poll(async () =>
        page
          .locator(".model-access-connection-row")
          .filter({ hasText: "额外参数" })
          .innerText(),
      )
      .toContain("已设置");
    await page.getByRole("button", { name: "清除额外参数" }).click();
    expect(await page.locator("#model-access-extra-body").inputValue()).toBe(
      "{}",
    );
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const clearedExtra = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(clearedExtra.source.connection.extraBody).toEqual({});

    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.locator("details.model-access-connection > summary").click();
    await page.getByRole("checkbox", { name: "修改请求头" }).check();
    await page.getByRole("button", { name: "添加请求头" }).click();
    await page.getByLabel("请求头名称").fill("X-Extra");
    await page.getByLabel("请求头值").fill("header-secret");
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const withHeader = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(withHeader.source.connection.headers).toEqual({
      "X-Extra": "header-secret",
    });

    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.locator("details.model-access-connection > summary").click();
    await page.getByRole("checkbox", { name: "修改请求头" }).check();
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const untouchedHeader = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(untouchedHeader.source.connection).toBeUndefined();

    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.locator("details.model-access-connection > summary").click();
    await page.getByRole("button", { name: "清除全部请求头" }).click();
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const clearedHeaders = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(clearedHeaders.source.connection.headers).toEqual({});

    // Model aliases and the proxy editor are entered explicitly and saved.
    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page
      .locator("details.model-access-fold", { hasText: "模型别名" })
      .locator("summary")
      .click();
    await page.getByRole("button", { name: "添加别名" }).click();
    await page.getByLabel("别名", { exact: true }).fill("fast");
    await page.getByLabel("别名目标模型").fill("a/one");
    await page.locator("details.model-access-connection > summary").click();
    await page.getByRole("checkbox", { name: "修改代理" }).check();
    await page.locator("#model-access-proxy").fill("http://127.0.0.1:7890");
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByText("来源已保存。").waitFor();
    const aliasProxy = await page.evaluate(() =>
      Reflect.get(window, "calls")
        .filter((call: { source?: unknown }) => call.source)
        .at(-1),
    );
    expect(aliasProxy.source.source.modelAliases).toEqual({ fast: "a/one" });
    expect(aliasProxy.source.connection).toMatchObject({
      proxyUrl: "http://127.0.0.1:7890",
    });

    // An unsaved edit survives canceling the close; a save failure keeps the draft.
    await page.getByRole("button", { name: "编辑源 B", exact: true }).click();
    await page.getByLabel("来源名称").fill("源 B 修改中");
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByText("放弃未保存的修改？").waitFor();
    await page.getByRole("button", { name: "继续编辑" }).click();
    expect(await page.getByLabel("来源名称").inputValue()).toBe("源 B 修改中");
    await page.evaluate(() => Reflect.set(window, "failSave", true));
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "来源保存失败" }).waitFor();
    expect(await page.getByLabel("来源名称").inputValue()).toBe("源 B 修改中");
    await page.evaluate(() => Reflect.set(window, "failSave", false));
    // A revision conflict is reported separately and never closes the editor.
    await page.evaluate(() => Reflect.set(window, "conflict", true));
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "其他窗口" }).waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "放弃修改并关闭" }).click();
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.evaluate(() => Reflect.set(window, "conflict", false));

    // A stale refresh keeps the previous catalog and is not reported as success.
    await page.evaluate(() => Reflect.set(window, "stale", true));
    await page.getByRole("button", { name: "刷新源 A的模型" }).click();
    await page
      .getByText("刷新失败：目录请求失败。保留 2 个缓存模型。")
      .waitFor();
    expect(
      await page.locator(".provider-source-card").first().innerText(),
    ).toContain("已过期");
    expect(
      await page.getByRole("alert").filter({ hasText: "目录请求失败" }).count(),
    ).toBeGreaterThan(0);
    await page.getByRole("button", { name: "编辑源 A", exact: true }).click();
    await page.getByText("目录已过期").waitFor();
    expect(await page.locator(".model-access-model-row").count()).toBe(2);
    // A later successful refresh clears the stale state.
    await page.evaluate(() => Reflect.set(window, "stale", false));
    await page.getByRole("button", { name: "刷新目录" }).click();
    await page.getByText("目录已刷新：2 个模型。").waitFor();
    await expect.poll(() => page.getByText("目录已过期").count()).toBe(0);
    expect(await page.locator(".model-access-model-row").count()).toBe(2);

    // Catalog and inference tests are separate and report their own outcome.
    await page.getByRole("button", { name: "测试目录" }).click();
    await page.getByText("目录测试成功 · 12 ms").waitFor();
    await page.getByRole("button", { name: "测试推理" }).click();
    await page.getByText("推理测试成功 · 34 ms · a/one").waitFor();
    // Cancel sends the request id and a late result cannot overwrite it.
    await page.evaluate(() => Reflect.set(window, "holdTests", true));
    await page.getByRole("button", { name: "测试目录" }).click();
    await page.getByRole("button", { name: "取消测试" }).click();
    await page.getByText("目录测试已取消").waitFor();
    const cancelled = await page.evaluate(() => Reflect.get(window, "cancels"));
    expect(cancelled).toHaveLength(1);
    const testCalls = await page.evaluate(() =>
      Reflect.get(window, "calls").filter(
        (call: { type: string; requestId?: string }) =>
          call.type === "test" && call.requestId,
      ),
    );
    expect(testCalls.at(-1).requestId).toBe(cancelled[0]);
    await page.evaluate(() => {
      Reflect.get(
        window,
        "pendingTest",
      )({
        type: "test",
        sourceId: "a",
        kind: "catalog",
        ok: true,
        latencyMs: 99,
      });
    });
    await page.waitForTimeout(100);
    expect(await page.getByText("目录测试已取消").count()).toBe(1);

    // Per-model parameter configuration inside the dialog and inline source card.
    await page.getByRole("button", { name: "配置模型参数 a/one" }).click();
    const dialogParamPanel = page
      .getByRole("dialog")
      .getByRole("region", { name: "模型 a/one 参数配置面板" })
      .or(
        page
          .getByRole("dialog")
          .locator('[aria-label="模型 a/one 参数配置面板"]'),
      );
    await dialogParamPanel
      .getByRole("group", { name: "模型 a/one 默认思考等级" })
      .getByRole("button", { name: "high", exact: true })
      .click();
    await dialogParamPanel.getByRole("button", { name: "深度推理" }).click();
    await dialogParamPanel.getByRole("button", { name: "256K" }).click();
    await dialogParamPanel.getByRole("button", { name: "16K" }).click();
    await expect
      .poll(() => page.locator(".model-access-catalog").innerText())
      .toContain("默认思考 high");
    await expect
      .poll(() => page.locator(".model-access-catalog").innerText())
      .toContain("上下文 256K");
    await page.getByRole("button", { name: "保存来源" }).click();
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);

    // Inline source card reflects the saved overrides and allows direct quick/detailed editing.
    const cardA = page.locator(".provider-source-card", { hasText: "源 A" });
    await expect.poll(() => cardA.innerText()).toContain("已定制 1 个模型");
    await page.getByLabel("模型 a/two 思考等级").selectOption("xhigh");
    await page.getByLabel("模型 a/two 上下文预设").selectOption("200000");
    await page.getByRole("button", { name: "保存源 A的模型配置" }).click();
    await expect.poll(() => cardA.innerText()).toContain("已定制 2 个模型");
    const lastSavedOverrides = await page.evaluate(() => {
      const calls = Reflect.get(window, "calls") as Array<{
        source?: { source?: { modelSelection?: { overrides?: unknown } } };
      }>;
      return calls
        .filter((call) => call.source?.source?.modelSelection?.overrides)
        .at(-1)?.source?.source?.modelSelection?.overrides;
    });
    expect(lastSavedOverrides).toMatchObject({
      "a/one": {
        reasoningEffort: "high",
        reasoningEfforts: ["medium", "high", "xhigh", "max"],
        contextWindowTokens: 256000,
        maxOutputTokens: 16384,
      },
      "a/two": {
        reasoningEffort: "xhigh",
        contextWindowTokens: 200000,
      },
    });

    // Reopen dialog and clear holdTests before the unmount cancel check.
    await page.evaluate(() => Reflect.set(window, "holdTests", false));
    await page.getByRole("button", { name: "编辑源 A", exact: true }).click();
    await page.getByRole("dialog").waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page
        .locator(".settings-page")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await page
        .locator(".settings-navigation")
        .evaluate((el) => el.clientWidth <= 390),
    ).toBe(true);
    expect(
      await page
        .locator(".provider-source-list")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // Unmounting the component cancels an in-flight test by requestId.
    expect(await page.getByRole("dialog").count()).toBe(1);
    await page.evaluate(() => Reflect.set(window, "holdTests", true));
    await page.getByRole("button", { name: "测试目录" }).click();
    await page.evaluate(() => Reflect.get(window, "root").unmount());
    await expect
      .poll(async () =>
        page.evaluate(() => Reflect.get(window, "cancels").length),
      )
      .toBe(2);
  } finally {
    await browser.close();
  }
}, 40000);
