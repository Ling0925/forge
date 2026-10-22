import { fileChangeSchema } from "../../shared/schemas";
import { executionTurns } from "../../shared/execution";
import type { ImageAttachment } from "../../shared/images";
import { publishedFilesSchema } from "../../shared/published-files";
import type { ErrorInfo, FileChange, PublishedFile, SessionSnapshot, ToolCall } from "../shared-types";
import { retainedOutputs, type PendingOutput } from "./transcript-sync";
import { draftPosition, mergeTranscriptDrafts } from "./timeline-drafts";

export type TimelineItem = {
  readonly turn?: number | undefined; readonly step?: number | undefined;
  readonly messageIndex?: number; readonly generationId?: string | undefined;
} & (
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly content: string;
      readonly webSearchDetails?: string;
      readonly images?: readonly ImageAttachment[];
      readonly reasoning?: string;
      readonly reasoningTruncated?: boolean | undefined;
      readonly reasoningLive?: boolean;
      readonly reasoningStatus?: "failed" | "cancelled" | "unconfirmed" | undefined;
      readonly streaming?: boolean;
      readonly origin?: "agent_reconciliation";
      readonly incomplete?: boolean;
      readonly truncated?: boolean | undefined;
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
      readonly error?: ErrorInfo;
      readonly timestamp: string;
      readonly historical?: boolean;
    }
  | {
      readonly kind: "hook_diagnostic";
      readonly id: string;
      readonly hook: "beforeTool" | "afterTool" | "toolError" | "runEnd";
      readonly hookId: string;
      readonly status: "denied" | "failed" | "timed_out" | "cancelled";
      readonly reason?: string;
      readonly exitCode?: number;
      readonly durationMs: number;
      readonly toolCallId?: string;
      readonly timestamp: string;
      readonly historical?: boolean;
    });

