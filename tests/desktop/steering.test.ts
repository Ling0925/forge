import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHarness } from "../../src/core/harness";
import { createWorkerController } from "../../src/desktop/controller";
import type { HarnessService } from "../../src/shared/contracts";
import { createTransportBridge } from "../../src/shared/bridge";
import type { RunEvent } from "../../src/shared/ipc";
import type { Message } from "../../src/shared/schemas";
import { image } from "../fixtures/image";

let directory = "";
let service: HarnessService;
let releaseModel = () => {};
let releaseTool = () => {};
let useTool = false;
let toolEntered = false;
let entered = 0;
let requests: (readonly Message[])[] = [];
beforeEach(async () => {
  for (const name of ["FORGE_BASE_URL", "FORGE_API_KEY", "FORGE_MODEL"])
    vi.stubEnv(name, undefined);
  directory = await mkdtemp(join(tmpdir(), "forge-worker-steering-"));
  entered = 0;
  requests = [];
  useTool = false;
  toolEntered = false;
  const toolGate = new Promise<void>(resolve => { releaseTool = resolve; });
  const gate = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  service = await createHarness({
    stateDir: directory,
    providerFactory: () => ({
      listModels: async () => [],
      complete: async (messages) => {
        requests.push(structuredClone(messages));
        entered++;
        if (entered === 1) {
          await gate;
          if (useTool) return { message: { role: "assistant", content: null, tool_calls: [
            { id: "fixture-call", type: "function", function: { name: "fixture_tool", arguments: "{}" } },
          ] } };
        }
        return { message: { role: "assistant", content: "answer" } };
      },
    }),
    toolFactory: () => ({
      definitions: [{ type: "function", function: { name: "fixture_tool", description: "fixture", parameters: { type: "object", properties: {} } } }],
      execute: async () => { toolEntered = true; await toolGate; return { content: "done", isError: false }; },
      dispose: async () => {},
    }),
  });
  await service.updateSettings({
    settings: { baseUrl: "https://fixture.invalid/v1", model: "fixture" },
  });
});
afterEach(async () => {
  releaseTool();
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

it("delivers image-only steering through the shared bridge and controller after durable save", async () => {
  const session = await service.createSession({ workspace: directory, title: "manual" });
  const { controller, bridge } = connect();
  try {
    const run = await bridge.startRun({ sessionId: session.id, prompt: "initial" });
    await vi.waitFor(() => expect(entered).toBe(1));
    await bridge.steerRun(run.runId, "", [image]);
    expect(entered).toBe(1);
    expect((await bridge.getSession(session.id)).pendingSteering).toContainEqual({ role: "user", content: "", images: [image] });
    releaseModel();
    await vi.waitFor(() => expect(entered).toBe(2));
    expect(requests[1]).toContainEqual({ role: "user", content: "", images: [image] });
  } finally { await controller.dispose(); }
});

it("acknowledges durable steering while the model is blocked and includes FIFO messages exactly once next request", async () => {
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
    await Promise.all([
      bridge.steerRun(run.runId, "change direction"),
      bridge.steerRun(run.runId, "and keep this constraint"),
    ]);
    expect(entered).toBe(1);
    expect(requests[0]?.filter(message => message.role === "user").map(message => message.content)).toEqual(["initial"]);
    expect(
      (await service.getSession(session.id)).pendingSteering?.some(
        (message) =>
          message.role === "user" && message.content === "change direction",
      ),
    ).toBe(true);
    releaseModel();
    await vi.waitFor(() =>
      expect(events.some((event) => event.event.type === "run_finished")).toBe(
        true,
      ),
    );
    expect(entered).toBe(2);
    expect(requests[1]?.filter(message => message.role === "user").map(message => message.content)).toEqual([
      "initial", "change direction", "and keep this constraint",
    ]);
    const saved = await bridge.getSession(session.id);
    expect(saved.messages.filter(message => message.role === "user").map(message => message.content)).toEqual([
      "initial", "change direction", "and keep this constraint",
    ]);
    await expect(bridge.steerRun(run.runId, "too late")).rejects.toThrow();
  } finally {
    await controller.dispose();
  }
});

it("retains acknowledged steering in history on cancellation without starting another request", async () => {
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
    await bridge.steerRun(run.runId, "retain this message");
    await bridge.cancelRun(run.runId);
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
        (message) => message.content === "retain this message",
      ),
    ).toBe(true);
    expect(entered).toBe(1);
  } finally {
    await controller.dispose();
  }
});

it("persists through the real journal during a blocked local tool without breaking its exchange", async () => {
  useTool = true;
  const session = await service.createSession({ workspace: directory, title: "manual" });
  const { controller, bridge, events } = connect();
  try {
    const run = await bridge.startRun({ sessionId: session.id, prompt: "initial", permission: "unrestricted" });
    releaseModel();
    await vi.waitFor(() => expect(toolEntered).toBe(true));
    await bridge.steerRun(run.runId, "while local tool runs");
    const saved = await bridge.getSession(session.id);
    expect(saved.pendingSteering).toEqual([{ role: "user", content: "while local tool runs" }]);
    expect(saved.messages.at(-1)?.role).toBe("assistant");
    expect(entered).toBe(1);
    releaseTool();
    await vi.waitFor(() => expect(events.some(event => event.event.type === "run_finished")).toBe(true));
    expect(requests[1]?.slice(-3).map(message => message.role)).toEqual(["assistant", "tool", "user"]);
    expect(requests[1]?.at(-1)?.content).toBe("while local tool runs");
    const finished = await bridge.getSession(session.id);
    expect(finished.status).toBe("completed");
    expect(finished.pendingSteering).toBeUndefined();
    expect(finished.messages.filter(message => message.content === "while local tool runs")).toHaveLength(1);
  } finally { releaseTool(); releaseModel(); await controller.dispose(); }
});

it("persists steering received during startup as soon as the run writer binds", async () => {
  const session = await service.createSession({ workspace: directory, title: "manual" });
  let start = () => {};
  const startup = new Promise<void>(resolve => { start = resolve; });
  const { controller, bridge } = connect({
    ...service,
    run: async (...args) => { await startup; return service.run(...args); },
  });
  try {
    const run = await bridge.startRun({ sessionId: session.id, prompt: "initial" });
    const sent = bridge.steerRun(run.runId, "early input");
    start();
    await sent;
    const saved = await bridge.getSession(session.id);
    expect([...saved.messages, ...(saved.pendingSteering ?? [])]).toContainEqual({ role: "user", content: "early input" });
    await vi.waitFor(() => expect(entered).toBe(1));
    expect(requests[0]?.filter(message => message.role === "user").map(message => message.content)).toEqual(["initial", "early input"]);
  } finally { start(); releaseModel(); await controller.dispose(); }
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
