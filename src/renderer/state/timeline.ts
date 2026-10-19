import { fileChangeSchema } from "../../shared/schemas";
import type { ImageAttachment } from "../../shared/images";
import { publishedFilesSchema } from "../../shared/published-files";
import type { FileChange, PublishedFile, SessionSnapshot, ToolCall } from "../shared-types";

export type TimelineItem =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly content: string;
      readonly images?: readonly ImageAttachment[];
      readonly reasoning?: string;
      readonly reasoningTruncated?: boolean;
      readonly origin?: "agent_reconciliation";
    }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly call: ToolCall;
      readonly status: "running" | "completed" | "failed" | "unexecuted";
      readonly output: string;
      readonly changes?: readonly FileChange[];
      readonly files?: readonly PublishedFile[];
      /** Measured wall-clock time between the recorded start and finish events. */
      readonly durationMs?: number;
      /** Start timestamp, so the row can show when the action ran. */
      readonly startedAt?: string;
    }
  | {
      readonly kind: "error";
      readonly id: string;
      readonly message: string;
      readonly timestamp: string;
      readonly historical?: boolean;
    };

function isHumanTurn(message: SessionSnapshot["messages"][number]): boolean {
  return message.role === "user" && message.origin !== "agent_reconciliation";
}

/**
 * Measured duration for one tool occurrence. Only real recorded timestamps
 * count: an unparseable or out-of-order pair reports nothing rather than an
 * invented number.
 */
function toolTiming(
  start: { readonly timestamp?: string } | undefined,
  finish: { readonly timestamp?: string } | undefined,
): { readonly durationMs?: number; readonly startedAt?: string } {
  const startedAt = start?.timestamp;
  const finishedAt = finish?.timestamp;
  if (!startedAt || !finishedAt) return startedAt ? { startedAt } : {};
  const from = Date.parse(startedAt);
  const to = Date.parse(finishedAt);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return { startedAt };
  return { startedAt, durationMs: to - from };
}

