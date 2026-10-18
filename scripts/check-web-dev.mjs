// Focused browser smoke against a separately launched, temporary-FORGE_HOME dev server.
// Usage: node scripts/check-web-dev.mjs URL
import assert from "node:assert/strict";
import { chromium } from "playwright";
const [url] = process.argv.slice(2);
if (!url) throw new Error("Expected temporary dev server URL");
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const websocket = page.waitForEvent("websocket", { predicate: socket => socket.url().includes("token=") });
  await page.goto(url);
  await page.locator(".workbench-composer").waitFor();
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  const ws = await websocket;
  assert.match(ws.url(), /token=/);
  await page.waitForFunction(() => window.forge && document.querySelector('body > [role="status"]')?.textContent?.includes("已连接"));
  const values = await page.evaluate(async () => ({
    workspace: await window.forge.chooseWorkspace(),
    sessions: (await window.forge.listSessions()).length,
    secure: window.isSecureContext,
  }));
  assert.equal(values.sessions, 0);
  assert.match(values.workspace, /desktop-harness$/);
  // Exercise real renderer transport/CRUD with a fixture model; never call an external provider.
  const created = await page.evaluate(async () => {
    const workspace = await window.forge.chooseWorkspace();
    return window.forge.createSession({ workspace, title: "Web smoke", model: "fixture-model" });
  });
  assert.equal(created.title, "Web smoke");
  await page.reload();
  await page.locator(".workbench-composer").waitFor();
  await page.waitForFunction(() => window.forge && document.querySelector('body > [role="status"]')?.textContent?.includes("已连接"));
  assert.equal(await page.evaluate(async () => (await window.forge.listSessions()).length), 1);
  assert.deepEqual(errors, []);
  console.log("PASS: password-free entry, shared React UI, HMR socket, bridge CRUD, reload handshake; no browser errors.");
} finally { await browser.close(); }
