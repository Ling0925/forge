import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createHarness } from "../../src/core/harness";
import { createRuntimeHub } from "../../src/desktop/runtime";
import type { HarnessService } from "../../src/shared/contracts";
import type { SessionSnapshot } from "../../src/shared/schemas";
import { openSessionStore } from "../../src/store/sessions";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forge-queue-recovery-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const prompts: string[] = [];
  let factories = 0;
  let effects = 0;
  const open = async () => {
    const service = await createHarness({
      stateDir: directory,
      providerFactory: () => {
        factories++;
        return {
          listModels: async () => ["fixture"],
          complete: async (messages) => {
            prompts.push(
              messages.findLast((message) => message.role === "user")
                ?.content ?? "",
            );
            return { message: { role: "assistant", content: "done" } };
          },
        };
      },
      toolFactory: () => ({
        definitions: [],
        execute: async () => {
          effects++;
          return { content: "effect", isError: false };
        },
        dispose: async () => {},
      }),
    });
    cleanup.push(() => service.dispose());
    return service;
  };
  const service = await open();
  await service.updateSettings({
    settings: { baseUrl: "https://fixture.invalid/v1", model: "fixture" },
  });
  const session = await service.createSession({
    workspace: directory,
    title: "Fixture, no auto title",
  });
  const store = await openSessionStore(directory);
  const queue = (s: HarnessService) => {
    if (!s.inputQueue) throw new Error("Missing queue");
    return s.inputQueue;
  };
  const attach = (s: HarnessService) => {
    const runtime = createRuntimeHub(s);
    cleanup.push(() => runtime.dispose());
    return runtime;
  };
  const enqueue = (s: HarnessService) =>
    queue(s).enqueue({
      inputId: randomUUID(),
      input: { sessionId: session.id, prompt: "B" },
    });
  const consumed = (s: HarnessService) =>
    vi.waitFor(async () =>
      expect((await queue(s).list(session.id)).items).toMatchObject([
        { state: "consumed", outcome: "completed" },
      ]),
    );
  return {
    directory,
    service,
    session,
    store,
    queue,
    open,
    attach,
    enqueue,
    consumed,
    prompts,
    factories: () => factories,
    effects: () => effects,
  };
}

it.each([
  "running",
  "awaiting_approval",
  "pendingTool",
  "failed",
  "cancelled",
  "interrupted",
] as const)(
  "pauses a queued continuation after an ordinary predecessor is left %s, resumes only once",
  async (status) => {
    const f = await fixture();
    const call = {
      id: "uncertain-a",
      type: "function" as const,
      function: { name: "inspect", arguments: "{}" },
    };
    const active: SessionSnapshot = {
      ...f.session,
      status: "running",
      messages: [{ role: "user", content: "A" }],
    };
    await f.store.save(active);
    const accepted = await f.enqueue(f.service);
    const crashed: SessionSnapshot =
      status === "pendingTool"
        ? {
            ...active,
            pendingTool: call,
            messages: [
              ...active.messages,
              { role: "assistant", content: null, tool_calls: [call] },
            ],
          }
        : { ...active, status };
    await f.store.save(crashed);
    await f.service.dispose();
    const recovered = await f.open();
    f.attach(recovered);
    await vi.waitFor(async () =>
      expect(await f.queue(recovered).list(f.session.id)).toMatchObject({
        paused: true,
        items: [{ inputId: accepted.inputId, state: "queued", runId: null }],
      }),
    );
    expect(f.factories()).toBe(0);
    expect(f.prompts).toEqual([]);
    await f.queue(recovered).resume(f.session.id);
    await f.consumed(recovered);
    expect(f.prompts).toEqual(["B"]);
    expect(f.effects()).toBe(0);
    expect(
      (await recovered.getSession(f.session.id)).messages.filter(
        (m) => m.role === "user" && m.content === "A",
      ),
    ).toHaveLength(1);
  },
);

it("retains a reviewed predecessor across unrelated metadata edits without exposing its marker", async () => {
  const f = await fixture();
  await f.store.save({ ...f.session, status: "running" });
  await f.enqueue(f.service);
  await f.queue(f.service).pause(f.session.id);
  await f.queue(f.service).resume(f.session.id);
  await f.store.save({
    ...(await f.store.get(f.session.id)),
    title: "renamed after review",
  });
  const view = await f.queue(f.service).list(f.session.id);
  expect(JSON.stringify(view)).not.toContain("acknowledgedPredecessor");
  expect(
    JSON.parse(
      await readFile(join(f.directory, "input-queue/queue.json"), "utf8"),
    ).items[0].acknowledgedPredecessor,
  ).toHaveLength(64);
  f.attach(f.service);
  await f.consumed(f.service);
  expect(f.prompts).toEqual(["B"]);
});

it("does not acknowledge a predecessor while another process owns its session lock", async () => {
  const f = await fixture();
  await f.store.save({ ...f.session, status: "running" });
  await f.enqueue(f.service);
  await f.queue(f.service).pause(f.session.id);
  const release = await f.store.acquire(f.session.id);
  try {
    await expect(f.queue(f.service).resume(f.session.id)).rejects.toMatchObject(
      { code: "busy" },
    );
  } finally {
    await release();
  }
  expect(await f.queue(f.service).list(f.session.id)).toMatchObject({
    paused: true,
    items: [{ state: "queued" }],
  });
  expect(f.factories()).toBe(0);
});

it("rechecks admission under the execution lock and preserves a bound input when the predecessor changes", async () => {
  const f = await fixture();
  await f.enqueue(f.service);
  const run = f.service.run.bind(f.service);
  let race = true;
  const service: HarnessService = {
    ...f.service,
    run: async (...args) => {
      if (race) {
        race = false;
        await f.store.save({ ...f.session, status: "failed" });
      }
      return run(...args);
    },
  };
  f.attach(service);
  await vi.waitFor(async () =>
    expect(await f.queue(service).list(f.session.id)).toMatchObject({
      paused: true,
      items: [{ state: "blocked", runId: null, input: { prompt: "B" } }],
    }),
  );
  expect(f.factories()).toBe(0);
  expect(f.effects()).toBe(0);
  await f.queue(service).resume(f.session.id);
  await f.consumed(service);
  expect(f.prompts).toEqual(["B"]);
});

it("allows a new explicit input after an old terminal failure instead of permanently banning the session", async () => {
  const f = await fixture();
  await f.store.save({ ...f.session, status: "failed" });
  await f.enqueue(f.service);
  f.attach(f.service);
  await f.consumed(f.service);
  expect(f.prompts).toEqual(["B"]);
});
