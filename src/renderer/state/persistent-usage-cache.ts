import { z } from "zod";
import { contextUsageSchema, usageSchema } from "../../shared/schemas";
import type { SessionSnapshot, SessionSummary } from "../shared-types";
import { sessionUsage } from "./session-usage";

type Identity = Pick<SessionSummary, "id" | "updatedAt" | "status" | "model">;
const key = "forge-session-usage-v1";
const number = z.number().finite().nonnegative();
const resultSchema = z
  .object({
    context: contextUsageSchema.optional(),
    total: usageSchema.optional(),
    partial: z.boolean(),
    latestCache: number.optional(),
    averageCache: number.optional(),
    cacheRead: number.optional(),
    cachePartial: z.boolean(),
  })
  .strict();
const recordSchema = z
  .object({
    id: z.string().uuid(),
    version: z.string(),
    eventCount: z.number().int().nonnegative(),
    model: z.string().max(256),
    usage: resultSchema,
  })
  .strict();
const recordsSchema = z.array(recordSchema).max(100);
type Record = z.infer<typeof recordSchema>;
type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;
const terminal = (session: Identity) =>
  ["completed", "failed", "cancelled", "interrupted"].includes(session.status);
const version = (session: Identity) =>
  JSON.stringify([session.updatedAt, session.status, session.model]);

export function createPersistentUsageCache(
  storage: StorageAccess = () => localStorage,
) {
  const read = (): Record[] => {
    try {
      const raw = storage().getItem(key);
      if (!raw || raw.length > 1024 * 1024) return [];
      const parsed = recordsSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  };
  const get = (session: Identity) => {
    if (!terminal(session)) return undefined;
    return read().find(
      (item) => item.id === session.id && item.version === version(session),
    );
  };
  const snapshot = (session: SessionSnapshot) => {
    const saved = get(session);
    if (saved && saved.eventCount === session.events.length) return saved;
    const result = {
      id: session.id,
      version: version(session),
      eventCount: session.events.length,
      model:
        session.events.findLast((event) => event.type === "run_started")
          ?.model ?? session.model,
      usage: sessionUsage(session.events),
    };
    if (terminal(session)) {
      try {
        storage().setItem(
          key,
          JSON.stringify(
            [...read().filter((item) => item.id !== session.id), result].slice(
              -100,
            ),
          ),
        );
      } catch {
        /* Storage is optional; the in-memory result remains usable. */
      }
    }
    return result;
  };
  return { get, snapshot };
}

export const persistentUsageCache = createPersistentUsageCache();
