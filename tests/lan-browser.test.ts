import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { createHarness } from "../src/core/harness";
import { createRuntimeHub } from "../src/desktop/runtime";
import { startLanServer } from "../src/web/lan";

// Requires `pnpm build:web`: exercises the built renderer and production CSP,
// not a Vite fixture. Never reads the real FORGE_HOME or contacts a provider.
it("loads the packaged mobile workbench, pairs and reconnects to a desktop-owned run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forge-lan-browser-"));
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, "127.0.0.1", done));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  await new Promise<void>(done => reservation.close(() => done()));
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  const service = await createHarness({
    stateDir: join(directory, "state"),
    providerFactory: () => ({
      listModels: async () => ["fixture"],
      complete: async (_messages, _tools, options) => {
        options.onText("shared runtime output");
        await held;
        return { message: { role: "assistant", content: "shared runtime output" } };
      },
    }),
  });
  await service.updateSettings({ settings: { baseUrl: "http://localhost:1234/v1", model: "fixture" } });
  const runtime = createRuntimeHub(service);
  const server = await startLanServer({ runtime, host: "127.0.0.1", port: address.port, workspace: directory, rendererRoot: resolve("dist/renderer") });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await context.newPage();
    phone.setDefaultTimeout(10_000);
    const errors: string[] = [];
    phone.on("pageerror", error => errors.push(error.message));
    await phone.goto(server.origin);
    await phone.waitForFunction(() => !!window.forge && !!window.forgeLan);
    expect(await phone.evaluate(() => window.forgeLan!.status())).toMatchObject({ url: server.origin });
    const second = await context.newPage();
    await second.goto(server.origin);
    await second.waitForFunction(() => !!window.forge);
    const session = await service.createSession({ workspace: directory, model: "fixture" });
    const response = await runtime.request({ id: crypto.randomUUID(), method: "startRun", input: { sessionId: session.id, prompt: "shared task", permission: "readonly" } });
    if (!response.ok || response.method !== "startRun") throw new Error("Run not accepted");
    // A newly created remote session appears in recent tasks without hijacking an open draft.
    await phone.locator(".welcome-task").first().click();
    await expect.poll(() => phone.locator("body").innerText(), { timeout: 10_000 }).toContain("shared runtime output");
    await phone.reload();
    await phone.waitForFunction(() => !!window.forge);
    await phone.locator(".welcome-task").first().click();
    await expect.poll(() => phone.locator("body").innerText(), { timeout: 10_000 }).toContain("shared runtime output");
    expect((await second.evaluate(id => window.forge.getSession(id), session.id)).status).toBe("running");
    await phone.getByRole("button", { name: "设置", exact: true }).click();
    await phone.getByRole("button", { name: "手机连接", exact: true }).click();
    await phone.locator("img.phone-pairing-qr").waitFor();
    expect(await phone.getByLabel("配对地址").inputValue()).toBe(server.origin);
    expect(await phone.getByRole("button", { name: "开始公开", exact: true }).count()).toBe(0);
    expect(await phone.locator(".settings-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await server.close();
    expect((await service.getSession(session.id)).status).toBe("running");
    expect(errors).toEqual([]);
  } finally {
    release();
    await browser.close();
    await server.close();
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