function isHookDiagnostic(
  status: string,
): status is "denied" | "failed" | "timed_out" | "cancelled" {
  return ["denied", "failed", "timed_out", "cancelled"].includes(status);
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

function insertOutputs(
  timeline: readonly TimelineItem[],
  outputs: readonly PendingOutput[],
): readonly TimelineItem[] {
  if (!outputs.length) return timeline;
  const result = [...timeline];
  for (const output of outputs) {
    const index = draftPosition(result, output);
    result.splice(index, 0, {
      kind: "message", id: output.id, role: "assistant", content: output.text,
      generationId: output.generationId, messageIndex: output.afterMessage,
      incomplete: true, truncated: output.truncated,
      ...(output.turn === undefined ? {} : { turn: output.turn }),
      ...(output.step === undefined ? {} : { step: output.step }),
    });
  }
  return result;
}

/** Native message order is authoritative. IDs are only unique within a call occurrence. */
const timelineCache = new WeakMap<SessionSnapshot, readonly TimelineItem[]>();
export function reduceTimeline(
  snapshot: SessionSnapshot,
  pendingOutputs: readonly PendingOutput[] = [],
  pendingReasoning: readonly PendingOutput[] = [],
): readonly TimelineItem[] {
  const cached = timelineCache.get(snapshot);
  if (cached) return mergeTranscriptDrafts(cached, snapshot, pendingOutputs, pendingReasoning);
  const items: TimelineItem[] = [];
  const messageOffset = snapshot.transcript?.messageOffset ?? 0;
  const eventOffset = snapshot.transcript?.eventOffset ?? 0;
  const turns = executionTurns(snapshot);
  const positions = new Map<number, { readonly turn: number; readonly step?: number }>();
  for (const turn of turns) {
    const steps = turn.events.filter(event => event.type === "step_started");
    let cursor = 0;
    let step: number | undefined;
    for (let index = turn.messageStart; index < turn.messageEnd; index++) {
      while (cursor < steps.length) {
        const start = steps[cursor];
        if (!start || start.messageIndex > messageOffset + index) break;
        step = start.step;
        cursor++;
      }
      positions.set(index, { turn: turn.turn, ...(step === undefined ? {} : { step }) });
    }
  }
  const pending = new Map<string, number[]>();
  const runStarts = snapshot.events.flatMap((event, index) =>
    event.type === "run_started" ? [index] : [],
  );
  const alignedRuns = turns.length > 0 && turns.every(turn => turn.events.length > 0);
  let turn = -1;
  const placedErrors = new Set<number>();
  const placedDiagnostics = new Set<number>();
  const appendErrors = (from: number, to: number) => {
    snapshot.events.slice(from, to).forEach((event, offset) => {
      const index = from + offset;
      if (event.type === "error") {
        const errorTurn = event.turn ?? turns[turn]?.turn;
        placedErrors.add(index);
        items.push({
          kind: "error",
          id: `error:${eventOffset + index}`,
          message: event.error.message, error: event.error,
          timestamp: event.timestamp,
          ...(errorTurn === undefined ? {} : { turn: errorTurn }),
          ...(event.step === undefined ? {} : { step: event.step }),
        });
      } else if (
        event.type === "tool_hook" &&
        isHookDiagnostic(event.diagnostic.status)
      ) {
        placedDiagnostics.add(index);
        items.push({
          kind: "hook_diagnostic",
          id: `hook:${eventOffset + index}`,
          hook: event.diagnostic.hook,
          hookId: event.diagnostic.id,
          status: event.diagnostic.status,
          ...(event.diagnostic.reason !== undefined ? { reason: event.diagnostic.reason } : {}),
          ...(event.diagnostic.exitCode !== undefined ? { exitCode: event.diagnostic.exitCode } : {}),
          durationMs: event.diagnostic.durationMs,
          ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}),
          timestamp: event.timestamp,
          ...(event.turn === undefined ? {} : { turn: event.turn }),
          ...(event.step === undefined ? {} : { step: event.step }),
        });
      }
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
    if (turns[turn + 1]?.messageStart === index) {
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
      if (message.role === "assistant" && (message.webSearches?.length || message.citations?.length)) {
        if (message.webSearches?.length) {
          for (const [searchIndex, search] of message.webSearches.entries()) {
            const target =
              search.action === "search"
                ? search.queries?.join("; ") || ""
                : (search.action === "open_page" || (search.action as string) === "open_url")
                  ? search.url || ""
                  : [search.url, search.pattern].filter(Boolean).join(" · ");
            const status =
              search.status === "failed"
                ? "failed"
                : search.status === "completed"
                  ? "completed"
                  : "running";
            items.push({
              kind: "tool",
              id: message.generationId
                ? `generation:${message.generationId}:web_search:${searchIndex}`
                : `tool:web_search:${search.id || searchIndex}:message:${messageOffset + index}`,
              generationId: message.generationId,
              messageIndex: messageOffset + index,
              ...positions.get(index),
              call: {
                id: search.id || `web_search_${searchIndex}`,
                type: "function",
                function: {
                  name: "web_search",
                  arguments: JSON.stringify({
                    action: search.action,
                    query: target,
                    ...(search.queries?.length ? { queries: search.queries } : {}),
                    ...(search.url ? { url: search.url } : {}),
                    ...(search.pattern ? { pattern: search.pattern } : {}),
                  }),
                },
              },
              status,
              output: JSON.stringify({
                action: search.action,
                target,
                sources: search.sources ?? [],
                ...(searchIndex === message.webSearches.length - 1 && message.citations?.length
                  ? { citations: message.citations }
                  : {}),
              }),
            });
          }
        } else if (message.citations?.length) {
          items.push({
            kind: "tool",
            id: message.generationId
              ? `generation:${message.generationId}:web_search:citations`
              : `tool:web_search:citations:message:${messageOffset + index}`,
            generationId: message.generationId,
            messageIndex: messageOffset + index,
            ...positions.get(index),
            call: {
              id: `web_search_citations_${index}`,
              type: "function",
              function: {
                name: "web_search",
                arguments: JSON.stringify({
                  action: "search",
                  query: message.citations.map((c) => c.title || c.url).slice(0, 3).join("; "),
                }),
              },
            },
            status: "completed",
            output: JSON.stringify({
              action: "search",
              sources: message.citations.map((c) => c.url),
              citations: message.citations,
            }),
          });
        }
      }
      const shouldPushMessage = Boolean(
        message.content ||
        (message.role === "user" && message.images?.length) ||
        (message.role === "assistant" && message.reasoning)
      );
      if (shouldPushMessage)
        items.push({
          kind: "message",
          id: message.role === "assistant" && message.generationId ? `generation:${message.generationId}` : `message:${messageOffset + index}`,
          ...(message.role === "assistant" && message.generationId ? { generationId: message.generationId } : {}),
          messageIndex: messageOffset + index,
          ...positions.get(index),
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
        for (const [callIndex, call] of (message.tool_calls ?? []).entries()) {
          const occurrence = occurrences.get(call.id) ?? 0;
          occurrences.set(call.id, occurrence + 1);
          const runEvents =
            turns[turn]?.events.length
              ? turns[turn]?.events
              : null;
          const scopedStarts =
            runEvents?.filter((e) => e.type === "tool_started") ?? starts;
          const scopedFinishes =
            runEvents?.filter((e) => e.type === "tool_finished") ?? finishes;
          const matchingStarts = scopedStarts.filter(
            (e) => e.call.id === call.id && (!message.generationId || (e.generationId === message.generationId && e.callIndex === callIndex)),
          );
          const matchingFinishes = scopedFinishes.filter(
            (e) => e.toolCallId === call.id && (!message.generationId || (e.generationId === message.generationId && e.callIndex === callIndex)),
          );
          const total = runEvents
            ? snapshot.messages
                .slice(
                  turns[turn]?.messageStart,
                  turns[turn]?.messageEnd,
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
                  turns[turn]?.messageStart,
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
          const start = message.generationId
            ? matchingStarts.length === 1 ? matchingStarts[0] : undefined
            : matchingStarts.length === total
              ? matchingStarts[localOccurrence]
              : finalUnresolved &&
                  matchingStarts.length > matchingFinishes.length
                ? matchingStarts.at(-1)
                : undefined;
          const finish = message.generationId
            ? matchingFinishes.length === 1 ? matchingFinishes[0] : undefined
            : matchingFinishes.length === total
              ? matchingFinishes[localOccurrence]
              : undefined;
          pending.set(call.id, [...(pending.get(call.id) ?? []), items.length]);
          items.push({
            kind: "tool",
            id: message.generationId ? `generation:${message.generationId}:tool:${callIndex}` : snapshot.transcript ? `tool:${call.id}:message:${messageOffset + index}` : `tool:${call.id}:${occurrence}`,
            generationId: message.generationId,
            messageIndex: messageOffset + index,
            ...positions.get(index),
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
  const anchoredErrors: TimelineItem[] = [];
  snapshot.events.forEach((event, index) => {
    if (event.type === "error" && !placedErrors.has(index)) {
      (event.turn === undefined ? historical : anchoredErrors).push({
        kind: "error",
        id: `error:${eventOffset + index}`,
        message: event.error.message, error: event.error,
        timestamp: event.timestamp,
        ...(event.turn === undefined ? { historical: true } : { turn: event.turn }),
        ...(event.step === undefined ? {} : { step: event.step }),
      });
    } else if (
      event.type === "tool_hook" &&
      isHookDiagnostic(event.diagnostic.status) &&
      !placedDiagnostics.has(index)
    ) {
      (event.turn === undefined ? historical : anchoredErrors).push({
        kind: "hook_diagnostic",
        id: `hook:${eventOffset + index}`,
        hook: event.diagnostic.hook,
        hookId: event.diagnostic.id,
        status: event.diagnostic.status,
        ...(event.diagnostic.reason !== undefined ? { reason: event.diagnostic.reason } : {}),
        ...(event.diagnostic.exitCode !== undefined ? { exitCode: event.diagnostic.exitCode } : {}),
        durationMs: event.diagnostic.durationMs,
        ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}),
        timestamp: event.timestamp,
        ...(event.turn === undefined ? { historical: true } : { turn: event.turn }),
        ...(event.step === undefined ? {} : { step: event.step }),
      });
    }
  });
  const result: TimelineItem[] = [...historical, ...items];
  // Only the active run may have calls still in transit. Historical/orphan events
  // must not manufacture evidence after a saved final answer. Native messages
  // remain authoritative as soon as they arrive; match occurrences, not just IDs.
  if (snapshot.status === "running" || snapshot.status === "awaiting_approval") {
    const from = runStarts.at(-1) ?? -1;
    const currentMessages = alignedRuns
      ? snapshot.messages.slice(turns.at(-1)?.messageStart)
      : snapshot.messages;
    const represented = new Map<string, number>();
    const key = (call: ToolCall, generationId?: string, callIndex?: number) => generationId ? `${generationId}:${callIndex}` : JSON.stringify(call);
    for (const message of currentMessages)
      if (message.role === "assistant")
        for (const [callIndex, call] of (message.tool_calls ?? []).entries()) {
          const identity = key(call, message.generationId, callIndex);
          represented.set(identity, (represented.get(identity) ?? 0) + 1);
        }
    const open = new Map<string, (number | undefined)[]>();
    for (let index = from + 1; index < snapshot.events.length; index++) {
      const event = snapshot.events[index];
      if (!event) continue;
      if (event.type === "tool_started") {
        const identity = key(event.call, event.generationId, event.callIndex);
        const count = represented.get(identity) ?? 0;
        let position: number | undefined;
        if (count) represented.set(identity, count - 1);
        else {
          const occurrence = occurrences.get(event.call.id) ?? 0;
          occurrences.set(event.call.id, occurrence + 1);
          position = result.length;
          result.push({ kind: "tool", id: event.generationId ? `generation:${event.generationId}:tool:${event.callIndex}` : `tool:${event.call.id}:${occurrence}`,
            generationId: event.generationId,
            ...(event.turn === undefined ? {} : { turn: event.turn }),
            ...(event.step === undefined ? {} : { step: event.step }),
            call: event.call, status: "running", output: "",
            ...toolTiming(event, undefined) });
        }
        // Include represented starts as queue placeholders so their results can
        // never be consumed by a later same-ID live occurrence.
        const occurrenceKey = event.generationId ? `${event.generationId}:${event.callIndex}` : event.call.id;
        const queue = open.get(occurrenceKey) ?? [];
        queue.push(position);
        open.set(occurrenceKey, queue);
      } else if (event.type === "tool_finished") {
        const occurrenceKey = event.generationId ? `${event.generationId}:${event.callIndex}` : event.toolCallId;
        const position = open.get(occurrenceKey)?.shift();
        const item = position === undefined ? undefined : result[position];
        if (position === undefined || item?.kind !== "tool" || item.call.id !== event.toolCallId) continue;
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
  for (const error of anchoredErrors) {
    const last = result.findLastIndex(item => item.turn === error.turn);
    result.splice(last < 0 ? result.length : last + 1, 0, error);
  }
  const restored = insertOutputs(result, retainedOutputs(snapshot));
  timelineCache.set(snapshot, restored);
  return mergeTranscriptDrafts(restored, snapshot, pendingOutputs, pendingReasoning);
}
