import type { SessionSnapshot, ToolCall } from "../shared-types";

export type TimelineItem =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly content: string;
      readonly origin?: "agent_reconciliation";
    }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly call: ToolCall;
      readonly status: "running" | "completed" | "failed" | "unexecuted";
      readonly output: string;
    }
  | {
      readonly kind: "error";
      readonly id: string;
      readonly message: string;
      readonly timestamp: string;
    };

function isHumanTurn(message: SessionSnapshot["messages"][number]): boolean {
  return message.role === "user" && message.origin !== "agent_reconciliation";
}

/** Native message order is authoritative. IDs are only unique within a call occurrence. */
export function reduceTimeline(
  snapshot: SessionSnapshot,
): readonly TimelineItem[] {
  const items: TimelineItem[] = [];
  const pending = new Map<string, number[]>();
  const runStarts = snapshot.events.flatMap((event, index) =>
    event.type === "run_started" ? [index] : [],
  );
  const userCount = snapshot.messages.filter(isHumanTurn).length;
  const alignedRuns = runStarts.length === userCount && userCount > 0;
  let turn = -1;
  const placedErrors = new Set<number>();
  const appendErrors = (from: number, to: number) => {
    snapshot.events.slice(from, to).forEach((event, offset) => {
      if (event.type !== "error") return;
      const index = from + offset;
      placedErrors.add(index);
      items.push({
        kind: "error",
        id: `error:${index}`,
        message: event.error.message,
        timestamp: event.timestamp,
      });
    });
  };
  const starts = snapshot.events.filter((e) => e.type === "tool_started");
  const finishes = snapshot.events.filter((e) => e.type === "tool_finished");
  const occurrences = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const message of snapshot.messages)
    if (message.role === "assistant")
      for (const call of message.tool_calls ?? [])
        totals.set(call.id, (totals.get(call.id) ?? 0) + 1);
  // Persisted calls can be interrupted before emitting a start. Only correlate
  // repeated legacy IDs when counts agree, or with the final unresolved call.
  // Tool messages below remain authoritative for completed exchanges.

  for (const [index, message] of snapshot.messages.entries()) {
    if (isHumanTurn(message)) {
      if (alignedRuns && turn >= 0)
        appendErrors(
          runStarts[turn] ?? 0,
          runStarts[turn + 1] ?? snapshot.events.length,
        );
      turn++;
    }
    if (message.role === "user" || message.role === "assistant") {
      // Internal child joins do not start a human turn or break pending results.
      if (message.role !== "user" || message.origin !== "agent_reconciliation")
        pending.clear();
      if (message.content)
        items.push({
          kind: "message",
          id: `message:${index}`,
          role: message.role,
          content: message.content,
          ...(message.role === "user" &&
          message.origin === "agent_reconciliation"
            ? { origin: message.origin }
            : {}),
        });
      if (message.role === "assistant")
        for (const call of message.tool_calls ?? []) {
          const occurrence = occurrences.get(call.id) ?? 0;
          occurrences.set(call.id, occurrence + 1);
          const runEvents =
            alignedRuns && turn >= 0
              ? snapshot.events.slice(runStarts[turn], runStarts[turn + 1])
              : null;
          const scopedStarts =
            runEvents?.filter((e) => e.type === "tool_started") ?? starts;
          const scopedFinishes =
            runEvents?.filter((e) => e.type === "tool_finished") ?? finishes;
          const matchingStarts = scopedStarts.filter(
            (e) => e.call.id === call.id,
          );
          const matchingFinishes = scopedFinishes.filter(
            (e) => e.toolCallId === call.id,
          );
          const total = runEvents
            ? snapshot.messages
                .slice(
                  snapshot.messages
                    .slice(0, index + 1)
                    .findLastIndex(isHumanTurn),
                  (() => {
                    const next = snapshot.messages
                      .slice(index + 1)
                      .findIndex(isHumanTurn);
                    return next < 0 ? undefined : index + 1 + next;
                  })(),
                )
                .reduce(
                  (count, m) =>
                    count +
                    (m.role === "assistant"
                      ? (m.tool_calls ?? []).filter((c) => c.id === call.id)
                          .length
                      : 0),
                  0,
                )
            : (totals.get(call.id) ?? 1);
          const localOccurrence = runEvents
            ? snapshot.messages
                .slice(
                  snapshot.messages
                    .slice(0, index + 1)
                    .findLastIndex(isHumanTurn),
                  index,
                )
                .reduce(
                  (count, m) =>
                    count +
                    (m.role === "assistant"
                      ? (m.tool_calls ?? []).filter((c) => c.id === call.id)
                          .length
                      : 0),
                  0,
                )
            : occurrence;
          const finalUnresolved =
            localOccurrence === total - 1 &&
            !snapshot.messages
              .slice(index + 1)
              .some((m) => m.role === "tool" && m.tool_call_id === call.id);
          const start =
            matchingStarts.length === total
              ? matchingStarts[localOccurrence]
              : finalUnresolved &&
                  matchingStarts.length > matchingFinishes.length
                ? matchingStarts.at(-1)
                : undefined;
          const finish =
            matchingFinishes.length === total
              ? matchingFinishes[localOccurrence]
              : undefined;
          pending.set(call.id, [...(pending.get(call.id) ?? []), items.length]);
          items.push({
            kind: "tool",
            id: `tool:${index}:${call.id}:${occurrence}`,
            call,
            status: finish
              ? finish.result.isError
                ? "failed"
                : "completed"
              : start
                ? "running"
                : "unexecuted",
            output: finish?.result.content ?? "",
          });
        }
    } else if (message.role === "tool") {
      const position = pending.get(message.tool_call_id)?.shift();
      const item = position === undefined ? undefined : items[position];
      if (item?.kind !== "tool" || position === undefined) continue;
      // Tool messages are ordinary text; invalid JSON does not imply tool failure.
      let output = message.content ?? "";
      let failed = item.status === "failed";
      try {
        const parsed: unknown = JSON.parse(output);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "content" in parsed &&
          typeof parsed.content === "string"
        ) {
          output = parsed.content;
          failed = "isError" in parsed && parsed.isError === true;
        }
      } catch {
        /* native tool results may be plain text */
      }
      items[position] = {
        ...item,
        output,
        status: failed ? "failed" : "completed",
      };
    }
  }
  if (alignedRuns && turn >= 0)
    appendErrors(runStarts[turn] ?? 0, snapshot.events.length);
  // Old error events cannot be positioned against messages. Keep explicitly historical evidence.
  snapshot.events.forEach((event, index) => {
    if (event.type === "error" && !placedErrors.has(index))
      items.push({
        kind: "error",
        id: `error:${index}`,
        message: event.error.message,
        timestamp: event.timestamp,
      });
  });
  return items;
}
