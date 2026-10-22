import type { SessionSnapshot } from "../shared-types";
import type { TimelineItem } from "./timeline";
import { generationMessage, outputSaved, reasoningSaved, type PendingOutput } from "./transcript-sync";

type MessageItem = Extract<TimelineItem, { kind: "message" }>;

/** Insert within the original turn/step, never after a later user's continuation. */
export function draftPosition(items: readonly TimelineItem[], output: PendingOutput): number {
  if (output.generationId) {
    const same = items.findIndex(item => item.generationId === output.generationId);
    if (same >= 0) return same;
  }
  const position = items.findIndex(item => {
    if (output.turn !== undefined && item.turn !== undefined) {
      if (item.turn < output.turn) return false;
      if (item.turn > output.turn) return true;
      if (output.step !== undefined && item.step !== undefined) {
        if (item.step < output.step) return false;
        if (item.step > output.step) return true;
        if (item.kind === "tool" || item.kind === "error") return true;
      }
      if (item.kind === "error") return true;
    }
    // Legacy tool IDs are only useful with a step/turn scope, never globally.
    if (!output.generationId && output.toolCallId && item.kind === "tool" &&
        item.call.id === output.toolCallId && item.turn === output.turn && item.step === output.step &&
        output.turn !== undefined) return true;
    return item.messageIndex !== undefined && item.messageIndex >= output.afterMessage;
  });
  return position < 0 ? items.length : position;
}

/** Project all channels before stage/turn/tool grouping. Never mutate saved messages. */
export function mergeTranscriptDrafts(
  timeline: readonly TimelineItem[],
  snapshot: SessionSnapshot,
  outputs: readonly PendingOutput[],
  thoughts: readonly PendingOutput[],
): readonly TimelineItem[] {
  if (!outputs.length && !thoughts.length) return timeline;
  const drafts = new Map<string, { anchor: PendingOutput; item: MessageItem }>();
  const add = (output: PendingOutput, reasoning: boolean) => {
    if (!output.text || (reasoning ? reasoningSaved : outputSaved)(output, snapshot)) return;
    const id = output.generationId ? `generation:${output.generationId}` : output.id.replace(/:reasoning$/, "");
    const saved = generationMessage(snapshot, output.generationId);
    const previous = drafts.get(id);
    const item: MessageItem = previous?.item ?? {
      kind: "message", id, role: "assistant", content: "",
      generationId: output.generationId,
      turn: output.turn, step: output.step, messageIndex: output.afterMessage,
    };
    drafts.set(id, { anchor: previous?.anchor ?? output, item: reasoning
      ? { ...item, reasoning: output.text, reasoningTruncated: output.truncated,
          reasoningLive: Boolean(output.live),
          reasoningStatus: output.status === "failed" || output.status === "cancelled"
            ? output.status : saved ? "unconfirmed" : undefined }
      : { ...item, content: output.text, truncated: output.truncated,
          incomplete: !output.live, streaming: Boolean(output.live) },
    });
  };
  for (const output of outputs) add(output, false);
  for (const thought of thoughts) add(thought, true);
  if (!drafts.size) return timeline;
  const result = [...timeline];
  for (const { anchor, item } of drafts.values()) {
    const savedIndex = result.findIndex(entry => entry.kind === "message" && entry.id === item.id);
    const saved = result[savedIndex];
    if (saved?.kind === "message") {
      // A saved channel wins; a missing channel remains explicitly unconfirmed.
      result[savedIndex] = { ...saved,
        ...(!saved.content && item.content ? { content: item.content, incomplete: true, truncated: item.truncated } : {}),
        ...(!saved.reasoning && item.reasoning ? { reasoning: item.reasoning,
          reasoningTruncated: item.reasoningTruncated, reasoningLive: false,
          reasoningStatus: item.reasoningStatus ?? "unconfirmed" } : {}),
      };
    } else {
      result.splice(draftPosition(result, anchor), 0, item);
    }
  }
  return result;
}
