import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { CONNECTION_SETTINGS_PATH, connectionDisplayTarget, hasMobileUserAgentToken } from "../../src/renderer/state/mobile-connection";

it("recognizes only the mobile capability token and displays only the server origin", () => {
  expect(hasMobileUserAgentToken("Mozilla/5.0 ForgeMobile/1")).toBe(true);
  for (const ua of ["Mozilla/5.0", "ForgeMobile/11", "ForgeMobile/1x", "NotForgeMobile/1"]) {
    expect(hasMobileUserAgentToken(ua)).toBe(false);
  }
  expect(connectionDisplayTarget({ origin: "http://forge.test:5174", href: "http://forge.test:5174/?secret=hidden#private" })).toBe("http://forge.test:5174");
  expect(connectionDisplayTarget({ origin: "null", protocol: "about:", host: "" })).toBe("");
});

it("Android settings expose explicit connection editing and protect unsaved drafts; web keeps pairing", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {Settings} from './src/renderer/components/workbench/Settings';
      import {TestProvider} from './src/renderer/state/workbench-context';
      import './src/renderer/styles/global.css';
      window.forge={listMcpServers:async()=>[]};
      window.forgeLan={canControl:false,status:async()=>{window.lanReads++;return {url:null,addresses:[]}}};
      window.lanReads=0;
      window.nativeEntries=[];
      // Simulate native interception after React has had a chance to cancel navigation.
      document.addEventListener('click',event=>{
        const link=event.target.closest?.('a[href="${CONNECTION_SETTINGS_PATH}"]');
        if(link && !event.defaultPrevented){window.nativeEntries.push(link.href);event.preventDefault()}
      });
      createRoot(document.getElementById('root')).render(<TestProvider><Settings/></TestProvider>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "connection.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "connection-fixture", setup(api) {
      api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({ loader: "tsx", resolveDir: resolve("."), contents: `
        import {createContext,useContext,useState} from 'react';
        import {defaultPublicSettings} from './src/shared/schemas';
        const C=createContext(null);export const useWorkbench=()=>useContext(C);
        export function TestProvider({children}){
          const [isSettingsOpen,openSettings]=useState(true);
          return <C.Provider value={{state:{settings:defaultPublicSettings,isSettingsOpen},openSettings,updateSettings:async()=>({ok:true})}}>{children}</C.Provider>
        }
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [true, false]) {
      const context = await browser.newContext({
        userAgent: mobile ? "Mozilla/5.0 Android ForgeMobile/1" : "Mozilla/5.0 Chromium",
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(4000);
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.route("http://forge.test:5174/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
      await page.goto("http://forge.test:5174/?secret=hidden#private");
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text });
      const nav = (name: string) => page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name, exact: true });
      if (mobile) {
        expect(await nav("手机连接").count()).toBe(0);
        await nav("服务器连接").click();
        const address = page.getByRole("textbox", { name: "当前服务器地址", exact: true });
        expect(await address.inputValue()).toBe("http://forge.test:5174");
        expect(await address.getAttribute("readonly")).not.toBeNull();
        const edit = () => page.getByRole("link", { name: "编辑或更换连接", exact: true });
        expect(await edit().getAttribute("href")).toBe(CONNECTION_SETTINGS_PATH);
        expect(await page.evaluate(() => Reflect.get(window, "nativeEntries"))).toEqual([]);
        expect(await page.evaluate(() => Reflect.get(window, "lanReads"))).toBe(0);
        await edit().click();
        expect(await page.evaluate(() => Reflect.get(window, "nativeEntries"))).toEqual([`http://forge.test:5174${CONNECTION_SETTINGS_PATH}`]);
        await nav("外观").click();
        await page.getByRole("button", { name: "深色", exact: true }).click();
        await nav("服务器连接").click();
        await edit().click();
        await page.getByRole("alert").filter({ hasText: "未保存的修改" }).waitFor();
        expect(await page.evaluate(() => Reflect.get(window, "nativeEntries").length)).toBe(1);
        await page.getByRole("button", { name: "取消，留在设置页" }).click();
        expect(await edit().count()).toBe(1);
        expect(await page.getByText("有未保存的修改", { exact: true }).count()).toBe(1);
        await edit().click();
        await page.getByRole("link", { name: "继续打开连接编辑页" }).click();
        expect(await page.evaluate(() => Reflect.get(window, "nativeEntries").length)).toBe(2);
        for (const theme of ["light", "dark"]) {
          await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
          expect(await page.locator(".settings-page-scroll").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        }
      } else {
        expect(await nav("服务器连接").count()).toBe(0);
        await nav("手机连接").click();
        expect(await page.getByRole("region", { name: "手机连接配置" }).count()).toBe(1);
        expect(await page.getByRole("link", { name: "编辑或更换连接", exact: true }).count()).toBe(0);
      }
      expect(pageErrors).toEqual([]);
      await context.close();
    }
  } finally { await browser.close(); }
}, 30000);
