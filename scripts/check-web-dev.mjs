// Focused browser smoke against a separately launched, temporary-FORGE_HOME dev server.
// Usage: node scripts/check-web-dev.mjs URL PASSPHRASE
import assert from "node:assert/strict";
import { chromium } from "playwright";
const [url, passphrase] = process.argv.slice(2);
if (!url || !passphrase) throw new Error("Expected URL and temporary server passphrase");
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const websocket = page.waitForEvent("websocket");
  await page.goto(url);
  await page.getByLabel("访问口令").fill(passphrase);
  await page.getByRole("button", { name: "连接工作台" }).click();
  await page.getByRole("heading", { name: "新会话", exact: true }).waitFor();
  const ws = await websocket;
  assert.match(ws.url(), /token=/);
  await page.waitForFunction(() => window.forge && document.querySelector('[role="status"]')?.textContent?.includes("固定工作区"));
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
  await page.getByRole("heading", { name: "新会话", exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(async () => (await window.forge.listSessions()).length), 1);
  assert.deepEqual(errors, []);
  console.log("PASS: login, shared React UI, authenticated HMR socket, bridge CRUD, reload handshake; no browser errors.");
} finally { await browser.close(); }
