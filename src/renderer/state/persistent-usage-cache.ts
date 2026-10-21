import { z } from "zod";
import { contextUsageSchema, usageSchema } from "../../shared/schemas";
import type { SessionSnapshot, SessionSummary } from "../shared-types";
import { seedSessionUsage, sessionUsage } from "./session-usage";

type Identity = Pick<SessionSummary, "id" | "updatedAt" | "status" | "model">;
// v2 invalidates summaries computed with alternating input+output/estimate totals.
const key = "forge-session-usage-v2";
const number = z.number().finite().nonnegative();
const resultSchema = z
  .object({
    context: contextUsageSchema.optional(),
    projected: contextUsageSchema.optional(),
    compacted: z.boolean(),
    total: usageSchema.optional(),
    partial: z.boolean(),
    latestCache: number.optional(),
    averageCache: number.optional(),
    cacheRead: number.optional(),
    cachePartial: z.boolean(),
    speed: z
      .object({
        outputTokens: number,
        durationMs: number,
        partial: z.boolean(),
        requestStartedAt: z.number().finite().optional(),
      })
      .strict(),
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

/** Number of durable events represented from the beginning of the transcript. */
const eventCount = (session: SessionSnapshot) => {
  const transcript = session.transcript;
  return transcript === undefined
    ? session.events.length
    : Math.max(
        transcript.eventEnd,
        transcript.eventOffset + session.events.length,
      );
};
/** A page without its fixed-size prefix total cannot produce a full summary. */
const hasCompleteUsage = (session: SessionSnapshot) => {
  const transcript = session.transcript;
  return (
    transcript === undefined ||
    transcript.eventOffset === 0 ||
    transcript.usageBefore !== undefined
  );
};

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
    const represented = eventCount(session);
    // A full, newer persisted summary still covers an older page of the same
    // version. Never replace it with a page-only total.
    if (saved && saved.eventCount >= represented) return saved;
    const transcript = session.transcript;
    if (transcript?.usageBefore !== undefined) {
      seedSessionUsage(session.events, transcript.usageBefore);
    }
    const complete = hasCompleteUsage(session);
    const usage = sessionUsage(session.events);
    const result = {
      id: session.id,
      version: version(session),
      eventCount: represented,
      model:
        session.events.findLast((event) => event.type === "run_started")
          ?.model ??
        transcript?.usageBefore?.display.model ??
        session.model,
      // A page without its prefix summary only knows the recent window: keep
      // its tokens but mark them partial instead of presenting a lifetime total.
      usage: complete ? usage : { ...usage, partial: true },
    };
    if (terminal(session) && complete) {
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
