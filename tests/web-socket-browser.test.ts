import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
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
  const service = await createHarness({
    stateDir: join(directory, "state"),
    providerFactory: () => ({
      listModels: async () => ["fixture"],
      complete: async (_messages, _tools, options) => {
        for (let i = 0; i < 5; i++) {
          options.onText(`progress ${i}\n`);
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
    token: "fixture-passphrase",
  });
  const vite = await createViteServer({
    configFile: false,
    root: resolve("src/renderer"),
    server: {
      middlewareMode: true,
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
      } else if (request.url === "/probe") {
        void vite
          .transformIndexHtml(
            "/probe",
            '<html><body><script type="module" src="/probe.js"></script></body></html>',
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
    const page = await browser.newPage();
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
    await page.goto(web.origin);
    await page.evaluate(async () => {
      const response = await fetch("/api/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer fixture-passphrase",
        },
        body: "{}",
      });
      if (!response.ok) throw new Error("Login failed");
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
  } finally {
    await browser.close();
    await vite.close();
    await web.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
