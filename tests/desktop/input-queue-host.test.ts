import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createHarness } from "../../src/core/harness";
import { createRuntimeHub } from "../../src/desktop/runtime";
import type {
  LocalToolRegistry,
  ModelProvider,
} from "../../src/shared/contracts";
import {
  type RpcRequest,
  type RunEvent,
  rpcRequestSchema,
} from "../../src/shared/ipc";
import { openSessionStore } from "../../src/store/sessions";

type Request = {
  [K in RpcRequest["method"]]: Omit<Extract<RpcRequest, { method: K }>, "id">;
}[RpcRequest["method"]];
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});
async function fixture(
  complete: ModelProvider["complete"],
  tools?: LocalToolRegistry,
) {
  const directory = await mkdtemp(join(tmpdir(), "forge-queued-host-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const service = await createHarness({
    stateDir: directory,
    providerFactory: () => ({ listModels: async () => ["fixture"], complete }),
    toolFactory: () =>
      tools ?? {
        definitions: [],
        execute: async () => ({ content: "ok", isError: false }),
        dispose: async () => {},
      },
  });
  await service.updateSettings({
    settings: { baseUrl: "https://fixture.invalid/v1", model: "fixture" },
  });
  const session = await service.createSession({
    workspace: directory,
    title: "No automatic title",
  });
  const runtime = createRuntimeHub(service);
  cleanup.push(() => runtime.dispose());
  const rpc = (input: Request) =>
    runtime.request(rpcRequestSchema.parse({ id: randomUUID(), ...input }));
  return { directory, service, session, runtime, rpc };
}

it("continues two accepted inputs after the submitting client disconnects, with a second client observing the same queue", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prompts: string[] = [];
  const models: string[] = [];
  const f = await fixture(async (messages, _tools, options) => {
    prompts.push(
      messages.findLast((message) => message.role === "user")?.content ?? "",
    );
    models.push(options.model);
    if (prompts.length === 1)
      await Promise.race([
        gate,
        new Promise<void>((resolve) => {
          if (options.signal.aborted) resolve();
          else
            options.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
        }),
      ]);
    return { message: { role: "assistant", content: "done" } };
  });
  const events: RunEvent[] = [];
  const clientA = f.runtime.subscribe(() => {});
  const clientB = f.runtime.subscribe((message) => {
    if (message.kind === "event") events.push(message.data);
  });
  const firstId = randomUUID();
  expect(
    (
      await f.rpc({
        method: "enqueueInput",
        input: {
          inputId: firstId,
          input: { sessionId: f.session.id, prompt: "first" },
        },
      })
    ).ok,
  ).toBe(true);
  await vi.waitFor(() => expect(prompts).toEqual(["first"]));
  const nextId = randomUUID();
  expect(
    (
      await f.rpc({
        method: "enqueueInput",
        input: {
          inputId: nextId,
          input: { sessionId: f.session.id, prompt: "second" },
        },
      })
    ).ok,
  ).toBe(true);
  clientA();
  await f.service.updateSettings({
    settings: { model: "changed-global-default" },
  });
  const observed = await f.rpc({
    method: "listInputs",
    sessionId: f.session.id,
  });
  expect(observed).toMatchObject({
    ok: true,
    result: {
      items: [
        { inputId: firstId, state: "bound" },
        { inputId: nextId, state: "queued" },
      ],
    },
  });
  release();
  await vi.waitFor(async () =>
    expect(
      await f.rpc({ method: "listInputs", sessionId: f.session.id }),
    ).toMatchObject({
      ok: true,
      result: { items: [{ state: "consumed" }, { state: "consumed" }] },
    }),
  );
  expect(prompts).toEqual(["first", "second"]);
  expect(models).toEqual(["fixture", "fixture"]);
  expect(
    new Set(
      events
        .filter((item) => item.event.type === "run_finished")
        .map((item) => item.runId),
    ).size,
  ).toBe(2);
  clientB();
});

