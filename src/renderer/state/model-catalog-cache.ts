import { z } from "zod";
import { modelCatalogSchema, type ModelCatalog } from "../../shared/model-catalog";

const modelsSchema = modelCatalogSchema;
// Keep all 20 supported provider sources, with room for legacy/changed endpoints.
const maxCatalogs = 24;
const recordsSchema = z.array(z.object({ source: z.string(), models: modelsSchema })).max(maxCatalogs);
// v1 stored only IDs, so it cannot satisfy a metadata read after an upgrade.
const storageKey = "forge-model-catalog-v2";

export function modelCatalogKey(source: {
  id?: string | undefined;
  baseUrl: string;
  apiMode?: string | undefined;
  revision?: number | undefined;
}, environmentOverride = false): string {
  // Every saved source edit bumps its revision, including metadata and selection.
  // Explicit sources ignore environment overrides, just like getProviderConfig.
  return JSON.stringify([source.id ?? "legacy", source.baseUrl, source.apiMode ?? "chat-completions", source.id ? false : environmentOverride, source.revision ?? 0]);
}

export function createModelCatalogCache(storage: () => Pick<Storage, "getItem" | "setItem"> = () => localStorage) {
  const memory = new Map<string, ModelCatalog>();
  const pending = new Map<string, Promise<ModelCatalog>>();
  // Hydrate the whole map once so a prune never wipes entries it has not read.
  let hydrated = false;
  const hydrate = (): void => {
    if (hydrated) return;
    hydrated = true;
    try {
      const raw = storage().getItem(storageKey);
      if (!raw || raw.length > 4 * 1024 * 1024) return;
      const records = recordsSchema.parse(JSON.parse(raw));
      for (const record of records)
        if (!memory.has(record.source)) memory.set(record.source, record.models);
    } catch {
      /* Fall back to whatever is already in memory. */
    }
  };
  const read = (source: string): ModelCatalog | undefined => {
    const cached = memory.get(source);
    if (cached) return cached;
    hydrate();
    return memory.get(source);
  };
  const load = (
    source: string,
    loader: () => Promise<ModelCatalog>,
    refresh = false,
  ): Promise<ModelCatalog> => {
    const inflight = pending.get(source);
    // An explicit refresh must not be answered by a request that started before
    // the user asked for fresh data.
    if (inflight && !refresh) return inflight;
    const cached = read(source);
    if (!refresh && cached) return Promise.resolve(cached);
    const request = Promise.resolve().then(loader).then(raw => {
      const models = modelsSchema.parse(raw);
      // A superseded read must not overwrite a refresh or resurrect a saved source's old revision.
      if (pending.get(source) !== request) return models;
      memory.delete(source);
      memory.set(source, models);
      while (memory.size > maxCatalogs) {
        const oldest = memory.keys().next().value;
        if (oldest === undefined) break;
        memory.delete(oldest);
      }
      persist();
      return models;
    }).finally(() => {
      // Only clear the entry this request installed; a newer refresh owns it.
      if (pending.get(source) === request) pending.delete(source);
    });
    pending.set(source, request);
    return request;
  };
  // A source whose endpoint changed keeps its old key in storage; drop entries
  // that no longer correspond to a live source so stale catalogs cannot surface.
  const retain = (live: readonly string[]) => {
    hydrate();
    const keep = new Set(live);
    for (const key of [...memory.keys()]) if (!keep.has(key)) memory.delete(key);
    for (const key of [...pending.keys()]) if (!keep.has(key)) pending.delete(key);
    persist();
  };
  const persist = () => {
    try {
      storage().setItem(
        storageKey,
        JSON.stringify([...memory].map(([source, models]) => ({ source, models }))),
      );
    } catch {
      /* Memory cache remains available if storage is blocked. */
    }
  };
  return { read, load, retain };
}

export const modelCatalogCache = createModelCatalogCache();
