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
        window.starts=[];
        window.forge={listModels:async id=>[id+'/one',id+'/two'],listSessions:async()=>[],
          getSettings:async()=>({...defaultPublicSettings,isConfigured:true,baseUrl:'https://a.test/v1',model:'a/one',activeSourceId:'a',
            providerSources:[{id:'a',label:'Source A',baseUrl:'https://a.test/v1',model:'a/one',revision:1,hasApiKey:false},
                             {id:'b',label:'Source B',baseUrl:'https://b.test/v1',model:'b/one',revision:1,hasApiKey:false}]}),
          createSession:async input=>({id:'11111111-1111-4111-8111-111111111111',workspace:'/tmp',title:'t',model:input.model,
            providerSourceId:input.providerSourceId,status:'idle',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',
            messages:[],events:[],changes:[],version:1}),
          startRun:async input=>{window.starts.push({model:input.model,source:input.providerSourceId});
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
    ...(process.env.FORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.route("https://forge.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }),
    );
    await page.goto("https://forge.test/");
    await page.addStyleTag({ content: bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "" });
    await page.addScriptTag({ content: bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text });
    const input = page.locator("textarea.composer-textarea");
    await input.waitFor();

    // Opens on the active source's own default model.
    await expect.poll(() => page.locator(".composer-model-summary").innerText()).toContain("one");

    // Picking a model under Source B moves the source with it: the summary now
    // reports B's model and B's group owns the selected option.
    await page.locator(".composer-model-summary").click();
    const sourceB = page.getByRole("group", { name: "Source B", exact: true });
    await sourceB.getByRole("button", { name: /b\/two/ }).click();
    await expect.poll(() => page.locator(".composer-model-summary").getAttribute("title")).toContain("b/two");
    await expect.poll(() => page.locator(".composer-model-summary").getAttribute("title")).toContain("Source B");
    await page.locator(".composer-model-summary").click();
    await expect.poll(() => sourceB.getByRole("button", { pressed: true }).count()).toBe(1);
    await page.keyboard.press("Escape");

    // The submitted pair matches what the UI displays.
    await input.fill("hello");
    await input.press("Enter");
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "starts")))
      .toEqual([{ model: "b/two", source: "b" }]);
  } finally {
    await browser.close();
  }
}, 20000);
