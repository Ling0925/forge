import { randomUUID } from "node:crypto";
import { shutdownAckSchema } from "./control";

/** Bounded startup gate. Every waiter settles once on readiness, failure or timeout. */
export function createReadyGate(timeoutMs = 30000, capacity = 128) {
  let state: "waiting" | "ready" | "failed" = "waiting";
  const waiters = new Set<(ready: boolean) => void>();
  const settle = (ready: boolean): void => {
    if (state !== "waiting") return;
    state = ready ? "ready" : "failed";
    clearTimeout(timer);
    for (const resolve of waiters) resolve(ready);
    waiters.clear();
  };
  const timer = setTimeout(() => settle(false), timeoutMs);
  return {
    ready: () => settle(true),
    fail: () => settle(false),
    wait: (): Promise<boolean> => {
      if (state !== "waiting") return Promise.resolve(state === "ready");
      if (waiters.size >= capacity) return Promise.resolve(false);
      return new Promise((resolve) => waiters.add(resolve));
    },
  };
}

/** Termination is allowed only after an acknowledgement or an observable emergency. */
export function createShutdownController(options: {
  send: (message: { control: "shutdown"; id: string }) => void;
  terminate: () => Promise<unknown>;
  report: (message: string) => void;
  timeoutMs?: number;
}) {
  let operation: Promise<boolean> | undefined;
  let acknowledge: ((clean: boolean) => void) | undefined;
  let id: string | undefined;
  return {
    accept(raw: unknown): boolean {
      const result = shutdownAckSchema.safeParse(raw);
      if (!result.success) return false;
      if (result.data.id === id) acknowledge?.(result.data.clean);
      return true;
    },
    shutdown(): Promise<boolean> {
      if (operation) return operation;
      id = randomUUID();
      operation = new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (clean: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!clean)
            options.report(
              "Forge shutdown was not acknowledged as clean; owned processes may require inspection.",
            );
          void options.terminate().then(
            () => resolve(clean),
            () => resolve(false),
          );
        };
        const timer = setTimeout(
          () => finish(false),
          options.timeoutMs ?? 30000,
        );
        acknowledge = finish;
        try {
          options.send({ control: "shutdown", id: id ?? randomUUID() });
        } catch {
          finish(false);
        }
      });
      return operation;
    },
  };
}
