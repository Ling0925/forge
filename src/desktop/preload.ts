import { contextBridge, ipcRenderer } from "electron";
import { createTransportBridge } from "../shared/bridge";
import { IPC_CHANNELS, type ForgeBridge } from "../shared/ipc";
import { createForgeLanBridge, LAN_CHANNEL } from "../shared/lan";

export function createBridge(): ForgeBridge {
  return createTransportBridge({
    request: async (input) => {
      try { return await ipcRenderer.invoke(IPC_CHANNELS.request, input); }
      catch { throw new Error("Desktop service unavailable."); }
    },
    onEvent: (listener) => { ipcRenderer.on(IPC_CHANNELS.event, (_event, raw: unknown) => listener(raw)); },
  });
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
