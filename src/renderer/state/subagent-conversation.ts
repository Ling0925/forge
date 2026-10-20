import type { AgentEvent, SessionSnapshot, SessionStatus } from "../shared-types";
import { executionTurns } from "../../shared/execution";
import { reduceTimeline, type TimelineItem } from "./timeline";
import { outputSaved } from "./transcript-sync";

export type AgentProgress = Extract<AgentEvent, { type: "agent_progress" }>;
export type AgentUpdate = Extract<AgentEvent, { type: "agent_update" }>;
export const CHILD_CONVERSATION_LIMIT = 80;

export function childIsActive(status: SessionStatus): boolean {
  return status === "running" || status === "awaiting_approval";
}

/** Reuse the main transcript's tool/result correlation and draft deduplication.
 * Reasoning, system prompts and internal reconciliation are not this preview. */
export function childConversation(snapshot: SessionSnapshot | null, progress?: AgentProgress) {
  const entries: TimelineItem[] = snapshot
    ? reduceTimeline(snapshot).filter(item => item.kind !== "message" ||
      (item.role === "assistant" && Boolean(item.content.trim())))
    : [];
  let liveId: string | undefined;
  const boundary = snapshot?.events.findLast(event => event.type === "step_started" &&
    event.turn === progress?.childTurn && event.step === progress?.childStep);
  // A new step can stream before its snapshot read finishes. In that window,
  // identical prose from an earlier step is not evidence this draft was saved.
  const afterMessage = progress?.childStep === undefined ? 0 : boundary?.type === "step_started"
    ? boundary.messageIndex : snapshot?.messages.length ?? 0;
  const settled = snapshot && !childIsActive(snapshot.status) && progress && snapshot.updatedAt >= progress.timestamp;
  if (progress?.text && !settled && !outputSaved({
    id: "child-live", text: progress.text, truncated: progress.truncated,
    afterMessage, turn: progress.childTurn, step: progress.childStep,
  }, snapshot)) {
    liveId = `child-live:${progress.childTurn ?? 0}:${progress.childStep ?? 0}`;
    entries.push({ kind: "message", id: liveId, role: "assistant", content: progress.text,
      incomplete: true, truncated: progress.truncated });
  }
  return { entries: entries.slice(-CHILD_CONVERSATION_LIMIT), liveId,
    omitted: Math.max(0, entries.length - CHILD_CONVERSATION_LIMIT) };
}

/** A failed/cancelled run's last commentary must never be called a final report. */
export function childFinalReport(snapshot: SessionSnapshot | null): string {
  if (snapshot?.status !== "completed") return "";
  const turn = executionTurns(snapshot).at(-1);
  const last = snapshot.messages.slice(turn?.messageStart ?? 0).at(-1);
  return last?.role === "assistant" && !last.tool_calls?.length ? last.content ?? "" : "";
}
