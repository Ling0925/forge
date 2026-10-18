import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";
import { expect, it } from "vitest";
import { createHarness } from "../src/core/harness";
import { type RunEvent, runEventSchema } from "../src/shared/ipc";
import { createWebHost } from "../src/web/server";

it("pushes progress to the browser alongside Vite HMR without HTTP polling", async () => {
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const port = address.port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const directory = await mkdtemp(join(tmpdir(), "forge-ws-browser-"));
  let hold = false;
  let release = () => {};
  const gate = new Promise<void>((done) => { release = done; });
  const service = await createHarness({
    stateDir: join(directory, "state"),
    providerFactory: () => ({
      listModels: async () => ["fixture"],
      complete: async (_messages, _tools, options) => {
        for (let i = 0; i < 5; i++) {
          options.onText(`progress ${i}\n`);
          if (hold && i === 0) await gate;
          await new Promise((done) => setTimeout(done, 120));
        }
        return { message: { role: "assistant", content: "fixture finished" } };
      },
    }),
  });
  await service.updateSettings({
    settings: { baseUrl: "http://localhost:1234/v1", model: "fixture" },
  });
  const web = await createWebHost({
    service,
    workspace: directory,
    host: "127.0.0.1",
    port,
  });
  const vite = await createViteServer({
    configFile: false,
    root: resolve("src/renderer"),
    plugins: [react()],
    server: {
      middlewareMode: true,
      fs: { allow: [resolve(".")] },
      preTransformRequests: false,
      hmr: { server: web.server, host: "127.0.0.1", port },
    },
  });
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "ts",
      contents: `
      import {installWebHost} from './src/renderer/web-host';
      await installWebHost();
      window.forge.onEvent(event => window.recordEvent(event));
      window.probeReady=true;
    `,
    },
    bundle: true,
    write: false,
    format: "esm",
  });
  web.server.on("request", (request, response) => {
    void web.handle(request, response, () => {
      if (request.url === "/probe.js") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(bundle.outputFiles[0]?.text);
      } else if (request.url === "/probe" || request.url === "/workbench") {
        void vite
          .transformIndexHtml(
            "/probe",
            request.url === "/workbench"
              ? '<html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>'
              : '<html><body><script type="module" src="/probe.js"></script></body></html>',
          )
          .then((html) => {
            response.setHeader("Content-Type", "text/html");
            response.end(html);
          });
      } else vite.middlewares(request, response);
    });
  });
  await new Promise<void>((done) => web.server.listen(port, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (String(url).includes("/api/events")) Reflect.set(window, "testEventSocket", this);
        }
      };
    });
    page.setDefaultTimeout(5000);
    const events: RunEvent[] = [];
    const latencies: number[] = [];
    const sockets: string[] = [];
    const polls: string[] = [];
    const errors: string[] = [];
    page.on("websocket", (socket) => sockets.push(socket.url()));
    page.on("request", (request) => {
      if (request.url().includes("/api/events")) polls.push(request.method());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.exposeFunction("recordEvent", (raw: unknown) => {
      const event = runEventSchema.parse(raw);
      events.push(event);
      if (event.event.type === "text_delta")
        latencies.push(Date.now() - Date.parse(event.event.timestamp));
    });
    await page.goto(`${web.origin}/probe`);
    await page.waitForFunction(
      () => Reflect.get(window, "probeReady") === true,
    );
    await page.evaluate(async (workspace) => {
      const snapshot = await window.forge.createSession({
        workspace,
        model: "fixture",
      });
      await window.forge.startRun({
        sessionId: snapshot.id,
        prompt: "fixture",
        permission: "readonly",
      });
    }, directory);
    await expect
      .poll(
        () =>
          events.find((event) => event.event.type === "run_finished")?.event,
      )
      .toMatchObject({ status: "completed" });
    expect(
      events
        .filter((event) => event.event.type === "text_delta")
        .map((event) =>
          event.event.type === "text_delta" ? event.event.text : "",
        ),
    ).toEqual(Array.from({ length: 5 }, (_, i) => `progress ${i}\n`));
    expect(sockets.filter((url) => url.includes("/api/events"))).toHaveLength(
      1,
    );
    expect(sockets.some((url) => !url.includes("/api/events"))).toBe(true);
    expect(polls).toEqual([]);
    latencies.sort((a, b) => a - b);
    expect(latencies[2]).toBeLessThan(100);
    console.log("WebSocket browser event latency (ms):", latencies);
    expect(errors).toEqual([]);
    hold = true;
    events.length = 0;
    const running = await page.evaluate(async (workspace) => {
      const session = await window.forge.createSession({ workspace, model: "fixture" });
      return window.forge.startRun({ sessionId: session.id, prompt: "survive refresh", permission: "readonly" });
    }, directory);
    await expect.poll(() => events.some((event) => event.event.type === "text_delta")).toBe(true);
    const other = await page.context().newPage();
    const otherEvents: RunEvent[] = [];
    other.on("pageerror", error => errors.push(error.message));
    await other.exposeFunction("recordEvent", (raw: unknown) => otherEvents.push(runEventSchema.parse(raw)));
    await other.goto(`${web.origin}/probe`);
    await other.waitForFunction(() => Reflect.get(window, "probeReady") === true);
    expect((await page.evaluate(() => window.forge.getSettings())).isConfigured).toBe(true);
    expect((await other.evaluate(() => window.forge.getSettings())).isConfigured).toBe(true);
    let blockedResumes = 0;
    await page.route("**/api/connection", route => {
      blockedResumes++;
      return route.abort("internetdisconnected");
    });
    const socketCount = sockets.filter(url => url.includes("/api/events")).length;
    await page.evaluate(() => Reflect.get(window, "testEventSocket").close());
    await expect.poll(() => blockedResumes).toBeGreaterThan(0);
    expect((await other.evaluate(sessionId => window.forge.getSession(sessionId), running.sessionId)).status).toBe("running");
    await page.unroute("**/api/connection");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => sockets.filter(url => url.includes("/api/events")).length).toBe(socketCount + 1);
    await expect.poll(() => page.locator("body > [role=status]").innerText()).toContain("已连接");
    expect(events.filter(event => event.event.type === "text_delta")).toHaveLength(1);
    expect(events.some(event => event.event.type === "run_finished")).toBe(false);
    events.length = 0;
    await page.reload();
    await page.waitForFunction(() => Reflect.get(window, "probeReady") === true);
    await expect.poll(() => events.some((event) => event.runId === running.runId && event.event.type === "text_delta" && event.event.text === "progress 0\n")).toBe(true);
    expect(events.some((event) => event.runId === running.runId && event.event.type === "run_started")).toBe(true);
    expect(events.some((event) => event.event.type === "run_finished")).toBe(false);
    await page.goto(`${web.origin}/workbench`);
    await page.getByText("New session", { exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).waitFor();
    await page.getByText("progress 0", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("New session", { exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).waitFor();
    await page.getByText("progress 0", { exact: true }).waitFor();
    release();
    await page.getByRole("button", { name: "取消", exact: true }).waitFor({ state: "hidden" });
    await page.locator("p").filter({ hasText: /^fixture finished$/ }).waitFor();
    await expect.poll(() => otherEvents.some(event => event.event.type === "run_finished")).toBe(true);
    expect(otherEvents.filter(event => event.event.type === "text_delta").map(event => event.event.type === "text_delta" ? event.event.text : "")).toEqual(Array.from({ length: 5 }, (_, i) => `progress ${i}\n`));
    const snapshot = await page.evaluate((sessionId) => window.forge.getSession(sessionId), running.sessionId);
    const deltaResponse = page.waitForResponse(async response => {
      if (!response.url().endsWith("/api/rpc")) return false;
      const value = await response.json();
      return value.method === "getSession" && Boolean(value.result?.sessionDelta);
    });
    const cachedSnapshot = await page.evaluate((sessionId) => window.forge.getSession(sessionId), running.sessionId);
    const delta = await (await deltaResponse).json();
    expect(delta.result.sessionDelta.snapshot.messages).toEqual([]);
    expect(cachedSnapshot.messages).toEqual(snapshot.messages);
    const sessionButtons = page.locator(".session-item-main");
    await sessionButtons.nth(1).click();
    await page.locator("p").filter({ hasText: /^fixture$/ }).waitFor();
    let resumeRead = () => {};
    const pausedRead = new Promise<void>(resolve => { resumeRead = resolve; });
    await page.route("**/api/rpc", async route => {
      const input = route.request().postDataJSON();
      if (input.method === "getSession" && input.sessionId === running.sessionId) await pausedRead;
      await route.continue();
    });
    try {
      await sessionButtons.nth(0).click();
      await page.locator("p").filter({ hasText: /^survive refresh$/ }).waitFor();
      expect(await page.getByText("正在读取会话…", { exact: true }).count()).toBe(0);
      expect(await page.locator("p").filter({ hasText: /^fixture finished$/ }).count()).toBe(1);
    } finally {
      resumeRead();
      await page.unrouteAll({ behavior: "wait" });
    }
    expect(snapshot.messages.some((message) => message.content === "fixture finished")).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    release();
    await browser.close();
    await vite.close();
    await web.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
