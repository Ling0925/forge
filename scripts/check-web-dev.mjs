// Focused browser smoke against a separately launched, temporary-FORGE_HOME dev server.
// Usage: node scripts/check-web-dev.mjs URL
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
const [url] = process.argv.slice(2);
if (!url) throw new Error("Expected temporary dev server URL");
const otherWorkspace = await mkdtemp(join(tmpdir(), "forge-web-workspace-"));
let browser;
try {
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true });
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
    restricted: window.forge.restrictWorkspace,
  }));
  assert.equal(values.sessions, 0);
  assert.equal(values.restricted, false);
  // A clean FORGE_HOME opens Settings automatically until a model is configured.
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  // Exercise real renderer transport/CRUD with a fixture model; never call an external provider.
  const created = await page.evaluate(async () => {
    const workspace = await window.forge.chooseWorkspace();
    return window.forge.createSession({ workspace, title: "Web smoke", model: "fixture-model" });
  });
  assert.equal(created.title, "Web smoke");
  await page.locator(".composer-project-trigger").click();
  const workspaceInput = page.locator("#workspace-path");
  assert.equal(await workspaceInput.inputValue(), values.workspace);
  assert.equal(await workspaceInput.isEditable(), true);
  await workspaceInput.fill(otherWorkspace);
  const external = await page.evaluate(async () => {
    const workspace = document.querySelector("#workspace-path").value;
    return window.forge.createSession({ workspace, title: "Other project", model: "fixture-model" });
  });
  assert.equal(external.workspace, otherWorkspace);
  const renamed = await page.evaluate(id => window.forge.renameSession(id, "Other project renamed"), external.id);
  assert.equal(renamed.title, "Other project renamed");
  await page.reload();
  await page.locator(".workbench-composer").waitFor();
  await page.waitForFunction(() => window.forge && document.querySelector('body > [role="status"]')?.textContent?.includes("已连接"));
  const restored = await page.evaluate(async id => ({
    sessions: await window.forge.listSessions(),
    session: await window.forge.getSession(id),
  }), external.id);
  assert.deepEqual(new Set(restored.sessions.map(session => session.workspace)), new Set([values.workspace, otherWorkspace]));
  assert.equal(restored.session.title, "Other project renamed");
  assert.deepEqual(errors, []);
  console.log("PASS: password-free entry, shared React UI, HMR socket, editable server workspace, cross-workspace CRUD/list/reload; no browser errors.");
} finally {
  try { await browser?.close(); }
  finally { await rm(otherWorkspace, { recursive: true, force: true }); }
}
