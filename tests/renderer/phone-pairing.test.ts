import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

// Mounts the real component (real CSS, real qrcode data URLs) against a fake
// `window.forgeLan` bridge, so the panel's state machine is exercised rather
// than a markup snapshot.
const executablePath = process.env.FORGE_BROWSER_EXECUTABLE;

const contextPlugin = (workspace: string, withPicker: boolean) => ({
  name: "pairing-test-context",
  setup(api: import("esbuild").PluginBuild) {
    api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
      loader: "tsx",
      resolveDir: resolve("."),
      contents: `
        import {createContext,useContext} from 'react';
        const C=createContext(null); export const useWorkbench=()=>useContext(C);
        export function TestProvider({children}){
          return <C.Provider value={{
            state:{activeSnapshot:{workspace:'${workspace}'},sessions:[],settings:null,isSettingsOpen:true},
            chooseWorkspace:async()=>{ ${
              withPicker
                ? "window.picked=(window.picked||0)+1;return '/srv/picked';"
                : "return null;"
            } },
          }}>{children}</C.Provider>;
        }`,
    }));
  },
});

async function bundlePanel(outfile: string, body: string, workspace: string, withPicker: boolean) {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: body },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile,
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [contextPlugin(workspace, withPicker)],
  });
  return {
    js: bundle.outputFiles!.find((file) => file.path.endsWith(outfile))!.text,
    css: bundle.outputFiles!.find((file) => file.path.endsWith(".css"))!.text,
  };
}

