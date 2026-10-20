import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

/**
 * The model picker used to keep `model` and `providerSourceId` in two separate
 * maps, so a model chosen under source B could be submitted while source A was
 * still active. The composer now stores the pair together; this covers the
 * visible pairing and the value actually submitted.
 */
it("keeps a picked model paired with the source it came from", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import {createRoot} from 'react-dom/client';
        import {Composer} from './src/renderer/components/workbench/Composer';
        import {WorkbenchProvider} from './src/renderer/state/workbench-context';
        import {defaultPublicSettings} from './src/shared/schemas';
        window.starts=[]; window.refreshes=[]; window.creates=[];
        window.forge={listModels:async(id,refresh)=>{if(refresh)window.refreshes.push(id);return [id+'/one',id+'/two'];},listSessions:async()=>[],
          getSettings:async()=>({...defaultPublicSettings,isConfigured:true,baseUrl:'https://a.test/v1',model:'a/one',activeSourceId:'a',
            providerSources:[{id:'a',label:'Source A',baseUrl:'https://a.test/v1',model:'a/one',revision:1,hasApiKey:false},
                             {id:'b',label:'Source B',baseUrl:'https://b.test/v1',model:'b/one',revision:1,hasApiKey:false}],
            routeGroups:[{id:'r1',label:'Route One',strategy:'order',members:[{sourceId:'a',model:'a/one',credentialId:'default',enabled:true}]}]}),
          createSession:async input=>{window.creates.push(input);return {id:'11111111-1111-4111-8111-111111111111',workspace:'/tmp',title:'t',model:input.model??'a/one',
            providerSourceId:input.providerSourceId,status:'idle',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',
            messages:[],events:[],changes:[],version:1};},
          startRun:async input=>{window.starts.push(input);
            return {runId:'22222222-2222-4222-8222-222222222222',sessionId:input.sessionId};},
          onEvent:()=>()=>{},chooseWorkspace:async()=>'/tmp'};
        function Harness(){return <div className="wb-app" style={{paddingTop:'200px'}}><Composer isNew /></div>;}
        createRoot(document.getElementById('root')).render(<WorkbenchProvider><Harness/></WorkbenchProvider>);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "composer-source-model.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
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
        body: '<html><body><div id="root"></div></body></html>',
      }),
    );
    await page.goto("https://forge.test/");
    await page.addStyleTag({
      content:
        bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ??
        "",
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith(".js"))!
        .text,
    });
    const input = page.locator("textarea.composer-textarea");
    await input.waitFor();

    // Opens on the active source's own default model.
    const summary = page.locator(".composer-model-summary");
    await expect.poll(() => summary.innerText()).toContain("one");

    // Route groups are an explicit choice in the picker and are distinguished
    // from a source/model pair in the summary.
    await summary.click();
    const routeGroup = page.getByRole("group", { name: "路由组" });
    const routeOne = routeGroup.getByRole("button", { name: /Route One/ });
    await routeOne.click();
    await expect
      .poll(() => summary.getAttribute("title"))
      .toContain("Route One");
    await expect.poll(() => summary.getAttribute("title")).toContain("路由组");
    await expect.poll(() => summary.innerText()).toContain("路由组");

    // Picking a normal model clears the explicit route again.
    await summary.click();
    expect(await page.locator(".model-catalog").count()).toBe(0);
    const currentModel = page.getByRole("button", { name: /^选择模型：/ });
    expect(await currentModel.textContent()).toContain("Route One");
    await currentModel.click();
    await page
      .getByRole("button", { name: "刷新模型目录", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "refreshes")))
      .toEqual(["a", "b"]);
    expect(await page.getByLabel("搜索模型或输入精确 ID").count()).toBe(0);
    expect(
      await page.locator(".composer-model-panel").textContent(),
    ).not.toMatch(/默认|default/);
    const sourceA = page.getByRole("group", { name: "Source A", exact: true });
    await sourceA.getByRole("button", { name: /a\/two/ }).click();
    await expect.poll(() => summary.getAttribute("title")).toContain("a/two");
    await expect
      .poll(() => summary.getAttribute("title"))
      .toContain("Source A");
    await expect
      .poll(() => summary.getAttribute("title"))
      .not.toContain("路由组");

    // Picking a model under Source B moves the source with it.
    if ((await page.locator(".composer-model-panel").count()) === 0)
      await summary.click();
    await currentModel.click();
    const sourceB = page.getByRole("group", { name: "Source B", exact: true });
    await sourceB.getByRole("button", { name: /b\/two/ }).click();
    await expect.poll(() => summary.getAttribute("title")).toContain("b/two");
    await expect
      .poll(() => summary.getAttribute("title"))
      .toContain("Source B");
    expect(await page.locator(".model-catalog").count()).toBe(0);
    expect(await currentModel.textContent()).toContain("Source B");
    expect(
      await currentModel.evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await currentModel.click();
    await expect
      .poll(() => sourceB.getByRole("button", { pressed: true }).count())
      .toBe(1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // The explicit route is submitted as a routeGroupId, without a model or
    // source pair, and the same value reaches both create and start requests.
    await summary.click();
    await routeGroup.getByRole("button", { name: /Route One/ }).click();
    await expect
      .poll(() => summary.getAttribute("title"))
      .toContain("Route One");
    await input.fill("hello");
    await input.press("Enter");
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "starts")))
      .toMatchObject([{ routeGroupId: "r1" }]);
    const starts = await page.evaluate(() => Reflect.get(window, "starts"));
    expect(starts[0].model).toBeUndefined();
    expect(starts[0].providerSourceId).toBeUndefined();
    const creates = await page.evaluate(() => Reflect.get(window, "creates"));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ workspace: "/tmp", routeGroupId: "r1" });
    expect(creates[0].model).toBeUndefined();
    expect(creates[0].providerSourceId).toBeUndefined();
  } finally {
    await browser.close();
  }
}, 20000);
