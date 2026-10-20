import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import { z } from "zod";
import { createHarness } from "../core/harness";
import { createLocalHost } from "../host/local-server";
import {
  createLanHostController,
  shutdownSharedRuntime,
  startLanServer,
  validLanEndpoint,
} from "../web/lan";
import { shutdownRequestSchema } from "./control";
import { createRuntimeHub } from "./runtime";

const lanIpv4Schema = z
  .string()
  .max(15)
  .regex(
    /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
  )
  .refine((value) => value !== "0.0.0.0", "0.0.0.0 is not a concrete address");
const startLanSchema = z
  .object({
    control: z.literal("startLan"),
    id: z.string().uuid(),
    host: lanIpv4Schema,
    port: z.number().int().min(1024).max(65535),
    workspace: z.string().min(1).max(4096),
  })
  .strict();
const stopLanSchema = z
  .object({ control: z.literal("stopLan"), id: z.string().uuid() })
  .strict();

/**
 * The desktop worker owns exactly one controller/service. Every host — the
 * desktop IPC bridge and any LAN Web pages — goes through this hub, so a phone
 * and the desktop see the same runs, approvals and steering state.
 */
export async function startWorker(): Promise<void> {
  const port = parentPort;
  if (!port) throw new Error("Worker requires a parent.");
  // Packaged layout is dist/desktop/worker.cjs + dist/renderer.
  const rendererRoot = join(__dirname, "../renderer");
  const runtime = createRuntimeHub(await createHarness());
  let local: Awaited<ReturnType<typeof createLocalHost>> | undefined;
  try {
    if (process.env.FORGE_HOST_SOCKET) local = await createLocalHost({ runtime, socketPath: process.env.FORGE_HOST_SOCKET });
  } catch (error) { await runtime.dispose(); throw error; }
  const unsubscribe = runtime.subscribe((message) => port.postMessage(message));
  const lan = createLanHostController({
    report: (message) => console.error(message),
    start: async (input) => {
      if (!validLanEndpoint(input.host, input.port))
        throw new Error(
          "Use one concrete IPv4 address (not 0.0.0.0) and a port between 1024 and 65535.",
        );
      // Desktop hosting is intentionally multi-workspace: the same service
      // already governs many projects and pages may list them.
      return startLanServer({
        runtime,
        host: input.host,
        port: input.port,
        workspace: input.workspace,
        rendererRoot,
        restrictWorkspace: false,
      });
    },
  });
  let closing = false;
  /** Reports one LAN control outcome without acting after shutdown started. */
  const lanResult = (id: string, url: string | null, error?: string): void => {
    if (closing) return;
    port.postMessage(
      error === undefined
        ? { control: "lanResult", id, url }
        : { control: "lanResult", id, url: null, error },
    );
  };
  const describe = (error: unknown, fallback: string): string =>
    error instanceof Error && error.message ? error.message : fallback;
  port.on("message", (message: unknown) => {
    // After shutdown begins no start/stop request may create or tear down a
    // listener; the one in-flight dispose owns the resource.
    if (closing) return;
    const shutdown = shutdownRequestSchema.safeParse(message);
    if (shutdown.success) {
      closing = true;
      // Stop accepting pages first, then always release the one shared runtime.
      // A LAN close failure is reported as an unclean shutdown; it must never
      // skip runtime disposal or hide a socket that stayed open.
      void shutdownSharedRuntime({
        closeLan: async () => {
          const results = await Promise.allSettled([lan.dispose(), local?.close()]);
          const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
          if (errors.length) throw new AggregateError(errors.map(result => result.reason), "Host listeners did not close cleanly.");
        },
        disposeRuntime: () => runtime.dispose(),
        report: (message) => console.error(message),
      }).then((clean) => {
        unsubscribe();
        port.postMessage({
          control: "shutdownAck",
          id: shutdown.data.id,
          clean,
        });
        port.close();
      });
      return;
    }
    const start = startLanSchema.safeParse(message);
    if (start.success) {
      const { id, host, port: number, workspace } = start.data;
      void lan.start({ host, port: number, workspace }).then(
        (url) => lanResult(id, url),
        (error: unknown) =>
          lanResult(
            id,
            null,
            describe(error, "The LAN host could not be started."),
          ),
      );
      return;
    }
    const stop = stopLanSchema.safeParse(message);
    if (stop.success) {
      const { id } = stop.data;
      void lan.stop().then(
        () => lanResult(id, null),
        (error: unknown) =>
          lanResult(
            id,
            null,
            describe(error, "The LAN host could not be stopped."),
          ),
      );
      return;
    }
    void runtime.handle(message);
  });
  // Parent must use acknowledged shutdown; port destruction is not a cleanup protocol.
  port.postMessage({ kind: "ready" });
}
void startWorker().catch(() => {
  process.exitCode = 1;
  parentPort?.close();
});
