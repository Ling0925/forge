import type { SessionPage } from "../../shared/session-page";
import type { SessionSnapshot } from "../shared-types";
import { seedSessionUsage } from "./session-usage";

/** Attach display-only offsets without ever manufacturing a full transcript. */
export function pageSnapshot(result: SessionPage): SessionSnapshot {
  return seedSnapshotUsage({ ...result.snapshot, transcript: result.page });
}

export function seedSnapshotUsage(snapshot: SessionSnapshot): SessionSnapshot {
  if (snapshot.transcript) seedSessionUsage(snapshot.events, snapshot.transcript.usageBefore);
  return snapshot;
}

export function prependSessionPage(current: SessionSnapshot, result: SessionPage): SessionSnapshot {
  const page = current.transcript;
  if (!page || current.id !== result.snapshot.id ||
      result.page.messageEnd !== page.messageOffset || result.page.eventEnd !== page.eventOffset) {
    throw new Error("历史记录边界已变化，请重新打开会话后重试。");
  }
  return seedSnapshotUsage({
    ...current,
    messages: [...result.snapshot.messages, ...current.messages],
    events: [...result.snapshot.events, ...current.events],
    changes: [...result.snapshot.changes, ...current.changes],
    transcript: {
      ...page,
      messageOffset: result.page.messageOffset,
      eventOffset: result.page.eventOffset,
      firstTurn: result.page.firstTurn,
      hasMore: result.page.hasMore,
      usageBefore: result.page.usageBefore,
    },
  });
}

/** A tail refresh may have started before an older page was prepended. */
export function retainLoadedPrefix(current: SessionSnapshot, incoming: SessionSnapshot): SessionSnapshot {
  const before = current.transcript;
  const after = incoming.transcript;
  if (!before || !after || before.messageOffset >= after.messageOffset) return incoming;
  const messages = after.messageOffset - before.messageOffset;
  const events = after.eventOffset - before.eventOffset;
  if (messages > current.messages.length || events < 0 || events > current.events.length) return incoming;
  return {
    ...incoming,
    messages: [...current.messages.slice(0, messages), ...incoming.messages],
    events: [...current.events.slice(0, events), ...incoming.events],
    // Only already-requested history is retained. No extra history is fetched.
    changes: [...current.events.slice(0, events).flatMap(event => event.type === "tool_finished" ? event.result.changes ?? [] : []), ...incoming.changes],
    transcript: {
      ...after,
      messageOffset: before.messageOffset,
      eventOffset: before.eventOffset,
      firstTurn: before.firstTurn,
      hasMore: before.hasMore,
      usageBefore: before.usageBefore,
    },
  };
}
