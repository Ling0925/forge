import type { AgentEvent, SessionSnapshot } from "../shared-types";
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

/** Only correlate complete, one-to-one run/turn histories; never guess old usage. */
export function completedTurnExecutions(
  snapshot: SessionSnapshot,
): readonly (CompletedTurnExecution | undefined)[] {
  const users = snapshot.messages.flatMap((message, index) =>
    message.role === "user" && !message.origin ? [index] : [],
  );
  const starts = snapshot.events.flatMap((event, index) =>
    event.type === "run_started" ? [index] : [],
  );
  if (users.length !== starts.length) return [];

  return users.map((userIndex, turn) => {
    const events = snapshot.events.slice(starts[turn], starts[turn + 1]);
    const finish = events.find(
      (event): event is Extract<AgentEvent, { type: "run_finished" }> =>
        event.type === "run_finished",
    );
    if (finish?.status !== "completed") return undefined;
    const end = users[turn + 1] ?? snapshot.messages.length;
    const finalIndex = end - 1;
    const final = snapshot.messages[finalIndex];
    // Wait for the persisted final reply, not a tool-calling commentary or draft.
    if (finalIndex <= userIndex || final?.role !== "assistant" ||
        !final.content || final.tool_calls?.length) return undefined;

    const durationMs = Date.parse(finish.timestamp) - Date.parse(events[0]!.timestamp);
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
