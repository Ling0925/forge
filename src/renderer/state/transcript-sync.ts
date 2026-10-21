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
}

function outputMessages(output: PendingOutput, snapshot: SessionSnapshot) {
  const offset = snapshot.transcript?.messageOffset ?? 0;
  if (output.turn === undefined) return snapshot.messages.slice(Math.max(0, output.afterMessage - offset));
  const turn = executionTurns(snapshot).find(item => item.turn === output.turn);
  if (!turn) return [];
  const steps = turn.events.filter(event => event.type === "step_started");
  const stepIndex = steps.findIndex(event => event.step === output.step);
  const start = stepIndex >= 0 ? steps[stepIndex]?.messageIndex : undefined;
  const end = stepIndex >= 0 ? steps[stepIndex + 1]?.messageIndex : undefined;
  return snapshot.messages.slice(
    Math.max(0, output.afterMessage - offset, start === undefined ? turn.messageStart + 1 : start - offset),
    end === undefined ? turn.messageEnd : end - offset,
  );
}

function messageSaved(output: PendingOutput, snapshot: SessionSnapshot): boolean {
  return outputMessages(output, snapshot).some(message =>
    message.role === "assistant" && (output.toolCallId
      ? message.tool_calls?.some(call => call.id === output.toolCallId) && Boolean(message.content)
      : Boolean(message.content?.startsWith(output.text))),
  );
}

export function retainedOutputs(snapshot: SessionSnapshot): readonly PendingOutput[] {
  const outputs: PendingOutput[] = [];
  for (const turn of executionTurns(snapshot)) {
    if (turn.finish?.status === "completed") continue;
    let step: number | undefined;
    let afterMessage = (snapshot.transcript?.messageOffset ?? 0) + turn.messageEnd;
    const chunks = new Map<number | undefined, PendingOutput>();
    for (const [index, event] of turn.events.entries()) {
      if (event.type === "step_started") {
        step = event.step;
        afterMessage = event.messageIndex;
      } else if (event.type === "retry_reset") {
        chunks.delete(step);
      } else if (event.type === "text_delta") {
        const key = event.step ?? step;
        const previous = chunks.get(key);
        chunks.set(key, {
          id: previous?.id ?? `retained:${turn.turn}:${index}`,
          text: (previous?.text ?? "") + event.text,
          truncated: false,
          afterMessage,
          turn: turn.turn,
          ...(key === undefined ? {} : { step: key }),
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
  return (
    snapshot?.messages
      .slice(Math.max(0, output.afterMessage - (snapshot?.transcript?.messageOffset ?? 0)))
      .some(
        (message) =>
          message.role === "assistant" &&
          Boolean(message.reasoning?.startsWith(output.text)) &&
          (!output.toolCallId ||
            message.tool_calls?.some((call) => call.id === output.toolCallId)),
      ) ?? false
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