it("pairs over LAN explicitly, shows the QR url, and never replays failed actions", async () => {
  const { js, css } = await bundlePanel(
    "phone-pairing.js",
    `
      import {createRoot} from 'react-dom/client';
      import {PhonePairing} from './src/renderer/components/workbench/PhonePairing';
      import {TestProvider} from './src/renderer/state/workbench-context';
      import './src/renderer/styles/global.css';
      const calls=[];
      let state={url:null,addresses:['192.168.1.24','10.0.0.7']};
      window.failNext=false;
      window.lanCalls=calls;
      window.forgeLan={
        canControl:true,
        status:async()=>{calls.push({action:'status'});return {...state};},
        start:async(input)=>{calls.push({action:'start',...input});
          if(window.failNext){window.failNext=false;throw new Error('端口已被占用。');}
          state={url:'http://192.168.1.24:41234/',addresses:state.addresses};
          return {...state};},
        stop:async()=>{calls.push({action:'stop'});state={url:null,addresses:state.addresses};return {...state};},
      };
      createRoot(document.getElementById('root')).render(<TestProvider><PhonePairing/></TestProvider>);
    `,
    "/srv/forge-demo",
    true,
  );
  expect(css).toContain(".phone-pairing");

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.getByRole("button", { name: "开始公开" }).waitFor();

    const calls = () =>
      page.evaluate(() => Reflect.get(window, "lanCalls") as { action: string }[]);
    // Only a read happened on mount: nothing listens before the explicit click.
    expect(await calls()).toEqual([{ action: "status" }]);
    expect(await page.getByLabel("LAN 地址").inputValue()).toBe("192.168.1.24");
    expect(await page.getByLabel("端口").inputValue()).toBe("41234");
    expect(await page.getByLabel("服务器工作区").inputValue()).toBe("/srv/forge-demo");
    await page.getByLabel("LAN 地址").selectOption("10.0.0.7");
    expect(await page.locator(".phone-pairing-qr").count()).toBe(0);

    // A failed publish reports once, keeps the form, and is not retried.
    await page.evaluate(() => { Reflect.set(window, "failNext", true); });
    await page.getByRole("button", { name: "开始公开" }).click();
    await page.getByRole("alert").filter({ hasText: "端口已被占用。" }).waitFor();
    expect((await calls()).filter((call) => call.action === "start")).toHaveLength(1);
    expect(await page.getByLabel("服务器工作区").inputValue()).toBe("/srv/forge-demo");

    // The workspace picker is the only path that replaces the session workspace.
    await page.getByRole("button", { name: "选择工作区…" }).click();
    expect(await page.evaluate(() => Reflect.get(window, "picked"))).toBe(1);
    expect(await page.getByLabel("服务器工作区").inputValue()).toBe("/srv/picked");

    await page.getByRole("button", { name: "开始公开" }).click();
    await page.getByRole("button", { name: "停止公开" }).waitFor();
    expect((await calls()).at(-1)).toEqual({
      action: "start",
      host: "10.0.0.7",
      port: 41234,
      workspace: "/srv/picked",
    });

    // The QR payload is the plain HTTP url — no token, no query, no credentials.
    const img = page.locator("img.phone-pairing-qr");
    await img.waitFor();
    expect(await img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(await img.getAttribute("alt")).toContain("http://192.168.1.24:41234/");
    expect(await page.getByLabel("配对地址").inputValue()).toBe("http://192.168.1.24:41234/");
    for (const note of [
      "二维码是普通 HTTP 地址，不含密钥或随机令牌，只用于按地址配对。",
      "配对只校验地址，不做身份鉴权：同一局域网内知道该地址的人都可能连接。",
      "手机连接的是同一核心与同一份任务列表；关闭桌面应用会终止正在运行的任务。",
      "停止公开只会断开远程连接，不会取消已经在运行的任务。",
    ]) expect(await page.getByText(note).count()).toBe(1);

    await page.getByRole("button", { name: "停止公开" }).click();
    await page.getByRole("button", { name: "开始公开" }).waitFor();
    expect((await calls()).at(-1)).toEqual({ action: "stop" });
    expect(await page.locator("img.phone-pairing-qr").count()).toBe(0);

    // Clipboard is unavailable over plain HTTP: fall back to selecting the text.
    await page.getByRole("button", { name: "开始公开" }).click();
    await page.getByRole("button", { name: "复制地址" }).waitFor();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });
    await page.getByRole("button", { name: "复制地址" }).click();
    await page.getByText("当前环境无法直接写入剪贴板，已选中地址，请手动复制。").waitFor();
    expect(
      await page.getByLabel("配对地址").evaluate((el) => {
        const field = el as HTMLInputElement;
        return field.selectionStart === 0 && field.selectionEnd === field.value.length;
      }),
    ).toBe(true);

    // Narrow viewport must not overflow the settings surface.
    for (const width of [1180, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.locator(".phone-pairing").evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);

it("shows a read-only web pairing address without any start or stop control", async () => {
  const { js, css } = await bundlePanel(
    "phone-pairing-web.js",
    `
      import {createRoot} from 'react-dom/client';
      import {PhonePairing} from './src/renderer/components/workbench/PhonePairing';
      import {TestProvider} from './src/renderer/state/workbench-context';
      import './src/renderer/styles/global.css';
      const calls=[];
      window.lanCalls=calls;
      window.forgeLan={
        canControl:false,
        status:async()=>{calls.push({action:'status'});return {url:'http://192.168.1.24:41234/',addresses:[]};},
        start:async()=>{calls.push({action:'start'});throw new Error('read-only');},
        stop:async()=>{calls.push({action:'stop'});throw new Error('read-only');},
      };
      createRoot(document.getElementById('root')).render(<TestProvider><PhonePairing/></TestProvider>);
    `,
    "/srv/web",
    false,
  );

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.locator("img.phone-pairing-qr").waitFor();
    expect(await page.getByRole("button", { name: "开始公开" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "停止公开" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "选择工作区…" }).count()).toBe(0);
    expect(
      await page.getByText("Web 版只显示当前服务器公开的配对地址，不能在这里启动或停止服务。").count(),
    ).toBe(1);
    expect(await page.getByLabel("配对地址").inputValue()).toBe("http://192.168.1.24:41234/");
    await page.getByRole("button", { name: "刷新状态" }).click();
    expect(
      await page.evaluate(() => (Reflect.get(window, "lanCalls") as { action: string }[]).map((call) => call.action)),
    ).toEqual(["status", "status"]);
  } finally {
    await browser.close();
  }
}, 60000);
