import type { AgentEvent } from "../../shared/schemas";

/**
 * Event types whose arrival means the persisted transcript has advanced, so the
 * renderer must refetch the session snapshot.
 *
 * `run_started` matters: the runtime persists the accepted user turn before it
 * emits `run_started`. Without refreshing here, the message the user just sent
 * would stay invisible until the first tool call or `run_finished`.
 * `approval_requested` is included so a pending card is surfaced promptly.
 */
const REFRESH_EVENT_TYPES = new Set<AgentEvent["type"]>([
  "run_started",
  "step_started",
  "step_finished",
  "title_changed",
  "approval_requested",
  "tool_started",
  "tool_finished",
  "web_search_result",
  "agent_update",
]);

export function shouldRefreshTranscript(type: AgentEvent["type"]): boolean {
  return REFRESH_EVENT_TYPES.has(type);
}
