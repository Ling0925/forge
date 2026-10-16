import { contextBridge, ipcRenderer } from "electron";
import { createTransportBridge } from "../shared/bridge";
import { IPC_CHANNELS, type ForgeBridge } from "../shared/ipc";

export function createBridge(): ForgeBridge {
  return createTransportBridge({
    request: async (input) => {
      try { return await ipcRenderer.invoke(IPC_CHANNELS.request, input); }
      catch { throw new Error("Desktop service unavailable."); }
    },
    onEvent: (listener) => { ipcRenderer.on(IPC_CHANNELS.event, (_event, raw: unknown) => listener(raw)); },
  });
}
contextBridge.exposeInMainWorld("forge", createBridge());
