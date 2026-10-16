import { z } from "zod";

const modelsSchema = z.array(z.string().min(1).max(256)).max(10000);
const recordsSchema = z.array(z.object({ source: z.string(), models: modelsSchema })).max(4);
const storageKey = "forge-model-catalog-v1";

export function createModelCatalogCache(storage: () => Pick<Storage, "getItem" | "setItem"> = () => localStorage) {
  const memory = new Map<string, readonly string[]>();
  const pending = new Map<string, Promise<readonly string[]>>();
  const read = (source: string): readonly string[] | undefined => {
    const cached = memory.get(source);
    if (cached) return cached;
    try {
      const raw = storage().getItem(storageKey);
      if (!raw || raw.length > 4 * 1024 * 1024) return undefined;
      const records = recordsSchema.parse(JSON.parse(raw));
      for (const record of records) memory.set(record.source, record.models);
      return memory.get(source);
    } catch { return undefined; }
  };
  const load = (source: string, loader: () => Promise<readonly string[]>, refresh = false): Promise<readonly string[]> => {
    const inflight = pending.get(source);
    if (inflight) return inflight;
    const cached = read(source);
    if (!refresh && cached) return Promise.resolve(cached);
    const request = Promise.resolve().then(loader).then(raw => {
      const models = modelsSchema.parse(raw);
      memory.delete(source);
      memory.set(source, models);
      while (memory.size > 4) {
        const oldest = memory.keys().next().value;
        if (oldest === undefined) break;
        memory.delete(oldest);
      }
      try { storage().setItem(storageKey, JSON.stringify([...memory].map(([source, models]) => ({ source, models })))); } catch { /* Memory cache remains available if storage is blocked. */ }
      return models;
    }).finally(() => pending.delete(source));
    pending.set(source, request);
    return request;
  };
  return { read, load };
}

export const modelCatalogCache = createModelCatalogCache();