/** Native message order is authoritative. IDs are only unique within a call occurrence. */
const timelineCache = new WeakMap<SessionSnapshot, readonly TimelineItem[]>();
export function reduceTimeline(
  snapshot: SessionSnapshot,
): readonly TimelineItem[] {
  const cached = timelineCache.get(snapshot);
  if (cached) return cached;
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
      if (message.content || (message.role === "user" && message.images?.length) || (message.role === "assistant" && message.reasoning))
        items.push({
          kind: "message",
          id: `message:${index}`,
          role: message.role,
          content: message.content ?? "",
          ...(message.role === "user" && message.images?.length ? { images: message.images } : {}),
          ...(message.role === "assistant" && message.reasoning
            ? { reasoning: message.reasoning }
            : {}),
          ...(message.role === "assistant" && message.reasoning?.length === 131072
            ? { reasoningTruncated: true }
            : {}),
          // Provider reasoning is display-only, separate from assistant prose.
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
            id: `tool:${call.id}:${occurrence}`,
            call,
            status: finish
              ? finish.result.isError
                ? "failed"
                : "completed"
              : start
                ? "running"
                : "unexecuted",
            output: finish?.result.content ?? "",
            ...toolTiming(start, finish),
            ...(finish?.result.changes?.length
              ? { changes: finish.result.changes }
              : {}),
            ...(finish?.result.files?.length && !finish.result.isError && call.function.name === "publish_file"
              ? { files: finish.result.files }
              : {}),
          });
        }
    } else if (message.role === "tool") {
      const position = pending.get(message.tool_call_id)?.shift();
      const item = position === undefined ? undefined : items[position];
      if (item?.kind !== "tool" || position === undefined) continue;
      // Tool messages are ordinary text; invalid JSON does not imply tool failure.
      let output = message.content ?? "";
      let failed = item.status === "failed";
      let changes: readonly FileChange[] | undefined;
      let files: readonly PublishedFile[] | undefined;
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
          if ("changes" in parsed && Array.isArray(parsed.changes)) {
            // JSON inside message content is not covered by snapshot validation.
            // Migrate old previews here too, and never trust malformed diff rows.
            changes = parsed.changes.slice(0, 256).flatMap((value: unknown) => {
              const change = fileChangeSchema.safeParse(value);
              return change.success ? [change.data] : [];
            });
          }
          if ("isError" in parsed && parsed.isError === false && item.call.function.name === "publish_file" && "files" in parsed && Array.isArray(parsed.files)) {
            const parsedFiles = publishedFilesSchema.safeParse(parsed.files);
            if (parsedFiles.success && parsedFiles.data.length > 0) {
              files = parsedFiles.data;
            }
          }
        }
      } catch {
        /* native tool results may be plain text */
      }
      const { files: _eventFiles, ...messageItem } = item;
      items[position] = {
        ...messageItem,
        output,
        status: failed ? "failed" : "completed",
        ...(changes?.length ? { changes } : {}),
        ...(files?.length ? { files } : {}),
      };
    }
  }
  if (alignedRuns && turn >= 0)
    appendErrors(runStarts[turn] ?? 0, snapshot.events.length);
  // Old error events cannot be positioned against messages. Keep explicitly historical evidence.
  const historical: TimelineItem[] = [];
  snapshot.events.forEach((event, index) => {
    if (event.type === "error" && !placedErrors.has(index))
      historical.push({
        kind: "error",
        id: `error:${index}`,
        message: event.error.message,
        timestamp: event.timestamp,
        historical: true,
      });
  });
  const result: TimelineItem[] = [...historical, ...items];
  // Only the active run may have calls still in transit. Historical/orphan events
  // must not manufacture evidence after a saved final answer. Native messages
  // remain authoritative as soon as they arrive; match occurrences, not just IDs.
  if (snapshot.status === "running" || snapshot.status === "awaiting_approval") {
    const from = runStarts.at(-1) ?? -1;
    const currentMessages = alignedRuns
      ? snapshot.messages.slice(snapshot.messages.findLastIndex(isHumanTurn))
      : snapshot.messages;
    const represented = new Map<string, number>();
    const key = (call: ToolCall) => JSON.stringify(call);
    for (const message of currentMessages)
      if (message.role === "assistant")
        for (const call of message.tool_calls ?? [])
          represented.set(key(call), (represented.get(key(call)) ?? 0) + 1);
    const open = new Map<string, (number | undefined)[]>();
    for (let index = from + 1; index < snapshot.events.length; index++) {
      const event = snapshot.events[index];
      if (!event) continue;
      if (event.type === "tool_started") {
        const count = represented.get(key(event.call)) ?? 0;
        let position: number | undefined;
        if (count) represented.set(key(event.call), count - 1);
        else {
          const occurrence = occurrences.get(event.call.id) ?? 0;
          occurrences.set(event.call.id, occurrence + 1);
          position = result.length;
          result.push({ kind: "tool", id: `tool:${event.call.id}:${occurrence}`,
            call: event.call, status: "running", output: "",
            ...toolTiming(event, undefined) });
        }
        // Include represented starts as queue placeholders so their results can
        // never be consumed by a later same-ID live occurrence.
        const queue = open.get(event.call.id) ?? [];
        queue.push(position);
        open.set(event.call.id, queue);
      } else if (event.type === "tool_finished") {
        const position = open.get(event.toolCallId)?.shift();
        const item = position === undefined ? undefined : result[position];
        if (position === undefined || item?.kind !== "tool") continue;
        result[position] = { ...item, status: event.result.isError ? "failed" : "completed",
          output: event.result.content,
          ...(item.startedAt === undefined
            ? {}
            : toolTiming({ timestamp: item.startedAt }, event)),
          ...(event.result.changes?.length ? { changes: event.result.changes } : {}),
          ...(event.result.files?.length && !event.result.isError && item.call.function.name === "publish_file"
            ? { files: event.result.files }
            : {}) };
      }
    }
  }
  timelineCache.set(snapshot, result);
  return result;
}
