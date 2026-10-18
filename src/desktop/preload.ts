import { contextBridge, ipcRenderer } from "electron";
import { createTransportBridge } from "../shared/bridge";
import { IPC_CHANNELS, type ForgeBridge, rpcRequestSchema, rpcResponseSchema } from "../shared/ipc";
import { requestId } from "../shared/bridge";
import { createForgeLanBridge, LAN_CHANNEL } from "../shared/lan";

export function createBridge(): ForgeBridge {
  const bridge = createTransportBridge({
    request: async (input) => {
      try { return await ipcRenderer.invoke(IPC_CHANNELS.request, input); }
      catch { throw new Error("Desktop service unavailable."); }
    },
    onEvent: (listener) => { ipcRenderer.on(IPC_CHANNELS.event, (_event, raw: unknown) => listener(raw)); },
  });
  return Object.freeze({ ...bridge, async savePublishedFile(sessionId, fileId) {
    const request = rpcRequestSchema.parse({ id: requestId(), method: "savePublishedFile", sessionId, fileId });
    const response = rpcResponseSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.request, request));
    if (response.id !== request.id || response.method !== "savePublishedFile") throw new Error("Invalid host response.");
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  } } satisfies ForgeBridge);
}

// Pairing control is a separate, validated channel: the renderer can only ask
// for status / start / stop and always gets a checked status object back.
export function createLanBridge() {
  return createForgeLanBridge({
    request: async (input) => {
      try { return await ipcRenderer.invoke(LAN_CHANNEL, input); }
      catch (error) {
        throw new Error(
          error instanceof Error && error.message
            ? error.message
            : "Desktop service unavailable.",
        );
      }
    },
  }, { canControl: true });
}

contextBridge.exposeInMainWorld("forge", createBridge());
contextBridge.exposeInMainWorld("forgeLan", createLanBridge());
