import { contextBridge, ipcRenderer } from "electron";
import {
  type ForgeBridge,
  IPC_CHANNELS,
  type RpcRequest,
  type RpcResponse,
  type RunEvent,
  rpcRequestSchema,
  rpcResponseSchema,
  runEventSchema,
} from "../shared/ipc";

type Results = {
  [M in RpcRequest["method"]]: Extract<
    RpcResponse,
    { ok: true; method: M }
  >["result"];
};

export function createBridge(): ForgeBridge {
  const listeners = new Set<(event: RunEvent) => void>();
  const events: RunEvent[] = [];
  let starting = 0;
  const deliver = (): void => {
    if (starting) return;
    for (const event of events.splice(0))
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          /* Consumer isolation. */
        }
      }
  };
  ipcRenderer.on(IPC_CHANNELS.event, (_event, raw: unknown) => {
    const parsed = runEventSchema.safeParse(raw);
    if (parsed.success) {
      events.push(parsed.data);
      setTimeout(deliver, 0);
    }
  });
  async function request<M extends RpcRequest["method"]>(
    method: M,
    fields: object = {},
  ): Promise<Results[M]> {
    const input = rpcRequestSchema.safeParse({
      id: crypto.randomUUID(),
      method,
      ...fields,
    });
    if (!input.success) throw new Error("Invalid request.");
    let raw: unknown;
    try {
      raw = await ipcRenderer.invoke(IPC_CHANNELS.request, input.data);
    } catch {
      throw new Error("Desktop service unavailable.");
    }
    const response = rpcResponseSchema.safeParse(raw);
    if (
      !response.success ||
      response.data.id !== input.data.id ||
      response.data.method !== method
    )
      throw new Error("Invalid desktop response.");
    if (!response.data.ok) throw new Error(response.data.error.message);
    return response.data.result as Results[M];
  }
  return Object.freeze({
    getSettings: () => request("getSettings"),
    updateSettings: (input) => request("updateSettings", { input }),
    listModels: () => request("listModels"),
    listSessions: () => request("listSessions"),
    createSession: (input) => request("createSession", { input }),
    getSession: (sessionId) => request("getSession", { sessionId }),
    compactSession: (sessionId) => request("compactSession", { sessionId }),
    forkSession: (sessionId, boundary) =>
      request("forkSession", { sessionId, boundary }),
    renameSession: (sessionId, title) =>
      request("renameSession", { sessionId, title }),
    archiveSession: (sessionId, archived) =>
      request("archiveSession", { sessionId, archived }),
    getDiagnostics: (sessionId) => request("getDiagnostics", { sessionId }),
    getProjectContext: (sessionId) =>
      request("getProjectContext", { sessionId }),
    listMcpServers: () => request("listMcpServers"),
    registerMcpServer: (input) => request("registerMcpServer", { input }),
    setMcpEnabled: async (serverId, enabled) => {
      await request("setMcpEnabled", { serverId, enabled });
    },
    removeMcpServer: async (serverId) => {
      await request("removeMcpServer", { serverId });
    },
    getMcpHealth: (serverId) => request("getMcpHealth", { serverId }),
    listCheckpoints: (sessionId) => request("listCheckpoints", { sessionId }),
    getCheckpointDiff: (sessionId, checkpointId) =>
      request("getCheckpointDiff", { sessionId, checkpointId }),
    restoreCheckpoint: (sessionId, checkpointId) =>
      request("restoreCheckpoint", { sessionId, checkpointId }),
    openExternal: async (url) => {
      await request("openExternal", { url });
    },
    chooseWorkspace: () => request("chooseWorkspace"),
    exportSession: (sessionId) => request("exportSession", { sessionId }),
    cancelSession: (sessionId) => request("cancelSession", { sessionId }),
    async startRun(input) {
      starting++;
      try {
        return await request("startRun", { input });
      } finally {
        starting--;
        setTimeout(deliver, 0);
      }
    },
    async cancelRun(runId) {
      await request("cancelRun", { runId });
    },
    async answerApproval(runId, approvalId, approved) {
      await request("answerApproval", { runId, approvalId, approved });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } satisfies ForgeBridge);
}
contextBridge.exposeInMainWorld("forge", createBridge());
