import { parentPort } from "node:worker_threads";
import { createHarness } from "../core/harness";
import { shutdownRequestSchema } from "./control";
import { createWorkerController } from "./controller";

export async function startWorker(): Promise<void> {
  const port = parentPort;
  if (!port) throw new Error("Worker requires a parent.");
  const controller = createWorkerController(await createHarness(), (message) =>
    port.postMessage(message),
  );
  let closing = false;
  port.on("message", (message: unknown) => {
    const shutdown = shutdownRequestSchema.safeParse(message);
    if (shutdown.success && !closing) {
      closing = true;
      void controller.dispose().then(
        () => {
          port.postMessage({
            control: "shutdownAck",
            id: shutdown.data.id,
            clean: true,
          });
          port.close();
        },
        () => {
          port.postMessage({
            control: "shutdownAck",
            id: shutdown.data.id,
            clean: false,
          });
          port.close();
        },
      );
    } else if (!closing) void controller.handle(message);
  });
  // Parent must use acknowledged shutdown; port destruction is not a cleanup protocol.
  port.postMessage({ kind: "ready" });
}
void startWorker().catch(() => {
  process.exitCode = 1;
  parentPort?.close();
});
