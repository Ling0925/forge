import type { SessionSnapshot } from "../shared-types";
import { executionTurns } from "../../shared/execution";
import { sessionUsage } from "./session-usage";

export interface CompletedTurnExecution {
  readonly finalMessageId: string;
  readonly duration: string;
  readonly speed: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function completedTurnExecutions(
  snapshot: SessionSnapshot,
): readonly (CompletedTurnExecution | undefined)[] {
  const turns = executionTurns(snapshot);
  if (turns.every(turn => turn.events.length === 0)) return [];
  return turns.map(({ messageStart, messageEnd, events, finish }) => {
    if (finish?.status !== "completed") return undefined;
    const finalIndex = messageEnd - 1;
    const final = snapshot.messages[finalIndex];
    // Wait for the persisted final reply, not a tool-calling commentary or draft.
    if (finalIndex <= messageStart || final?.role !== "assistant" ||
        !final.content || final.tool_calls?.length) return undefined;

    const durationMs = Date.parse(finish.timestamp) - Date.parse(events[0]?.timestamp ?? "");
    const speed = sessionUsage(events).speed;
    const rate = speed.durationMs > 0 ? speed.outputTokens * 1000 / speed.durationMs : 0;
    return {
      finalMessageId: `message:${finalIndex}`,
      duration: Number.isFinite(durationMs) && durationMs >= 0 ? formatDuration(durationMs) : "—",
      speed: Number.isFinite(rate) && rate > 0
        ? `${speed.partial ? "≈ " : ""}${rate < 10 ? rate.toFixed(1) : Math.round(rate)} tok/s`
        : "— tok/s",
    };
  });
}
