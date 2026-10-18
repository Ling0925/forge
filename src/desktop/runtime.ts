import type { HarnessService } from "../shared/contracts";
import type {
  RpcRequest,
  RpcResponse,
  RunEvent,
  WorkerMessage,
} from "../shared/ipc";
import { createWorkerController, safeError } from "./controller";

// A single request may legitimately cover a long provider turn; this is the
// transport bound, not a run bound. Timeouts are never retried automatically.
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * One controller/service for every host (desktop renderer IPC, LAN Web pages),
 * so a run started on a phone and a run started on the desktop share the same
 * approvals, steering and activity view.
 *
 * - `handle` accepts raw worker requests (desktop IPC forwarding).
 * - `request` is the in-process RPC path used by HTTP hosts. Its responses are
 *   consumed by the hub and are NOT broadcast to subscribers, so the desktop
 *   process never sees a response it has no pending entry for.
 * - `subscribe` receives every controller message, including responses that
 *   belong to `handle` calls (the worker forwards them to its parent).
 */
export interface DesktopRuntime {
  handle(raw: unknown): Promise<void>;
  request(request: RpcRequest): Promise<RpcResponse>;
  subscribe(listener: (message: WorkerMessage) => void): () => void;
  recoveryEvents(): RunEvent[];
  dispose(): Promise<void>;
}

export function createRuntimeHub(service: HarnessService): DesktopRuntime {
  const listeners = new Set<(message: WorkerMessage) => void>();
  const pending = new Map<
    string,
    {
      request: RpcRequest;
      resolve: (response: RpcResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let disposed = false;
  let closing: Promise<void> | undefined;
  const publish = (message: WorkerMessage): void => {
    for (const listener of [...listeners]) {
      try {
        listener(message);
      } catch {
        // A broken subscriber (or a closed worker port) must not take down the
        // shared runtime that other hosts are still using.
      }
    }
  };
  const controller = createWorkerController(service, (message) => {
    if (message.kind === "response") {
      const entry = pending.get(message.response.id);
      if (entry) {
        pending.delete(message.response.id);
        clearTimeout(entry.timer);
        entry.resolve(message.response);
        return;
      }
    }
    publish(message);
  });
  const request = (rpc: RpcRequest): Promise<RpcResponse> => {
    if (disposed)
      return Promise.reject(new Error("The shared runtime is closed."));
    if (pending.has(rpc.id))
      return Promise.reject(new Error("Duplicate runtime request id."));
    return new Promise<RpcResponse>((resolveResponse, reject) => {
      const timer = setTimeout(() => {
        pending.delete(rpc.id);
        reject(
          new Error(
            "The shared runtime did not answer in time; effects are uncertain. Do not retry automatically.",
          ),
        );
      }, REQUEST_TIMEOUT_MS);
      pending.set(rpc.id, {
        request: rpc,
        resolve: resolveResponse,
        timer,
      });
      void controller.handle(rpc).catch((error: unknown) => {
        const entry = pending.get(rpc.id);
        if (!entry) return;
        pending.delete(rpc.id);
        clearTimeout(timer);
        reject(
          error instanceof Error ? error : new Error("Runtime request failed."),
        );
      });
    });
  };
  const dispose = (): Promise<void> => {
    if (closing) return closing;
    disposed = true;
    // The controller answers its own in-flight requests with a safe error while
    // it tears down; any request that raced past that point is settled here.
    closing = controller.dispose().finally(() => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.resolve({
          id: entry.request.id,
          method: entry.request.method,
          ok: false,
          error: safeError,
        });
      }
      pending.clear();
      listeners.clear();
    });
    return closing;
  };
  return {
    handle: (raw) => controller.handle(raw),
    request,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recoveryEvents: () => controller.recoveryEvents(),
    dispose,
  };
}
