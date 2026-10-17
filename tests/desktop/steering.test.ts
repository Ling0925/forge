import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHarness } from "../../src/core/harness";
import { createWorkerController } from "../../src/desktop/controller";
import type { HarnessService } from "../../src/shared/contracts";
import { createTransportBridge } from "../../src/shared/bridge";
import type { RunEvent } from "../../src/shared/ipc";

let directory = "";
let service: HarnessService;
let releaseModel = () => {};
let entered = 0;
beforeEach(async () => {
  for (const name of ["FORGE_BASE_URL", "FORGE_API_KEY", "FORGE_MODEL"])
    vi.stubEnv(name, undefined);
  directory = await mkdtemp(join(tmpdir(), "forge-worker-steering-"));
  entered = 0;
  const gate = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  service = await createHarness({
    stateDir: directory,
    providerFactory: () => ({
      listModels: async () => [],
      complete: async () => {
        entered++;
        if (entered === 1) await gate;
        return { message: { role: "assistant", content: "answer" } };
      },
    }),
    toolFactory: () => ({
      definitions: [],
      execute: async () => ({ content: "unused", isError: true }),
      dispose: async () => {},
    }),
  });
  await service.updateSettings({
    settings: { baseUrl: "https://fixture.invalid/v1", model: "fixture" },
  });
});
afterEach(async () => {
  releaseModel();
  await service?.dispose();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

function connect(owned = service) {
  const replies = new Map<string, (value: unknown) => void>();
  let listener: (event: RunEvent) => void = () => {};
  const events: RunEvent[] = [];
  const controller = createWorkerController(owned, (message) => {
    if (message.kind === "response") {
      replies.get(message.response.id)?.(message.response);
      replies.delete(message.response.id);
    } else if (message.kind === "event") {
      events.push(message.data);
      listener(message.data);
    }
  });
  const bridge = createTransportBridge({
    request: (input) =>
      new Promise((resolve) => {
        replies.set(input.id, resolve);
        void controller.handle(input);
      }),
    onEvent: (callback) => {
      listener = callback;
    },
  });
  return { controller, bridge, events };
}

it("acknowledges steering only after durable consumption and rejects a finished handle", async () => {
  const session = await service.createSession({
    workspace: directory,
    title: "manual",
  });
  const { controller, bridge, events } = connect();
  try {
    const run = await bridge.startRun({
      sessionId: session.id,
      prompt: "initial",
    });
    await vi.waitFor(() => expect(entered).toBe(1));
    let acknowledged = false;
    const steering = bridge.steerRun(run.runId, "change direction").then(() => {
      acknowledged = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(acknowledged).toBe(false);
    releaseModel();
    await steering;
    expect(
      (await service.getSession(session.id)).messages.some(
        (message) =>
          message.role === "user" && message.content === "change direction",
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(events.some((event) => event.event.type === "run_finished")).toBe(
        true,
      ),
    );
    expect(entered).toBe(2);
    await expect(bridge.steerRun(run.runId, "too late")).rejects.toThrow();
  } finally {
    await controller.dispose();
  }
});

it("rejects unconsumed input on cancellation without inserting or replaying it", async () => {
  const session = await service.createSession({
    workspace: directory,
    title: "manual",
  });
  const { controller, bridge, events } = connect();
  try {
    const run = await bridge.startRun({
      sessionId: session.id,
      prompt: "initial",
    });
    await vi.waitFor(() => expect(entered).toBe(1));
    const pending = expect(
      bridge.steerRun(run.runId, "retain this draft"),
    ).rejects.toThrow("草稿已保留");
    await bridge.cancelRun(run.runId);
    await pending;
    await vi.waitFor(() =>
      expect(
        events.some(
          (event) =>
            event.event.type === "run_finished" &&
            event.event.status === "cancelled",
        ),
      ).toBe(true),
    );
    expect(
      (await service.getSession(session.id)).messages.some(
        (message) => message.content === "retain this draft",
      ),
    ).toBe(false);
    expect(entered).toBe(1);
  } finally {
    await controller.dispose();
  }
});

it("closes steering before cleanup and emits terminal state only after the service releases", async () => {
  const session = await service.createSession({
    workspace: directory,
    title: "manual",
  });
  let cleanup = () => {};
  let waiting = false;
  const cleanupGate = new Promise<void>((resolve) => {
    cleanup = resolve;
  });
  const { controller, bridge, events } = connect({
    ...service,
    run: async (...args) => {
      const result = await service.run(...args);
      waiting = true;
      await cleanupGate;
      return result;
    },
  });
  try {
    const run = await bridge.startRun({
      sessionId: session.id,
      prompt: "initial",
    });
    await vi.waitFor(() => expect(entered).toBe(1));
    releaseModel();
    await vi.waitFor(() => expect(waiting).toBe(true));
    expect(events.some((event) => event.event.type === "run_finished")).toBe(
      false,
    );
    await expect(
      bridge.steerRun(run.runId, "during cleanup"),
    ).rejects.toThrow();
    cleanup();
    await vi.waitFor(() =>
      expect(events.some((event) => event.event.type === "run_finished")).toBe(
        true,
      ),
    );
    await bridge.startRun({ sessionId: session.id, prompt: "next" });
    await vi.waitFor(() => expect(entered).toBe(2));
  } finally {
    cleanup();
    await controller.dispose();
  }
});
