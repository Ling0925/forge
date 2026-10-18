import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  BrowserWindow,
  type WebContents,
  app,
  dialog,
  ipcMain,
  shell,
} from "electron";
import { z } from "zod";
import { LAN_CHANNEL, lanRequestSchema, lanStatusSchema } from "../shared/lan";
import {
  IPC_CHANNELS,
  type RpcRequest,
  type RpcResponse,
  type RunId,
  rpcRequestSchema,
  rpcResponseSchema,
  workerMessageSchema,
} from "../shared/ipc";
import type { SessionId } from "../shared/schemas";
import { safeError } from "./controller";
import { exportSessionToFile } from "./export-session";
import { createReadyGate, createShutdownController } from "./lifecycle";

let activeWindow: BrowserWindow | undefined;

export function launchDesktop(): void {
  const renderer = join(__dirname, "../renderer/index.html");
  const trustedURL = pathToFileURL(renderer).href;
  const worker = new Worker(join(__dirname, "worker.cjs"));
  const pending = new Map<
    string,
    {
      request: RpcRequest;
      owner: WebContents;
      resolve: (response: RpcResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const runs = new Map<RunId, { owner: WebContents; sessionId: SessionId }>();
  const gate = createReadyGate();
  let lanUrl: string | null = null;
  const lanPending = new Map<string, { resolve: (url: string | null) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const lanResultSchema = z.object({ control: z.literal("lanResult"), id: z.string().uuid(), url: z.string().nullable(), error: z.string().optional() }).strict();
  const rejectLan = (): void => {
    for (const entry of lanPending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("局域网服务不可用；请检查状态后再操作。"));
    }
    lanPending.clear();
  };
  let stopping = false;
  let quitAllowed = false;
  const shutdown = createShutdownController({
    send: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    report: (message) => {
      console.error(message);
      process.exitCode = 1;
    },
  });
  let failed = false;
  const failure = (request: RpcRequest): RpcResponse => ({
    id: request.id,
    method: request.method,
    ok: false,
    error: safeError,
  });
  // A single unanswered request is a timeout, not proof of a broken protocol;
  // only genuine protocol violations may trip the global fail() circuit breaker.
  const timeoutFailure = (request: RpcRequest): RpcResponse => ({
    id: request.id,
    method: request.method,
    ok: false,
    error: {
      code: "internal",
      message: "The desktop service did not answer in time. Try again.",
      retryable: true,
    },
  });
  const fail = (): void => {
    if (failed) return;
    failed = true;
    gate.fail();
    lanUrl = null;
    rejectLan();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(failure(entry.request));
    }
    pending.clear();
    for (const [runId, run] of runs)
      if (!run.owner.isDestroyed()) {
        run.owner.send(IPC_CHANNELS.event, {
          runId,
          event: {
            type: "error",
            sessionId: run.sessionId,
            timestamp: new Date().toISOString(),
            error: safeError,
          },
        });
        run.owner.send(IPC_CHANNELS.event, {
          runId,
          event: {
            type: "run_finished",
            sessionId: run.sessionId,
            timestamp: new Date().toISOString(),
            status: "failed",
            turns: 0,
            toolCalls: 0,
          },
        });
      }
    runs.clear();
    if (!stopping) {
      stopping = true;
      void shutdown.shutdown();
    }
  };
  const startup = setTimeout(fail, 30000);
  worker.on("error", fail);
  worker.on("exit", () => {
    clearTimeout(startup);
    fail();
  });
  worker.on("message", (raw: unknown) => {
    if (shutdown.accept(raw)) return;
    const lanResult = lanResultSchema.safeParse(raw);
    if (lanResult.success) {
      lanUrl = lanResult.data.url;
      const entry = lanPending.get(lanResult.data.id);
      if (entry) {
        clearTimeout(entry.timer);
        lanPending.delete(lanResult.data.id);
        if (lanResult.data.error) entry.reject(new Error(lanResult.data.error));
        else entry.resolve(lanUrl);
      }
      return;
    }
    const parsed = workerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      fail();
      return;
    }
    const message = parsed.data;
    if (failed) return;
    if (message.kind === "ready") {
      gate.ready();
      clearTimeout(startup);
      return;
    }
    if (message.kind === "response") {
      const entry = pending.get(message.response.id);
      if (!entry) return;
      if (entry.request.method !== message.response.method) {
        fail();
        return;
      }
      pending.delete(message.response.id);
      clearTimeout(entry.timer);
      if (message.response.ok && message.response.method === "startRun") {
        const handle = message.response.result;
        runs.set(handle.runId, {
          owner: entry.owner,
          sessionId: handle.sessionId,
        });
        if (entry.owner.isDestroyed())
          worker.postMessage({
            id: randomUUID(),
            method: "cancelRun",
            runId: handle.runId,
          });
      }
      entry.resolve(message.response);
    } else {
      // LAN and desktop are views of the same controller, including remotely started runs.
      const run = runs.get(message.data.runId);
      if (run && run.sessionId !== message.data.event.sessionId) return;
      if (!contents.isDestroyed()) {
        if (message.data.event.type === "run_started")
          runs.set(message.data.runId, { owner: contents, sessionId: message.data.event.sessionId });
        contents.send(IPC_CHANNELS.event, message.data);
      }
      if (message.data.event.type === "run_finished")
        runs.delete(message.data.runId);
    }
  });
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  const contents = window.webContents;
  activeWindow = window;
  window.on("closed", () => {
    if (activeWindow === window) activeWindow = undefined;
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("before-input-event", (event, input) => {
    if (input.key === "F7") event.preventDefault();
  });
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-frame-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.on("will-download", (event) => event.preventDefault());
  contents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      const root = pathToFileURL(join(__dirname, "../renderer/")).href;
      allowed = url.protocol === "file:" && url.href.startsWith(root);
    } catch {
      /* Deny malformed URLs. */
    }
    callback({ cancel: !allowed });
  });
  const sendWorker = (
    request: RpcRequest,
    owner: WebContents,
  ): Promise<RpcResponse> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Normal responses delete the entry first; a stale timer must not
        // resolve an already-settled request twice.
        if (!pending.delete(request.id)) return;
        resolve(timeoutFailure(request));
      }, 660000);
      pending.set(request.id, { request, owner, resolve, timer });
      try {
        worker.postMessage(request);
      } catch {
        fail();
      }
    });
  ipcMain.handle(LAN_CHANNEL, async (event, raw: unknown) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== trustedURL)
      throw new Error("Request denied.");
    const request = lanRequestSchema.parse(raw);
    if (stopping || failed) throw new Error("Desktop service unavailable.");
    if (request.action !== "status") {
      if (!(await gate.wait()) || stopping || failed) throw new Error("Desktop service unavailable.");
      await new Promise<string | null>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          lanPending.delete(id);
          reject(new Error("局域网操作超时；请刷新状态确认，不要自动重试。"));
        }, 30_000);
        lanPending.set(id, { resolve, reject, timer });
        try {
          worker.postMessage(request.action === "start"
            ? { control: "startLan", id, host: request.host, port: request.port, workspace: request.workspace }
            : { control: "stopLan", id });
        } catch { fail(); }
      });
    }
    const addresses = [...new Set(Object.values(networkInterfaces()).flatMap(entries =>
      (entries ?? []).filter(entry => entry.family === "IPv4" && !entry.internal).map(entry => entry.address)))];
    return lanStatusSchema.parse({ url: lanUrl, addresses });
  });
  ipcMain.handle(
    IPC_CHANNELS.request,
    async (event, raw: unknown): Promise<RpcResponse> => {
      const parsed = rpcRequestSchema.safeParse(raw);
      if (
        !parsed.success ||
        event.sender !== contents ||
        event.senderFrame !== contents.mainFrame ||
        event.senderFrame.url !== trustedURL
      )
        throw new Error("Request denied.");
      const request = parsed.data;
      if (stopping) return failure(request);
      if (request.method === "openExternal") {
        try {
          await shell.openExternal(request.url);
          return rpcResponseSchema.parse({
            id: request.id,
            method: request.method,
            ok: true,
            result: null,
          });
        } catch {
          return failure(request);
        }
      }
      if (request.method === "chooseWorkspace") {
        try {
          const result = await dialog.showOpenDialog(window, {
            properties: ["openDirectory"],
          });
          return rpcResponseSchema.parse({
            id: request.id,
            method: request.method,
            ok: true,
            result: result.canceled ? null : (result.filePaths[0] ?? null),
          });
        } catch {
          return failure(request);
        }
      }
      if (stopping || failed)
        return {
          id: request.id,
          method: request.method,
          ok: false,
          error: {
            code: "internal",
            message:
              "Desktop service is unavailable. Restart Forge and try again.",
            retryable: true,
          },
        };
      if (!(await gate.wait()))
        return {
          id: request.id,
          method: request.method,
          ok: false,
          error: {
            code: "internal",
            message:
              "Desktop service failed to start or its startup queue is full. Restart Forge and try again.",
            retryable: true,
          },
        };
      if (
        stopping ||
        failed ||
        contents.isDestroyed() ||
        pending.has(request.id)
      )
        return failure(request);
      if (
        (request.method === "cancelRun" ||
          request.method === "setRunPermission" ||
          request.method === "steerRun" ||
          request.method === "answerApproval") &&
        runs.get(request.runId)?.owner !== contents
      )
        return failure(request);
      if (request.method === "exportSession") {
        try {
          const saved = await exportSessionToFile(request.sessionId, {
            choose: async (defaultPath) => {
              const selected = await dialog.showSaveDialog(window, {
                title: "Export session JSON",
                defaultPath,
                filters: [{ name: "JSON", extensions: ["json"] }],
              });
              return selected.canceled ? undefined : selected.filePath;
            },
            load: async (sessionId) => {
              if (stopping || failed || contents.isDestroyed())
                throw new Error("Desktop service unavailable.");
              const response = await sendWorker(
                { id: randomUUID(), method: "getSession", sessionId },
                contents,
              );
              if (!response.ok || response.method !== "getSession")
                throw new Error("Session could not be loaded for export.");
              return response.result;
            },
          });
          if (stopping || failed || contents.isDestroyed())
            return failure(request);
          return rpcResponseSchema.parse({
            id: request.id,
            method: request.method,
            ok: true,
            result: saved,
          });
        } catch {
          return {
            id: request.id,
            method: request.method,
            ok: false,
            error: {
              code: "storage",
              message:
                "Could not export the session. Check the selected location and try again.",
              retryable: true,
            },
          };
        }
      }
      return sendWorker(request, contents);
    },
  );
  const cancelOwned = (): void => {
    for (const [runId, run] of runs)
      if (run.owner === contents && !failed)
        worker.postMessage({ id: randomUUID(), method: "cancelRun", runId });
  };
  // A renderer crash must not cancel work that a paired phone can still control.
  contents.on("render-process-gone", () => { if (!lanUrl) cancelOwned(); });
  let quitting = false;
  const closeGracefully = (): void => {
    if (quitting) return;
    quitting = true;
    stopping = true;
    gate.fail();
    clearTimeout(startup);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(failure(entry.request));
    }
    pending.clear();
    rejectLan();
    void shutdown.shutdown().then(() => {
      quitAllowed = true;
      ipcMain.removeHandler(LAN_CHANNEL);
      ipcMain.removeHandler(IPC_CHANNELS.request);
      app.quit();
    });
  };
  window.on("close", (event) => {
    if (!quitAllowed) {
      event.preventDefault();
      closeGracefully();
    }
  });
  app.on("before-quit", (event) => {
    if (!quitAllowed) {
      event.preventDefault();
      closeGracefully();
    }
  });
  void window.loadFile(renderer).catch(fail);
}
// Without the single-instance lock, a second launch would fork a second worker
// and let two HarnessService instances write the same session store concurrently.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!activeWindow) return;
  if (activeWindow.isMinimized()) activeWindow.restore();
  activeWindow.focus();
});
void app
  .whenReady()
  .then(launchDesktop)
  .catch(() => app.quit());
app.on("window-all-closed", () => app.quit());
