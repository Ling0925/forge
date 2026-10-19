import { expect, it, vi } from "vitest";
import { createModelCatalogCache, modelCatalogKey } from "../../src/renderer/state/model-catalog-cache";

it("persists model lists and refreshes only explicitly, retaining data after errors", async () => {
  let saved: string | null = null;
  const storage = () => ({ getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
  const loader = vi.fn(async () => ["provider/alpha"]);
  const cache = createModelCatalogCache(storage);
  await Promise.all([cache.load("provider", loader), cache.load("provider", loader)]);
  expect(loader).toHaveBeenCalledTimes(1);
  const reloaded = createModelCatalogCache(storage);
  expect(await reloaded.load("provider", loader)).toEqual(["provider/alpha"]);
  expect(loader).toHaveBeenCalledTimes(1);
  loader.mockResolvedValue(["provider/beta"]);
  expect(await reloaded.load("provider", loader, true)).toEqual(["provider/beta"]);
  expect(loader).toHaveBeenCalledTimes(2);
  loader.mockRejectedValueOnce(new Error("offline"));
  await expect(reloaded.load("provider", loader, true)).rejects.toThrow("offline");
  expect(await reloaded.load("provider", loader)).toEqual(["provider/beta"]);
  expect(loader).toHaveBeenCalledTimes(3);
  await reloaded.load("different-provider", loader);
  expect(loader).toHaveBeenCalledTimes(4);
});

it("retains all 20 supported sources across page reloads", async () => {
  let saved: string | null = null;
  const storage = () => ({ getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
  const cache = createModelCatalogCache(storage);
  const loader = vi.fn(async () => ["provider/alpha"]);
  for (let index = 0; index < 20; index++) await cache.load(`source-${index}`, loader);
  const reloaded = createModelCatalogCache(storage);
  for (let index = 0; index < 20; index++) {
    expect(await reloaded.load(`source-${index}`, loader)).toEqual(["provider/alpha"]);
  }
  expect(loader).toHaveBeenCalledTimes(20);
});

it("shares explicit-source keys independently of environment overrides, isolating endpoints and protocols", () => {
  const source = { id: "a", baseUrl: "https://a.test/v1" };
  expect(modelCatalogKey(source)).toBe(modelCatalogKey(source, true));
  expect(modelCatalogKey(source)).toBe(JSON.stringify(["a", source.baseUrl, "chat-completions", false]));
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
  const loader = vi.fn(async () => ["provider/alpha"]);
  await cache.load("keep", loader);
  await cache.load("drop", loader);
  cache.retain(["keep"]);
  expect(JSON.parse(saved ?? "[]").map((record: { source: string }) => record.source)).toEqual(["keep"]);
  const reloaded = createModelCatalogCache(storage);
  expect(await reloaded.load("keep", loader)).toEqual(["provider/alpha"]);
  expect(await reloaded.load("drop", loader)).toEqual(["provider/alpha"]);
  expect(loader).toHaveBeenCalledTimes(3);
});

it("lets an explicit refresh supersede an in-flight read instead of reusing it", async () => {
  const cache = createModelCatalogCache(() => { throw new Error("blocked"); });
  let release: ((models: string[]) => void) | undefined;
  const slow = vi.fn(
    () => new Promise<readonly string[]>((resolve) => { release = (models) => resolve(models); }),
  );
  const first = cache.load("provider", slow);
  await Promise.resolve();
  const fresh = cache.load("provider", async () => ["provider/fresh"], true);
  expect(slow).toHaveBeenCalledTimes(1);
  expect(await fresh).toEqual(["provider/fresh"]);
  release?.(["provider/stale"]);
  expect(await first).toEqual(["provider/stale"]);
});
