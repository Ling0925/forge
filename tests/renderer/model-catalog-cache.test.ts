import { expect, it, vi } from "vitest";
import { createModelCatalogCache, modelCatalogKey } from "../../src/renderer/state/model-catalog-cache";
import type { ModelCatalog } from "../../src/shared/model-catalog";

const catalog = (id: string): ModelCatalog => [{
  id, contextWindowTokens: 256000, maxOutputTokens: 16384,
  reasoningEffort: "high", reasoningEfforts: ["low", "high"],
}];

it("persists model lists and refreshes only explicitly, retaining data after errors", async () => {
  let saved: string | null = null;
  const storage = () => ({ getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
  const loader = vi.fn(async () => catalog("provider/alpha"));
  const cache = createModelCatalogCache(storage);
  await Promise.all([cache.load("provider", loader), cache.load("provider", loader)]);
  expect(loader).toHaveBeenCalledTimes(1);
  const reloaded = createModelCatalogCache(storage);
  expect(await reloaded.load("provider", loader)).toEqual(catalog("provider/alpha"));
  expect(loader).toHaveBeenCalledTimes(1);
  loader.mockResolvedValue(catalog("provider/beta"));
  expect(await reloaded.load("provider", loader, true)).toEqual(catalog("provider/beta"));
  expect(loader).toHaveBeenCalledTimes(2);
  loader.mockRejectedValueOnce(new Error("offline"));
  await expect(reloaded.load("provider", loader, true)).rejects.toThrow("offline");
  expect(await reloaded.load("provider", loader)).toEqual(catalog("provider/beta"));
  expect(loader).toHaveBeenCalledTimes(3);
  await reloaded.load("different-provider", loader);
  expect(loader).toHaveBeenCalledTimes(4);
});

it("retains all 20 supported sources across page reloads", async () => {
  let saved: string | null = null;
  const storage = () => ({ getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
  const cache = createModelCatalogCache(storage);
  const loader = vi.fn(async () => catalog("provider/alpha"));
  for (let index = 0; index < 20; index++) await cache.load(`source-${index}`, loader);
  const reloaded = createModelCatalogCache(storage);
  for (let index = 0; index < 20; index++) {
    expect(await reloaded.load(`source-${index}`, loader)).toEqual(catalog("provider/alpha"));
  }
  expect(loader).toHaveBeenCalledTimes(20);
});

it("shares explicit-source keys independently of environment overrides, isolating endpoints and protocols", () => {
  const source = { id: "a", baseUrl: "https://a.test/v1" };
  expect(modelCatalogKey(source)).toBe(modelCatalogKey(source, true));
  expect(modelCatalogKey(source)).toBe(JSON.stringify(["a", source.baseUrl, "chat-completions", false, 0]));
  expect(modelCatalogKey({ ...source, id: "b" })).not.toBe(modelCatalogKey(source));
  expect(modelCatalogKey({ ...source, revision: 2 })).not.toBe(modelCatalogKey({ ...source, revision: 1 }));
  expect(modelCatalogKey({ ...source, baseUrl: "https://b.test/v1" })).not.toBe(modelCatalogKey(source));
  expect(modelCatalogKey({ ...source, apiMode: "anthropic" })).not.toBe(modelCatalogKey(source));
  expect(modelCatalogKey({ baseUrl: source.baseUrl }, true)).not.toBe(modelCatalogKey({ baseUrl: source.baseUrl }));
});

it("caches empty lists and keeps working without browser storage", async () => {
  const cache = createModelCatalogCache(() => { throw new Error("blocked"); });
  const loader = vi.fn(async () => []);
  await cache.load("provider", loader);
  await cache.load("provider", loader);
  expect(loader).toHaveBeenCalledTimes(1);
});

it("drops catalogs for sources that no longer exist and persists the survivors", async () => {
  let saved: string | null = null;
  const storage = () => ({
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  });
  const cache = createModelCatalogCache(storage);
  const loader = vi.fn(async () => catalog("provider/alpha"));
  await cache.load("keep", loader);
  await cache.load("drop", loader);
  cache.retain(["keep"]);
  expect(JSON.parse(saved ?? "[]").map((record: { source: string }) => record.source)).toEqual(["keep"]);
  const reloaded = createModelCatalogCache(storage);
  expect(await reloaded.load("keep", loader)).toEqual(catalog("provider/alpha"));
  expect(await reloaded.load("drop", loader)).toEqual(catalog("provider/alpha"));
  expect(loader).toHaveBeenCalledTimes(3);
});

it("lets an explicit refresh supersede an in-flight read instead of reusing it", async () => {
  const cache = createModelCatalogCache(() => { throw new Error("blocked"); });
  let release: ((models: ModelCatalog) => void) | undefined;
  const slow = vi.fn(
    () => new Promise<ModelCatalog>((resolve) => { release = resolve; }),
  );
  const first = cache.load("provider", slow);
  await Promise.resolve();
  const fresh = cache.load("provider", async () => catalog("provider/fresh"), true);
  expect(slow).toHaveBeenCalledTimes(1);
  expect(await fresh).toEqual(catalog("provider/fresh"));
  release?.(catalog("provider/stale"));
  expect(await first).toEqual(catalog("provider/stale"));
  expect(cache.read("provider")).toEqual(catalog("provider/fresh"));
});

it("ignores old ID-only storage when loading metadata", async () => {
  const saved = new Map([["forge-model-catalog-v1", JSON.stringify([{ source: "provider", models: ["provider/old"] }])]]);
  const cache = createModelCatalogCache(() => ({
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); },
  }));
  const loader = vi.fn(async () => catalog("provider/current"));
  expect(await cache.load("provider", loader)).toEqual(catalog("provider/current"));
  expect(loader).toHaveBeenCalledTimes(1);
  expect(JSON.parse(saved.get("forge-model-catalog-v2")!)[0].models).toEqual(catalog("provider/current"));
});

it("does not resurrect a removed revision when its pending response arrives", async () => {
  let saved: string | null = null;
  const storage = () => ({ getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
  const cache = createModelCatalogCache(storage);
  let release!: (models: ModelCatalog) => void;
  const old = cache.load("revision-1", () => new Promise<ModelCatalog>((resolve) => { release = resolve; }));
  await Promise.resolve();
  cache.retain(["revision-2"]);
  await cache.load("revision-2", async () => catalog("new"));
  release(catalog("old"));
  await old;
  expect(cache.read("revision-1")).toBeUndefined();
  expect(createModelCatalogCache(storage).read("revision-1")).toBeUndefined();
  expect(cache.read("revision-2")).toEqual(catalog("new"));
});
