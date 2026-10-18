import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise<void>(done => server.close(() => done()));
  if (!address || typeof address === "string") throw new Error("Missing port");
  return address.port;
}

it("serves built standalone Web HTTP and shuts down with an isolated home", async () => {
  const home = await mkdtemp(join(tmpdir(), "forge-lan-entry-"));
  const port = await freePort();
  const process = spawn("node", ["dist/web/serve.mjs", "--host", "127.0.0.1", "--port", String(port), "--workspace", home], {
    cwd: resolve("."), env: { PATH: globalThis.process.env.PATH!, FORGE_HOME: home }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  process.stdout.on("data", chunk => { output += chunk.toString(); });
  process.stderr.on("data", chunk => { output += chunk.toString(); });
  const closed = new Promise<number | null>(done => process.once("close", done));
  try {
    await expect.poll(() => output, { timeout: 10_000 }).toContain("Forge Web:");
    const page = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`connect-src 'self' ws://127.0.0.1:${port};`);
    process.kill("SIGTERM");
    expect(await closed).toBe(0);
  } finally {
    if (process.exitCode === null) process.kill("SIGTERM");
    await closed;
    await rm(home, { recursive: true, force: true });
  }
});

it("starts and stops built desktop LAN in the same isolated worker", async () => {
  const home = await mkdtemp(join(tmpdir(), "forge-worker-lan-"));
  const port = await freePort();
  const worker = new Worker(resolve("dist/desktop/worker.cjs"), { env: { PATH: process.env.PATH!, FORGE_HOME: home } });
  const messages: any[] = [];
  worker.on("message", message => messages.push(message));
  const exited = new Promise<number>(done => worker.once("exit", done));
  try {
    await expect.poll(() => messages, { timeout: 10_000 }).toContainEqual({ kind: "ready" });
    const id = randomUUID();
    worker.postMessage({ control: "startLan", id, host: "127.0.0.1", port, workspace: home });
    await expect.poll(() => messages, { timeout: 10_000 }).toContainEqual({ control: "lanResult", id, url: `http://127.0.0.1:${port}` });
    expect((await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) })).status).toBe(200);
    const stopId = randomUUID();
    worker.postMessage({ control: "stopLan", id: stopId });
    await expect.poll(() => messages).toContainEqual({ control: "lanResult", id: stopId, url: null });
    const requestId = randomUUID();
    worker.postMessage({ id: requestId, method: "listSessions" });
    await expect.poll(() => messages.find(message => message.response?.id === requestId)).toMatchObject({ response: { ok: true, result: [] } });
    const shutdownId = randomUUID();
    worker.postMessage({ control: "shutdown", id: shutdownId });
    await expect.poll(() => messages, { timeout: 10_000 }).toContainEqual({ control: "shutdownAck", id: shutdownId, clean: true });
    expect(await exited).toBe(0);
  } finally {
    await worker.terminate();
    await exited;
    await rm(home, { recursive: true, force: true });
  }
});
