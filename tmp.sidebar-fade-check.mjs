// Temporary pixel check: confirm the title's right edge really fades to the
// sidebar background instead of being cut off with a hard edge.
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { build } from "esbuild";
import { chromium } from "playwright";

function decodePng(buffer) {
  let offset = 8; // skip signature
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

const longTitle =
  "重构认证中间件并把所有遗留的会话缓存迁移到新的索引结构同时补齐回归测试与文档说明";

const bundle = await build({
  stdin: {
    resolveDir: resolve("."),
    loader: "tsx",
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import './src/renderer/components/workbench/workbench.css';
      import {Sidebar} from './src/renderer/components/workbench/Sidebar';
      const mk = (id, title) => ({version:1,id,title,
        workspace:'/home/ling/services/desktop-harness',model:'cbcn/deepseek-v4.1-flash',
        status:'completed',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-02-02T10:00:00.000Z'});
      window.testController = {
        state:{activeSessionId:'11111111-1111-4111-8111-111111111111',
          activeSnapshot:mk('11111111-1111-4111-8111-111111111111',${JSON.stringify(longTitle)}),
          sessions:[mk('11111111-1111-4111-8111-111111111111',${JSON.stringify(longTitle)}),
                    mk('22222222-2222-4222-8222-222222222222','短标题')],
          activeRuns:{},settings:{model:'x',isConfigured:true},alertError:null,
          isSessionsLoading:false,isNewSessionOpen:false,isMobileSidebarOpen:false,mobileTab:'task'},
        selectSession:()=>{},refreshActiveSession:()=>{},answerApproval:()=>{},
        openNewSession:()=>{},openSettings:()=>{},setMobileTab:()=>{},
        setMobileSidebar:()=>{},clearAlert:()=>{},loadSettings:()=>{},loadSessions:()=>{}};
      createRoot(document.getElementById('root')).render(<div className="workbench wb-app"><Sidebar/></div>);
    `,
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  outfile: "px.js",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "fonts",
      setup(api) {
        api.onResolve({ filter: /^@fontsource-variable\// }, (a) => ({
          path: a.path,
          namespace: "f",
        }));
        api.onLoad({ filter: /.*/, namespace: "f" }, () => ({
          contents: "",
          loader: "css",
        }));
      },
    },
    {
      name: "ctl",
      setup(api) {
        api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
          contents: "export function useWorkbench(){return window.testController;}",
          loader: "js",
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith("px.js")).text;
const css = bundle.outputFiles.find((f) => f.path.endsWith("px.css")).text;

const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORGE_BROWSER_EXECUTABLE
    ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await page.waitForSelector(".session-item-title");
  const box = await page.locator(".session-item-title").first().boundingBox();
  // Sample the glyph band only (middle third of the line box).
  const clip = {
    x: box.x,
    y: box.y + box.height * 0.3,
    width: box.width,
    height: Math.max(2, box.height * 0.4),
  };
  const shot = await page.screenshot({ clip });
  const png = decodePng(shot);
  const { width, height, channels, pixels } = png;
  // Total ink in a horizontal band. Glyphs are discrete, so a single column is
  // noisy; summing over a band makes the fade measurable and robust.
  const bandInk = (from, to) => {
    const x0 = Math.max(0, Math.floor(width * from));
    const x1 = Math.min(width, Math.ceil(width * to));
    let ink = 0;
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * width + x) * channels;
        const lum =
          0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        ink += Math.max(0, 255 - lum);
        count += 1;
      }
    }
    return count === 0 ? 0 : ink / count;
  };
  const sample = {};
  for (let i = 0; i < 10; i += 1) {
    sample[i] = bandInk(i / 10, (i + 1) / 10);
  }
  // Differential control: same DOM, same position, mask disabled. Comparing the
  // two renders proves the mask (not clipping geometry) causes the fade.
  await page.addStyleTag({
    content: ".session-item-title{mask-image:none !important;-webkit-mask-image:none !important;}",
  });
  await page.waitForTimeout(50);
  const controlShot = await page.screenshot({ clip });
  const control = decodePng(controlShot);
  const controlInk = (() => {
    const x0 = Math.floor(control.width * 0.95);
    let ink = 0;
    let count = 0;
    for (let y = 0; y < control.height; y += 1) {
      for (let x = x0; x < control.width; x += 1) {
        const i = (y * control.width + x) * control.channels;
        const lum =
          0.299 * control.pixels[i] +
          0.587 * control.pixels[i + 1] +
          0.114 * control.pixels[i + 2];
        ink += Math.max(0, 255 - lum);
        count += 1;
      }
    }
    return count === 0 ? 0 : ink / count;
  })();
  const maskedEdge = sample[9];
  // Baseline ink of the row body, to prove glyphs are actually rendered.
  const baseline =
    Object.values(sample)
      .slice(0, 8)
      .reduce((a, b) => a + b, 0) / 8;
  const fading = maskedEdge < baseline * 0.7 && controlInk > maskedEdge * 1.5;
  const inkPresent = baseline > 8;
  console.log(
    `mean ink per decile: ${Object.entries(sample)
      .map(([k, v]) => `${k * 10}%=${v.toFixed(0)}`)
      .join(" ")}`,
  );
  console.log(
    `right-edge ink: masked=${maskedEdge.toFixed(1)} unmasked-control=${controlInk.toFixed(1)}`,
  );
  console.log(`ink present in the row: ${inkPresent}`);
  console.log(`fade caused by the mask (vs unmasked control): ${fading}`);
  if (!inkPresent || !fading) {
    console.log("PIXEL CHECK FAILED");
    process.exitCode = 1;
  } else {
    console.log("PIXEL CHECK PASSED");
  }
} finally {
  await browser.close();
}
