import { z } from "zod";
import { createTransportBridge } from "../shared/bridge";
import { externalUrlSchema, runEventSchema } from "../shared/ipc";

const handshakeSchema = z.object({
  workspace: z.string(),
  cursor: z.number().int().nonnegative(),
  clientId: z.string().uuid(),
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
  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    eventSocket?.close();
    status.textContent = message;
    status.style.background = "#f7d4cf";
  };
  async function post(path: string, input: unknown): Promise<unknown> {
    if (stopped)
      throw new Error("Web connection stopped. Reload to reconnect.");
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Forge-Client": clientId,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(125_000),
    });
    if (!response.ok) {
      if ([401, 409, 410].includes(response.status))
        fail(
          "Web 连接失效或已被另一页面接管；请刷新重新连接。当前任务将被取消。",
        );
      throw new Error(
        `Web request failed (${response.status}); inspect state before retrying.`,
      );
    }
    return response.json();
  }
  try {
    const handshake = handshakeSchema.parse(await post("/api/connect", {}));
    clientId = handshake.clientId;
    let cursor = handshake.cursor;
    let receive: (raw: unknown) => void = () => {};
    const bridge = createTransportBridge({
      request: (input) => post("/api/rpc", input),
      onEvent: (listener) => {
        receive = listener;
      },
    });
    const url = new URL("/api/events", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("clientId", clientId);
    url.searchParams.set("cursor", String(cursor));
    const socket = new WebSocket(url);
    eventSocket = socket;
    await new Promise<void>((ready, reject) => {
      let connected = false;
      const timeout = setTimeout(() => disconnect(), 10_000);
      const disconnect = () => {
        clearTimeout(timeout);
        fail(
          "WebSocket 连接已断开，请刷新重新连接；断线约20秒后取消运行。请求不会自动重放。",
        );
        if (!connected) reject(new Error("WebSocket connection failed"));
      };
      socket.onclose = disconnect;
      socket.onerror = disconnect;
      socket.onmessage = (message) => {
        if (stopped) return;
        try {
          const batch = batchSchema.parse(JSON.parse(message.data));
          if (batch.cursor !== cursor + batch.events.length)
            throw new Error("Event sequence gap");
          for (const event of batch.events) receive(event);
          cursor = batch.cursor;
          socket.send(JSON.stringify({ cursor }));
          if (!connected) {
            connected = true;
            clearTimeout(timeout);
            ready();
          }
        } catch {
          disconnect();
        }
      };
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
    status.textContent = `Web Dev · WebSocket 实时连接 · 固定工作区：${handshake.workspace} · 刷新/切换控制页/断线超过20秒会取消运行 · 后端修改需重启`;
  } catch (error) {
    fail("Web 初始化失败，请刷新页面重新登录。");
    throw error;
  }
}
