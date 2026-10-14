import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createWorkerController } from "../../src/desktop/controller";
import {
  createReadyGate,
  createShutdownController,
} from "../../src/desktop/lifecycle";
import type { HarnessService } from "../../src/shared/contracts";
import { ForgeError } from "../../src/shared/errors";
import type { RunId, WorkerMessage } from "../../src/shared/ipc";
import {
  type SessionSnapshot,
  defaultPublicSettings,
  parseSessionId,
} from "../../src/shared/schemas";
import { extendedService } from "../cli/service-fixture";

const sessionId = parseSessionId(randomUUID());
const snapshot: SessionSnapshot = {
  version: 1,
  id: sessionId,
  title: "Test",
  workspace: "/tmp",
  model: "test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: "completed",
  messages: [],
  events: [],
  changes: [],
};
function service(overrides: Partial<HarnessService> = {}): HarnessService {
  return {
    ...extendedService(),
    getSettings: async () => defaultPublicSettings,
    updateSettings: async () => defaultPublicSettings,
    listModels: async () => [],
    listSessions: async () => [],
    createSession: async () => snapshot,
    getSession: async () => snapshot,
    run: async () => snapshot,
    compactSession: async () => snapshot,
    cancelSession: async () => false,
    forkSession: async () => snapshot,
    renameSession: async () => snapshot,
    archiveSession: async () => snapshot,
    getDiagnostics: async () => ({
      transcriptChars: 0,
      projectedChars: 0,
      messageCount: 0,
      summaryFallback: false,
    }),
    dispose: async () => undefined,
    ...overrides,
  };
}
function handle(messages: WorkerMessage[]): RunId {
  const first = messages[0];
  if (
    first?.kind !== "response" ||
    !first.response.ok ||
    first.response.method !== "startRun"
  )
    throw new Error("missing handle");
  return first.response.result.runId;
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("worker controller", () => {
  it("dispatches context projection, MCP and checkpoint routes with validated replies", async () => {
    const checkpointId = randomUUID();
    const calls: string[] = [];
    const messages: WorkerMessage[] = [];
    const controller = createWorkerController(
      service({
        getProjectContext: async () => ({
          workspace: "/tmp",
          instructionSources: [
            {
              path: "AGENTS.md",
              order: 0,
              bytes: 8,
              body: "private instructions",
            },
          ],
          skills: [
            {
              id: "skill",
              name: "Skill",
              description: "Description",
              version: null,
              sourceDirectory: "/tmp/skill",
              provenance: "user",
            },
          ],
          warnings: [],
          counts: { instructions: 1, skills: 1, warnings: 0 },
        }),
        registerMcpServer: async (input) => {
          calls.push("register");
          expect(input).toMatchObject({
            id: "server",
            label: "Server",
            command: "node",
            args: [],
          });
          return {
            id: "server",
            label: "Server",
            command: "node",
            args: [],
            enabled: true,
            requestTimeoutMs: 15000,
            envNameCount: 0,
            hasPrivateEnv: false,
          };
        },
        setMcpEnabled: async (id, enabled) => {
          calls.push(`enable:${id}:${enabled}`);
          return {
            id,
            label: id,
            command: "node",
            args: [],
            enabled,
            requestTimeoutMs: 15000,
            envNameCount: 0,
            hasPrivateEnv: false,
          };
        },
        getMcpHealth: async (id) => {
          calls.push("health");
          return {
            id,
            enabled: true,
            connected: false,
            negotiatedProtocolVersion: undefined,
            lastError: undefined,
          };
        },
        listCheckpoints: async () => {
          calls.push("list");
          return [
            {
              id: checkpointId,
              sessionId,
              toolCallId: "call",
              path: "file.ts",
              kind: "modified",
              state: "completed",
              beforeHash: null,
              beforeMode: null,
              afterHash: "a".repeat(64),
              createdAt: new Date().toISOString(),
            },
          ];
        },
        getCheckpointDiff: async (id, checkpoint) => {
          expect(id).toBe(sessionId);
          expect(checkpoint).toBe(checkpointId);
          calls.push("diff");
          return "diff";
        },
        restoreCheckpoint: async (id, checkpoint) => {
          expect(id).toBe(sessionId);
          expect(checkpoint).toBe(checkpointId);
          calls.push("restore");
          return snapshot;
        },
      }),
      (message) => messages.push(message),
    );
    const requests = [
      { method: "getProjectContext", sessionId },
      {
        method: "registerMcpServer",
        input: { id: "server", label: "Server", command: "node", args: [] },
      },
      { method: "setMcpEnabled", serverId: "server", enabled: false },
      { method: "getMcpHealth", serverId: "server" },
      { method: "listCheckpoints", sessionId },
      { method: "getCheckpointDiff", sessionId, checkpointId },
      { method: "restoreCheckpoint", sessionId, checkpointId },
    ];
    for (const request of requests)
      await controller.handle({ id: randomUUID(), ...request });
    const responses = messages.filter((message) => message.kind === "response");
    expect(responses).toHaveLength(requests.length);
    expect(responses.every((message) => message.response.ok)).toBe(true);
    expect(JSON.stringify(responses[0])).not.toContain("private instructions");
    expect(responses[0]).toMatchObject({
      response: { result: { skills: [{ name: "Skill" }] } },
    });
    expect(responses[3]).toMatchObject({
      response: {
        result: { negotiatedProtocolVersion: null, lastError: null },
      },
    });
    expect(responses[5]).toMatchObject({ response: { result: "diff" } });
    expect(calls).toEqual([
      "register",
      "enable:server:false",
      "health",
      "list",
      "diff",
      "restore",
    ]);
    await controller.dispose();
  });

  it("binds child approval to root run UUID without forwarding child events", async () => {
    const messages: WorkerMessage[] = [];
    const childSessionId = parseSessionId(randomUUID());
    const approval = {
      id: randomUUID(),
      sessionId,
      childSessionId,
      toolCallId: "child-call",
      toolName: "run_command",
      description: "Child command",
      command: ["true"],
    };
    let approved: boolean | undefined;
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controller = createWorkerController(
      service({
        run: async (input, emit, approve, signal) => {
          expect(input.mode).toBe("plan");
          emit({
            type: "approval_requested",
            sessionId,
            timestamp: new Date().toISOString(),
            request: approval,
          });
          emit({
            type: "agent_update",
            sessionId,
            childSessionId,
            timestamp: new Date().toISOString(),
            status: "running",
            model: "test",
            summary: "working",
          });
          started();
          approved = await approve(approval, signal);
          return snapshot;
        },
      }),
      (message) => messages.push(message),
    );
    await controller.handle({
      id: randomUUID(),
      method: "startRun",
      input: { sessionId, prompt: "plan", mode: "plan" },
    });
    await ready;
    const runId = handle(messages);
    expect(messages).toContainEqual(
      expect.objectContaining({
        kind: "event",
        data: expect.objectContaining({
          event: expect.objectContaining({
            type: "approval_requested",
            request: expect.objectContaining({ childSessionId }),
          }),
        }),
      }),
    );
    await controller.handle({
      id: randomUUID(),
      method: "answerApproval",
      runId,
      approvalId: approval.id,
      approved: true,
    });
    await tick();
    expect(approved).toBe(true);
    await controller.dispose();
  });

  it("routes cancelSession ownership result without claiming cross-process cancellation", async () => {
    const messages: WorkerMessage[] = [];
    const calls: string[] = [];
    const controller = createWorkerController(
      service({
        cancelSession: async (id) => {
          calls.push(id);
          return calls.length === 1;
        },
      }),
      (message) => messages.push(message),
    );
    for (let n = 0; n < 2; n++)
      await controller.handle({
        id: randomUUID(),
        method: "cancelSession",
        sessionId,
      });
    expect(messages).toMatchObject([
      {
        kind: "response",
        response: { method: "cancelSession", ok: true, result: true },
      },
      {
        kind: "response",
        response: { method: "cancelSession", ok: true, result: false },
      },
    ]);
    expect(calls).toEqual([sessionId, sessionId]);
    await controller.dispose();
  });

  it("buffers the exact event-before-approve race, denies repeated replies", async () => {
    let release = (): void => {};
    const checkpoint = new Promise<void>((resolve) => {
      release = resolve;
    });
    const approval = {
      id: randomUUID(),
      sessionId,
      toolCallId: "call",
      toolName: "run_command",
      description: "Run command",
      command: ["true"],
    };
    let approved: boolean | undefined;
    const messages: WorkerMessage[] = [];
    const controller = createWorkerController(
      service({
        run: async (_input, emit, approve, signal) => {
          emit({
            type: "approval_requested",
            sessionId,
            timestamp: new Date().toISOString(),
            request: approval,
          });
          await checkpoint;
          approved = await approve(approval, signal);
          return snapshot;
        },
      }),
      (message) => messages.push(message),
    );
    await controller.handle({
      id: randomUUID(),
      method: "startRun",
      input: { sessionId, prompt: "go" },
    });
    const runId = handle(messages);
    expect(messages[1]?.kind).toBe("event");
    await controller.handle({
      id: randomUUID(),
      method: "answerApproval",
      runId,
      approvalId: approval.id,
      approved: true,
    });
    expect(messages.at(-1)).toMatchObject({
      kind: "response",
      response: { ok: true },
    });
    await controller.handle({
      id: randomUUID(),
      method: "answerApproval",
      runId,
      approvalId: approval.id,
      approved: true,
    });
    expect(messages.at(-1)).toMatchObject({
      kind: "response",
      response: { ok: false, error: { code: "not_found" } },
    });
    release();
    await tick();
    expect(approved).toBe(true);
    expect(messages.at(-1)).toMatchObject({
      kind: "event",
      data: { event: { type: "run_finished" } },
    });
    await controller.dispose();
  });

  it("never applies an early answer to a changed tool action", async () => {
    let release = (): void => {};
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const approval = {
      id: randomUUID(),
      sessionId,
      toolCallId: "original",
      toolName: "run_command",
      description: "Run",
    };
    const messages: WorkerMessage[] = [];
    const controller = createWorkerController(
      service({
        run: async (_input, emit, approve, signal) => {
          emit({
            type: "approval_requested",
            sessionId,
            timestamp: new Date().toISOString(),
            request: approval,
          });
          await pause;
          await approve({ ...approval, toolCallId: "different" }, signal);
          throw new Error("must not execute");
        },
      }),
      (message) => messages.push(message),
    );
    await controller.handle({
      id: randomUUID(),
      method: "startRun",
      input: { sessionId, prompt: "go" },
    });
    await controller.handle({
      id: randomUUID(),
      method: "answerApproval",
      runId: handle(messages),
      approvalId: approval.id,
      approved: true,
    });
    release();
    await tick();
    expect(messages).toContainEqual(
      expect.objectContaining({
        kind: "event",
        data: expect.objectContaining({
          event: expect.objectContaining({
            type: "error",
            error: expect.objectContaining({ code: "invalid_input" }),
          }),
        }),
      }),
    );
    await controller.dispose();
  });

  it("cancels a pending approval and refuses late replies", async () => {
    const messages: WorkerMessage[] = [];
    let approved: boolean | undefined;
    const approval = {
      id: randomUUID(),
      sessionId,
      toolCallId: "call",
      toolName: "run_command",
      description: "Run",
    };
    const controller = createWorkerController(
      service({
        run: async (_input, emit, approve, signal) => {
          emit({
            type: "approval_requested",
            sessionId,
            timestamp: new Date().toISOString(),
            request: approval,
          });
          approved = await approve(approval, signal);
          return snapshot;
        },
      }),
      (message) => messages.push(message),
    );
    await controller.handle({
      id: randomUUID(),
      method: "startRun",
      input: { sessionId, prompt: "go" },
    });
    const runId = handle(messages);
    await controller.handle({ id: randomUUID(), method: "cancelRun", runId });
    await tick();
    expect(approved).toBe(false);
    expect(messages).toContainEqual(
      expect.objectContaining({
        kind: "event",
        data: expect.objectContaining({
          event: expect.objectContaining({
            type: "run_finished",
            status: "cancelled",
          }),
        }),
      }),
    );
    await controller.handle({
      id: randomUUID(),
      method: "answerApproval",
      runId,
      approvalId: approval.id,
      approved: true,
    });
    expect(messages.at(-1)).toMatchObject({ response: { ok: false } });
    await controller.dispose();
  });

  it("preserves safe domain failures but never unknown exception text", async () => {
    for (const error of [
      new ForgeError("provider", "Provider rate limit reached.", true),
      new Error("secret raw body"),
    ]) {
      const messages: WorkerMessage[] = [];
      const controller = createWorkerController(
        service({
          listModels: async () => {
            throw error;
          },
          run: async () => {
            throw error;
          },
        }),
        (message) => messages.push(message),
      );
      await controller.handle({ id: randomUUID(), method: "listModels" });
      expect(messages[0]).toMatchObject({
        response: {
          error: {
            code: error instanceof ForgeError ? "provider" : "internal",
          },
        },
      });
      await controller.handle({
        id: randomUUID(),
        method: "startRun",
        input: { sessionId, prompt: "go" },
      });
      await tick();
      expect(JSON.stringify(messages)).not.toContain("secret raw body");
      expect(messages.at(-1)).toMatchObject({
        data: { event: { type: "run_finished", status: "failed" } },
      });
      await controller.dispose();
    }
  });

  it("awaits actual owned subprocess death before shutdown acknowledgement", async () => {
    const messages: WorkerMessage[] = [];
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { detached: true, stdio: "ignore" },
    );
    await once(child, "spawn");
    const pid = child.pid;
    if (!pid) throw new Error("missing pid");
    const death = once(child, "exit");
    const controller = createWorkerController(
      service({
        run: async (_input, _emit, _approve, signal) => {
          signal.addEventListener(
            "abort",
            () => process.kill(-pid, "SIGTERM"),
            { once: true },
          );
          await death;
          return snapshot;
        },
        dispose: async () => {
          await death;
        },
      }),
      (message) => messages.push(message),
    );
    try {
      await controller.handle({
        id: randomUUID(),
        method: "startRun",
        input: { sessionId, prompt: "go" },
      });
      let controlId = "";
      let terminated = false;
      const shutdown = createShutdownController({
        send: (message) => {
          controlId = message.id;
          void controller.dispose().then(() =>
            shutdown.accept({
              control: "shutdownAck",
              id: controlId,
              clean: true,
            }),
          );
        },
        terminate: async () => {
          expect(() => process.kill(pid, 0)).toThrow();
          terminated = true;
        },
        report: () => {
          throw new Error("unexpected forced shutdown");
        },
      });
      expect(await shutdown.shutdown()).toBe(true);
      expect(terminated).toBe(true);
    } finally {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* Already dead. */
      }
    }
  });
});

it("bounds startup waiting and settles readiness/failure exactly once", async () => {
  const gate = createReadyGate(1000, 1);
  const waiting = gate.wait();
  expect(await gate.wait()).toBe(false);
  gate.ready();
  gate.fail();
  expect(await waiting).toBe(true);
  const failed = createReadyGate(5);
  expect(await failed.wait()).toBe(false);
});

it("reports exceptional unacknowledged shutdown rather than claiming clean", async () => {
  const reports: string[] = [];
  const shutdown = createShutdownController({
    send: () => undefined,
    terminate: async () => undefined,
    report: (message) => reports.push(message),
    timeoutMs: 5,
  });
  expect(await shutdown.shutdown()).toBe(false);
  expect(reports).toHaveLength(1);
});
