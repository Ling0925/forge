import { z } from "zod";
import { createTransportBridge } from "../shared/bridge";
import { externalUrlSchema, runEventSchema, rpcResponseSchema } from "../shared/ipc";
import type { SessionSnapshot } from "../shared/schemas";
import { applySessionDelta, sessionDeltaSchema } from "../shared/session-delta";

const handshakeSchema = z.object({
  workspace: z.string(),
  cursor: z.number().int().nonnegative(),
  clientId: z.string().uuid(),
  recovery: z.array(runEventSchema).default([]),
});
const batchSchema = z.object({
  cursor: z.number().int().nonnegative(),
  events: z.array(runEventSchema),
});
// protocol remains stable across HMR module re-evaluation after window.forge is installed.
export const hostCapabilities = {
  web: location.protocol !== "file:",
  exportSession: location.protocol === "file:",
};

export async function installWebHost(): Promise<void> {
  if (window.forge) return;
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.style.cssText =
    "padding:6px 16px;font:12px system-ui;background:#eee9d7;color:#333;flex-shrink:0;overflow-wrap:anywhere";
  document.body.prepend(status);
  const layout = document.createElement("style");
  layout.textContent =
    "body{display:flex;flex-direction:column;height:100dvh}#root{flex:1;min-height:0}#root .wb-app{height:100%}";
  document.head.append(layout);
  let stopped = false;
  let clientId = "";
  let eventSocket: WebSocket | undefined;
  const snapshots = new Map<string, { readonly revision: string; readonly snapshot: SessionSnapshot; readonly size: number }>();
  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    eventSocket?.close();
    status.textContent = message;
    status.style.background = "#f7d4cf";
  };
  async function post(path: string, input: unknown, timeout = 125_000, sessionId?: string): Promise<unknown> {
    if (stopped)
      throw new Error("Web connection stopped. Reload to reconnect.");
    const cached = sessionId ? snapshots.get(sessionId) : undefined;
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Forge-Client": clientId,
        ...(cached ? { "X-Forge-Snapshot": cached.revision } : {}),
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      if ([401, 410].includes(response.status) || (response.status === 409 && details?.error?.startsWith("Another page")))
        fail(
          "Web 连接失效或已被另一页面接管；任务继续在后台运行，请刷新重新连接。",
        );
      throw new Error(
        `Web request failed (${response.status}); inspect state before retrying.`,
      );
    }
    let value: unknown = await response.json();
    if (sessionId) {
      const delta = z.object({ id: z.string(), ok: z.literal(true), method: z.literal("getSession"),
        result: z.object({ sessionDelta: sessionDeltaSchema }) }).safeParse(value);
      if (delta.success) {
        if (!cached) throw new Error("Missing session cache base");
        value = { ...delta.data, result: applySessionDelta(cached.snapshot, cached.revision, delta.data.result.sessionDelta) };
      }
      const result = rpcResponseSchema.parse(value);
      const revision = response.headers.get("X-Forge-Snapshot");
      if (result.ok && result.method === "getSession" && revision) {
        snapshots.delete(sessionId);
        snapshots.set(sessionId, { revision, snapshot: result.result, size: JSON.stringify(result.result).length });
        let size = 0;
        let count = 0;
        for (const [id, entry] of [...snapshots].reverse()) {
          count++;
          size += entry.size;
          if (size > 32 * 1024 * 1024 || count > 8) snapshots.delete(id);
        }
      }
    }
    return value;
  }
  try {
    const handshake = handshakeSchema.parse(await post("/api/connect", {}));
    clientId = handshake.clientId;
    let cursor = handshake.cursor;
    let receive: (raw: unknown) => void = () => {};
    const bridge = createTransportBridge({
      request: (input) => post("/api/rpc", input, 125_000, input.method === "getSession" ? input.sessionId : undefined),
      onEvent: (listener) => {
        receive = listener;
      },
    });
    for (const event of handshake.recovery) receive(event);
    const connectedStatus = `Web Dev · WebSocket 实时连接 · 固定工作区：${handshake.workspace} · 断线自动重连 · 后端修改需重启`;
    await new Promise<void>((ready, reject) => {
      let failures = 0;
      const retry = () => {
        if (stopped) { reject(new Error("Web connection stopped")); return; }
        status.textContent = "连接中断，正在自动重连…任务继续在后台运行。";
        status.style.background = "#eee9d7";
        setTimeout(() => void connect(true), Math.min(10_000, 500 * 2 ** Math.min(failures++, 5)));
      };
      const connect = async (resume: boolean) => {
        if (stopped) return;
        try {
          if (resume) {
            const state = z.object({ resumable: z.boolean() }).parse(await post("/api/connection", { cursor }, 10_000));
            if (!state.resumable) { location.reload(); return; }
          }
          if (stopped) return;
          const url = new URL("/api/events", location.href);
          url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
          url.searchParams.set("clientId", clientId);
          url.searchParams.set("cursor", String(cursor));
          const socket = new WebSocket(url);
          eventSocket = socket;
          let disconnected = false;
          const timeout = setTimeout(() => disconnect(), 10_000);
          const disconnect = (code?: number) => {
            if (disconnected) return;
            disconnected = true;
            clearTimeout(timeout);
            socket.close();
            if (code === 4001 || code === 1008) {
              fail(code === 4001 ? "此页面已被另一窗口接管，任务继续运行。" : "事件协议异常，请重新连接。");
              reject(new Error("WebSocket control ended"));
              return;
            }
            retry();
          };
          socket.onclose = event => disconnect(event.code);
          socket.onerror = () => disconnect();
          socket.onmessage = message => {
            if (stopped || disconnected) return;
            try {
              const batch = batchSchema.parse(JSON.parse(message.data));
              if (batch.cursor !== cursor + batch.events.length) throw new Error("Event sequence gap");
              for (const event of batch.events) receive(event);
              cursor = batch.cursor;
              socket.send(JSON.stringify({ cursor }));
              clearTimeout(timeout);
              failures = 0;
              status.textContent = connectedStatus;
              status.style.background = "#eee9d7";
              ready();
            } catch { disconnect(); }
          };
        } catch { retry(); }
      };
      void connect(false);
    });
    Object.defineProperty(window, "forge", {
      value: Object.freeze({
        ...bridge,
        chooseWorkspace: async () => handshake.workspace,
        openExternal: async (value: string) => {
          window.open(
            externalUrlSchema.parse(value),
            "_blank",
            "noopener,noreferrer",
          );
        },
        exportSession: async () => {
          throw new Error("Web 开发版暂不支持桌面文件导出。");
        },
      }),
    });
  } catch (error) {
    fail("Web 初始化失败，请刷新页面重新登录。");
    throw error;
  }
}
