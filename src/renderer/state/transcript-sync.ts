import type { SessionSnapshot } from "../shared-types";

export interface PendingOutput {
  readonly id: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly afterMessage: number;
  readonly toolCallId?: string | undefined;
}

export function outputSaved(
  output: PendingOutput,
  snapshot: SessionSnapshot | null,
): boolean {
  return (
    snapshot?.messages
      .slice(output.afterMessage)
      .some(
        (message) =>
          message.role === "assistant" &&
          (output.toolCallId
            ? message.tool_calls?.some(
                (call) => call.id === output.toolCallId,
              ) && Boolean(message.content)
            : Boolean(message.content?.startsWith(output.text))),
      ) ?? false
  );
}

/** Reasoning is display-only and synchronized independently of assistant prose. */
export function reasoningSaved(
  output: PendingOutput,
  snapshot: SessionSnapshot | null,
): boolean {
  return (
    snapshot?.messages.slice(output.afterMessage).some((message) =>
      message.role === "assistant" &&
      Boolean(message.reasoning?.startsWith(output.text)) &&
      (!output.toolCallId || message.tool_calls?.some((call) => call.id === output.toolCallId)),
    ) ?? false
  );
}

export function mergeTranscript(
  current: SessionSnapshot | null,
  incoming: SessionSnapshot,
  persistedAt: string | null = null,
): SessionSnapshot {
  if (!current || current.id !== incoming.id) return incoming;
  const counts = new Map<string, number>();
  for (const event of incoming.events) {
    const key = JSON.stringify(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const missing = current.events.filter((event) => {
    const key = JSON.stringify(event);
    const count = counts.get(key) ?? 0;
    if (count) {
      counts.set(key, count - 1);
      return false;
    }
    return true;
  });
  const newerLocal = current.updatedAt > incoming.updatedAt;
  return {
    ...incoming,
    messages:
      (persistedAt !== null && incoming.updatedAt < persistedAt) ||
      current.messages.length > incoming.messages.length
        ? current.messages
        : incoming.messages,
    events: missing.length
      ? [...incoming.events, ...missing].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp),
        )
      : incoming.events,
    updatedAt: newerLocal ? current.updatedAt : incoming.updatedAt,
    status: newerLocal ? current.status : incoming.status,
    ...(newerLocal && current.plan ? { plan: current.plan } : {}),
  };
}