it("pauses pending inputs after cancelling an ordinary run and resumes them without changing the running-task API", async () => {
  let started = false;
  const prompts: string[] = [];
  const f = await fixture(async (messages, _tools, options) => {
    const prompt =
      messages.findLast((message) => message.role === "user")?.content ?? "";
    prompts.push(prompt);
    if (prompt === "active") {
      started = true;
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) resolve();
        else
          options.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
      throw new Error("cancelled fixture");
    }
    return { message: { role: "assistant", content: "done" } };
  });
  const running = await f.rpc({
    method: "startRun",
    input: { sessionId: f.session.id, prompt: "active" },
  });
  if (!running.ok || running.method !== "startRun")
    throw new Error("Run failed to start");
  await vi.waitFor(() => expect(started).toBe(true));
  await f.rpc({
    method: "enqueueInput",
    input: {
      inputId: randomUUID(),
      input: { sessionId: f.session.id, prompt: "later" },
    },
  });
  await f.rpc({ method: "cancelRun", runId: running.result.runId });
  await vi.waitFor(async () =>
    expect(
      await f.rpc({ method: "listInputs", sessionId: f.session.id }),
    ).toMatchObject({ result: { paused: true, items: [{ state: "queued" }] } }),
  );
  expect(prompts).toEqual(["active"]);
  await f.rpc({ method: "resumeInputs", sessionId: f.session.id });
  await vi.waitFor(async () =>
    expect(
      await f.rpc({ method: "listInputs", sessionId: f.session.id }),
    ).toMatchObject({ result: { items: [{ state: "consumed" }] } }),
  );
  expect(prompts).toEqual(["active", "later"]);
});

it("pins the accepted permission ceiling and rejects changed provider bindings at the actual run boundary", async () => {
  const models: string[] = [];
  const f = await fixture(async (_messages, _tools, options) => {
    models.push(options.model);
    return { message: { role: "assistant", content: "done" } };
  });
  const store = await openSessionStore(f.directory);
  await store.save({ ...f.session, permissionCeiling: "readonly" });
  await f.rpc({ method: "pauseInputs", sessionId: f.session.id });
  const accepted = await f.rpc({
    method: "enqueueInput",
    input: {
      inputId: randomUUID(),
      input: {
        sessionId: f.session.id,
        prompt: "work",
        permission: "unrestricted",
      },
    },
  });
  expect(accepted).toMatchObject({
    ok: true,
    result: { selection: { permission: "readonly", model: "fixture" } },
  });
  await f.service.updateSettings({
    settings: { baseUrl: "https://different.invalid/v1" },
  });
  await f.rpc({ method: "resumeInputs", sessionId: f.session.id });
  await vi.waitFor(async () =>
    expect(
      await f.rpc({ method: "listInputs", sessionId: f.session.id }),
    ).toMatchObject({
      result: { paused: true, items: [{ state: "blocked" }] },
    }),
  );
  expect(models).toEqual([]);
  await expect(
    f.service.run(
      { sessionId: f.session.id, prompt: "bound", model: "fixture" },
      () => {},
      async () => false,
      new AbortController().signal,
      { drainSteering: () => [], providerBinding: "invalid-binding" },
    ),
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(models).toEqual([]);
});

it("requires a fresh tool approval for accepted inputs and accepts an answer from another client", async () => {
  let effect = false;
  const tools: LocalToolRegistry = {
    definitions: [
      {
        type: "function",
        function: {
          name: "fixture_effect",
          description: "Fixture approval",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    execute: async (_call, context) => {
      const approved = await context.approve(
        {
          id: randomUUID(),
          sessionId: context.sessionId,
          toolCallId: context.toolCallId,
          toolName: "fixture_effect",
          description: "Fixture effect",
        },
        context.signal,
      );
      effect = approved;
      return { content: approved ? "approved" : "denied", isError: !approved };
    },
    dispose: async () => {},
  };
  const f = await fixture(
    async (messages) => ({
      message: messages.some((message) => message.role === "tool")
        ? { role: "assistant", content: "done" }
        : {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "fixture-call",
                type: "function",
                function: { name: "fixture_effect", arguments: "{}" },
              },
            ],
          },
    }),
    tools,
  );
  const events: RunEvent[] = [];
  const clientB = f.runtime.subscribe((message) => {
    if (message.kind === "event") events.push(message.data);
  });
  expect(
    await f.rpc({
      method: "enqueueInput",
      input: {
        inputId: randomUUID(),
        input: {
          sessionId: f.session.id,
          prompt: "work",
          permission: "workspace",
        },
      },
    }),
  ).toMatchObject({ ok: true });
  await vi.waitFor(() =>
    expect(
      events.some((item) => item.event.type === "approval_requested"),
    ).toBe(true),
  );
  expect(effect).toBe(false);
  const pending = events.find(
    (item) => item.event.type === "approval_requested",
  );
  if (!pending || pending.event.type !== "approval_requested")
    throw new Error("Missing approval");
  expect(
    await f.rpc({
      method: "answerApproval",
      runId: pending.runId,
      approvalId: pending.event.request.id,
      approved: true,
    }),
  ).toMatchObject({ ok: true });
  await vi.waitFor(async () =>
    expect(
      await f.rpc({ method: "listInputs", sessionId: f.session.id }),
    ).toMatchObject({ result: { items: [{ state: "consumed" }] } }),
  );
  expect(effect).toBe(true);
  clientB();
});
