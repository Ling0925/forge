import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), workers: [] as any[], windows: [] as any[] }));
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => 0);
    constructor() { super(); mocks.workers.push(this); }
  },
}));
vi.mock("electron", () => ({
  app: { requestSingleInstanceLock: () => true, on: vi.fn(), whenReady: () => new Promise(() => {}), quit: vi.fn() },
  ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => mocks.handlers.set(name, callback), removeHandler: vi.fn() },
  shell: { openExternal: vi.fn() }, dialog: {},
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {}, isDestroyed: () => false, send: vi.fn(), setWindowOpenHandler: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), on: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } },
    });
    loadFile = vi.fn(async () => {});
    constructor() { super(); mocks.windows.push(this); }
  },
}));

beforeEach(() => { mocks.handlers.clear(); mocks.windows.length = 0; mocks.workers.length = 0; vi.stubGlobal("__dirname", "/fixture/desktop"); });

it("broadcasts phone-started runs to the desktop and permits desktop control", async () => {
  const { launchDesktop } = await import("../../src/desktop/main");
  launchDesktop();
  const worker = mocks.workers[0];
  worker.emit("message", { kind: "ready" });
  const contents = mocks.windows[0].webContents;
  const runId = randomUUID();
  const sessionId = randomUUID();
  const data = { runId, event: { type: "run_started", sessionId, timestamp: new Date().toISOString(), model: "fixture", permission: "workspace" } };
  worker.emit("message", { kind: "event", data });
  expect(contents.send).toHaveBeenCalledWith("forge:event", data);
  const request = { id: randomUUID(), method: "cancelRun", runId };
  const promise = mocks.handlers.get("forge:request")!({ sender: contents, senderFrame: Object.assign(contents.mainFrame, { url: pathToFileURL(mocks.windows[0].loadFile.mock.calls[0][0]).href }) }, request);
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(request));
  worker.emit("message", { kind: "response", response: { id: request.id, method: "cancelRun", ok: true, result: null } });
  await expect(promise).resolves.toMatchObject({ ok: true });
});

it("starts LAN only on an explicit trusted IPC request and reports the worker result", async () => {
  const { launchDesktop } = await import("../../src/desktop/main");
  launchDesktop();
  const worker = mocks.workers[0];
  worker.emit("message", { kind: "ready" });
  const contents = mocks.windows[0].webContents;
  const event = { sender: contents, senderFrame: Object.assign(contents.mainFrame, { url: pathToFileURL(mocks.windows[0].loadFile.mock.calls[0][0]).href }) };
  const handler = mocks.handlers.get("forge:lan")!;
  expect(worker.postMessage).not.toHaveBeenCalled();
  await expect(handler({ ...event, sender: {} }, { action: "start", host: "192.168.1.2", port: 5173, workspace: "/fixture" })).rejects.toThrow("denied");
  const promise = handler(event, { action: "start", host: "192.168.1.2", port: 5173, workspace: "/fixture" });
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  const message = worker.postMessage.mock.calls[0][0];
  expect(message).toMatchObject({ control: "startLan", host: "192.168.1.2", port: 5173, workspace: "/fixture" });
  worker.emit("message", { control: "lanResult", id: message.id, url: "http://192.168.1.2:5173" });
  await expect(promise).resolves.toMatchObject({ url: "http://192.168.1.2:5173" });
  await expect(handler(event, { action: "status" })).resolves.toMatchObject({ url: "http://192.168.1.2:5173" });
});
