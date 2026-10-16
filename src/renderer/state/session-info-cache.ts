import type { SessionSnapshot, SessionSummary } from "../shared-types";
import { sessionUsage } from "./session-usage";

export function summarizeSession(snapshot: SessionSnapshot) {
  const usage = sessionUsage(snapshot.events);
  const model =
    snapshot.events.findLast((event) => event.type === "run_started")?.model ??
    snapshot.model;
  return {
    tokens: usage.total
      ? `${usage.total.totalTokens.toLocaleString()}${usage.partial ? "（部分统计）" : ""}`
      : "未记录",
    model,
  };
}

export function createSessionInfoCache(now = Date.now) {
  const entries = new Map<
    string,
    {
      version: string;
      expires: number;
      value: Promise<ReturnType<typeof summarizeSession>>;
    }
  >();
  return (
    session: Pick<SessionSummary, "id" | "updatedAt" | "status" | "model">,
    read: () => Promise<SessionSnapshot>,
  ) => {
    const version = JSON.stringify([
      session.updatedAt,
      session.status,
      session.model,
    ]);
    const cached = entries.get(session.id);
    if (cached && cached.version === version && cached.expires > now()) {
      entries.delete(session.id);
      entries.set(session.id, cached);
      return cached.value;
    }
    const value = read().then(summarizeSession);
    const entry = {
      version,
      expires:
        now() +
        (session.status === "running" || session.status === "awaiting_approval"
          ? 2000
          : 60000),
      value,
    };
    entries.delete(session.id);
    entries.set(session.id, entry);
    while (entries.size > 100) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    void value.catch(() => {
      if (entries.get(session.id) === entry) entries.delete(session.id);
    });
    return value;
  };
}

export const readSessionInfo = createSessionInfoCache();
