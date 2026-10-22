import type { SessionSnapshot } from "../shared-types";
import { executionTurns } from "../../shared/execution";
import { retainLoadedPrefix, seedSnapshotUsage } from "./session-pages";

export interface PendingOutput {
  readonly id: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly afterMessage: number;
  readonly toolCallId?: string | undefined;
  readonly turn?: number | undefined;
  readonly step?: number | undefined;
  readonly generationId?: string | undefined;
  readonly live?: boolean | undefined;
  readonly status?: "pending" | "failed" | "cancelled" | undefined;
}

/** Only a unique local identity can acknowledge a generation, never similar text. */
export function generationMessage(snapshot: SessionSnapshot | null, generationId: string | undefined) {
  if (!generationId) return undefined;
  const matches = snapshot?.messages.filter(message => message.role === "assistant" && message.generationId === generationId) ?? [];
  return matches.length === 1 && matches[0]?.role === "assistant" ? matches[0] : undefined;
}

function outputMessages(output: PendingOutput, snapshot: SessionSnapshot) {
  if (output.generationId) {
    const message = generationMessage(snapshot, output.generationId);
    return message ? [message] : [];
  }
  const offset = snapshot.transcript?.messageOffset ?? 0;
  if (output.turn === undefined) {
    if (output.afterMessage < offset || output.afterMessage > offset + snapshot.messages.length) return [];
    return snapshot.messages.slice(output.afterMessage - offset);
  }
  const turn = executionTurns(snapshot).find(item => item.turn === output.turn);
  if (!turn) return [];
  const steps = turn.events.filter(event => event.type === "step_started");
  const stepIndex = steps.findIndex(event => event.step === output.step);
  const start = stepIndex >= 0 ? steps[stepIndex]?.messageIndex : undefined;
  const end = stepIndex >= 0 ? steps[stepIndex + 1]?.messageIndex : undefined;
  return snapshot.messages.slice(
    Math.max(0, start === undefined ? Math.max(output.afterMessage - offset, turn.messageStart + 1) : start - offset),
    end === undefined ? turn.messageEnd : end - offset,
  );
}

function messageSaved(output: PendingOutput, snapshot: SessionSnapshot): boolean {
  return outputMessages(output, snapshot).some(message =>
    message.role === "assistant" && (output.generationId
      ? Boolean(message.content)
      : Boolean(message.content?.startsWith(output.text)) &&
        (!output.toolCallId || message.tool_calls?.some(call => call.id === output.toolCallId))),
  );
}

export function retainedOutputs(snapshot: SessionSnapshot): readonly PendingOutput[] {
  const outputs: PendingOutput[] = [];
  for (const turn of executionTurns(snapshot)) {
    if (turn.finish?.status === "completed") continue;
    let step: number | undefined;
    let afterMessage = (snapshot.transcript?.messageOffset ?? 0) + turn.messageEnd;
    const chunks = new Map<string, PendingOutput>();
    for (const [index, event] of turn.events.entries()) {
      const key = event.generationId ?? `step:${event.step ?? step}`;
      if (event.type === "step_started" || event.type === "generation_started") {
        step = event.step;
        afterMessage = event.messageIndex;
      } else if (event.type === "retry_reset" || (event.type === "generation_finished" && event.status === "superseded")) {
        chunks.delete(key);
      } else if (event.type === "text_delta") {
        const previous = chunks.get(key);
        chunks.set(key, {
          id: event.generationId ? `generation:${event.generationId}` : previous?.id ?? `retained:${turn.turn}:${index}`,
          generationId: event.generationId,
          text: (previous?.text ?? "") + event.text,
          truncated: false,
          afterMessage,
          turn: turn.turn,
          step: event.step ?? step,
          status: turn.finish?.status === "cancelled" ? "cancelled" : "failed",
        });
      }
    }
    for (const output of chunks.values()) {
      if (output.text && !messageSaved(output, snapshot)) outputs.push(output);
    }
  }
  return outputs;
}

export function outputSaved(
  output: PendingOutput,
  snapshot: SessionSnapshot | null,
): boolean {
  if (!snapshot) return false;
  if (messageSaved(output, snapshot)) return true;
  return retainedOutputs(snapshot).some(saved =>
    (output.generationId === undefined || saved.generationId === output.generationId) &&
    (output.turn === undefined
      ? saved.afterMessage === output.afterMessage
      : saved.turn === output.turn) &&
    (output.step === undefined || saved.step === output.step) &&
    saved.text.startsWith(output.text),
  );
}

/** Reasoning is display-only and synchronized independently of assistant prose. */
export function reasoningSaved(
  output: PendingOutput,
  snapshot: SessionSnapshot | null,
): boolean {
  if (!snapshot) return false;
  return outputMessages(output, snapshot).some(message =>
    message.role === "assistant" && (output.generationId
      ? Boolean(message.reasoning)
      : Boolean(message.reasoning?.startsWith(output.text)) &&
        (!output.toolCallId || message.tool_calls?.some(call => call.id === output.toolCallId))),
  );
}

export function mergeTranscript(
  current: SessionSnapshot | null,
  incoming: SessionSnapshot,
  persistedAt: string | null = null,
): SessionSnapshot {
  if (!current || current.id !== incoming.id) return seedSnapshotUsage(incoming);
  if (current.transcript && incoming.transcript && persistedAt && incoming.updatedAt < persistedAt) return current;
  incoming = retainLoadedPrefix(current, incoming);
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
  return seedSnapshotUsage({
    ...incoming,
    messages:
      (persistedAt !== null && incoming.updatedAt < persistedAt) ||
      (current.messages.length > incoming.messages.length &&
        (persistedAt === null || incoming.updatedAt <= persistedAt))
        ? current.messages
        : incoming.messages,
    events: missing.length
      ? [...incoming.events, ...missing].sort((a, b) =>
          (a.timestamp ?? "").localeCompare(b.timestamp ?? ""),
        )
      : incoming.events,
    updatedAt: newerLocal ? current.updatedAt : incoming.updatedAt,
    status: newerLocal ? current.status : incoming.status,
    // A stale read must not drop plans this client already synchronized.
    ...(newerLocal && current.plan ? { plan: current.plan } : {}),
    ...(newerLocal && current.plans ? { plans: current.plans } : {}),
  });
}
