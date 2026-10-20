import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createHarness } from "../../src/core/harness";
import { createRuntimeHub } from "../../src/host/runtime";
import type { CreateSessionInput } from "../../src/shared/schemas";
import * as settingsModule from "../../src/store/settings";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const source = (id: string) => ({ id, label: id, baseUrl: `https://${id}.invalid/v1`, model: "fixture", apiMode: "chat-completions" as const });
const group = { id: "fallback", label: "Fallback", strategy: "order" as const, members: [
  { sourceId: "offline", model: "offline-model" }, { sourceId: "live", model: "live-model" },
] };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forge-queue-model-access-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const calls: { model: string; sourceId: string | undefined; baseUrl: string; apiKey: string }[] = [];
  const service = await createHarness({ stateDir: directory,
    providerFactory: config => ({ listModels: async () => ["fixture"], complete: async (_messages, _tools, options) => {
      calls.push({ model: options.model, sourceId: config.sourceId, baseUrl: config.baseUrl, apiKey: config.apiKey });
      return { message: { role: "assistant", content: "done" } };
    } }),
    toolFactory: () => ({ definitions: [], execute: async () => ({ content: "ok", isError: false }), dispose: async () => {} }),
  });
  const runtime = createRuntimeHub(service);
  cleanup.push(() => runtime.dispose());
  const queue = service.inputQueue!;
  const session = async (selection: Omit<CreateSessionInput, "workspace">) => {
    const created = await service.createSession({ ...selection, workspace: directory, title: "Manual title" });
    await queue.pause(created.id);
    return created;
  };
  return { service, queue, calls, session };
}
async function routedFixture() {
  const f = await fixture();
  await f.service.updateSettings({ sources: [
    { type: "save", source: source("offline"), credentials: [{ id: "off", label: "Off", type: "api-key", enabled: false, apiKey: "" }] },
    { type: "save", source: source("live"), apiKey: "" },
  ], route: { type: "save", group } });
  return f;
}
it("pins an inherited route through queue normalization and skips unavailable members", async () => {
  const f = await routedFixture();
  const session = await f.session({ routeGroupId: group.id });
  const accepted = await f.queue.enqueue({ inputId: randomUUID(), input: { sessionId: session.id, prompt: "queued" } });
  expect(accepted.input?.routeGroupId).toBe(group.id);
  expect(accepted.selection.routeGroupId).toBe(group.id);
  await f.queue.resume(session.id);
  await vi.waitFor(async () => expect((await f.queue.list(session.id)).items[0]).toMatchObject({ state: "consumed", outcome: "completed", selection: { routeGroupId: group.id } }));
  expect(f.calls.map(call => [call.sourceId, call.model])).toEqual([["live", "live-model"]]);
  expect((await f.service.getSession(session.id)).routeGroupId).toBe(group.id);
});
it("blocks a changed route before inference instead of silently changing accepted selection", async () => {
  const f = await routedFixture();
  const session = await f.session({ routeGroupId: group.id });
  await f.queue.enqueue({ inputId: randomUUID(), input: { sessionId: session.id, prompt: "queued" } });
  await f.service.updateSettings({ route: { type: "save", group: { ...group, members: [{ sourceId: "live", model: "replacement" }] } } });
  await f.queue.resume(session.id);
  await vi.waitFor(async () => expect((await f.queue.list(session.id)).items[0]?.state).toBe("blocked"));
  expect(f.calls).toEqual([]);
  expect((await f.service.getSession(session.id)).messages).toEqual([]);
});
it("compares configured Azure selection rather than its normalized request URL", async () => {
  const f = await fixture();
  await f.service.updateSettings({ source: { type: "save", source: { ...source("azure"), preset: "azure", baseUrl: "https://fixture.openai.azure.com" }, apiKey: "" } });
  const session = await f.session({ providerSourceId: "azure", model: "deployment" });
  await f.queue.enqueue({ inputId: randomUUID(), input: { sessionId: session.id, prompt: "queued" } });
  await f.queue.resume(session.id);
  await vi.waitFor(async () => expect((await f.queue.list(session.id)).items[0]).toMatchObject({ state: "consumed", outcome: "completed" }));
  expect(f.calls).toMatchObject([{ sourceId: "azure", model: "deployment", baseUrl: "https://fixture.openai.azure.com/openai/v1" }]);
});
it("allows credential rotation without changing the accepted source or model", async () => {
  const f = await fixture();
  await f.service.updateSettings({ source: { type: "save", source: source("live"), apiKey: "fixture-old-key" } });
  const session = await f.session({ providerSourceId: "live", model: "exact" });
  await f.queue.enqueue({ inputId: randomUUID(), input: { sessionId: session.id, prompt: "queued" } });
  await f.service.updateSettings({ source: { type: "save", source: source("live"), apiKey: "fixture-new-key" } });
  await f.queue.resume(session.id);
  await vi.waitFor(async () => expect((await f.queue.list(session.id)).items[0]).toMatchObject({ state: "consumed", outcome: "completed" }));
  expect(f.calls).toMatchObject([{ sourceId: "live", model: "exact", apiKey: "fixture-new-key" }]);
});

it("rejects a source change between queue admission and the provider's atomic snapshot", async () => {
  const openStore = settingsModule.openSettingsStore;
  let replaceAtResolve = false;
  vi.spyOn(settingsModule, "openSettingsStore").mockImplementation(async (...args) => {
    const store = await openStore(...args);
    return { ...store, getProviderSnapshot: async (sourceId?: string, credentialId?: string) => {
      if (replaceAtResolve) {
        replaceAtResolve = false;
        await store.update({ source: { type: "save", source: { ...source("live"), baseUrl: "https://changed.invalid/v1" } } });
      }
      return store.getProviderSnapshot!(sourceId, credentialId);
    } };
  });
  const f = await fixture();
  await f.service.updateSettings({ source: { type: "save", source: source("live"), apiKey: "" } });
  const session = await f.session({ providerSourceId: "live", model: "exact" });
  await f.queue.enqueue({ inputId: randomUUID(), input: { sessionId: session.id, prompt: "queued" } });
  replaceAtResolve = true;
  await f.queue.resume(session.id);
  await vi.waitFor(async () => expect((await f.queue.list(session.id)).items[0]).toMatchObject({ state: "consumed", outcome: "failed" }));
  expect(replaceAtResolve).toBe(false);
  expect(f.calls).toEqual([]);
  expect((await f.service.getSession(session.id)).messages).toEqual([]);
});
