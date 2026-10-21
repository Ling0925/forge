import type { AgentEvent, Usage } from "../../shared/schemas";
import { advanceContextDisplay, emptyContextDisplay } from "../../shared/context-display";

type Totals = Pick<Usage, "promptTokens" | "completionTokens" | "totalTokens">;
const emptyTotals = (): Totals => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});
const add = (a: Totals, b: Totals): Totals => ({
  promptTokens: a.promptTokens + b.promptTokens,
  completionTokens: a.completionTokens + b.completionTokens,
  totalTokens: a.totalTokens + b.totalTokens,
});

function emptyState() {
  return {
    display: emptyContextDisplay(),
    speedTokens: 0,
    speedDurationMs: 0,
    speedPartial: false,
    request: undefined as { key: string; startedAt: number } | undefined,
    runHasRequests: false,
    latestCache: undefined as number | undefined,
    cacheInput: 0,
    cacheRead: 0,
    cacheReports: 0,
    requests: 0,
    partial: false,
    total: emptyTotals(),
    pending: emptyTotals(),
    pendingReports: 0,
    reports: 0,
  };
}
type UsageState = ReturnType<typeof emptyState>;

const requestBoundaries = new Set([
  "run_started", "run_finished", "step_started", "step_finished", "tool_started", "approval_requested",
]);

function accumulateSpeed(state: UsageState, event: AgentEvent) {
  // Attempt numbers restart at every step/run. Never carry an unmatched request
  // into tools, approval, another step or an idle gap in an interrupted transcript.
  if (requestBoundaries.has(event.type)) {
    state.speedPartial ||= state.request !== undefined;
    state.request = undefined;
  }
  if (event.type === "run_started") state.runHasRequests = false;
  if (event.type === "run_finished") {
    state.speedPartial ||= event.usageComplete === false ||
      (!state.runHasRequests && (event.turns > 0 || state.pendingReports > 0));
  }
  if (event.type !== "provider_attempt") return;
  state.runHasRequests = true;
  const selection = event.selection;
  const key = JSON.stringify([
    event.sessionId, event.turn, event.step, selection.attempt,
    selection.groupId, selection.sourceId, selection.credentialId, selection.model, selection.apiMode,
  ]);
  const timestamp = Date.parse(selection.timestamp);
  if (selection.outcome === "started") {
    state.speedPartial ||= state.request !== undefined || !Number.isFinite(timestamp);
    state.request = Number.isFinite(timestamp) ? { key, startedAt: timestamp } : undefined;
    return;
  }
  const duration = state.request?.key === key ? timestamp - state.request.startedAt : NaN;
  if (state.request?.key === key) state.request = undefined;
  const output = selection.usage?.completionTokens;
  // Match the numerator and denominator to the same measured requests. Missing
  // usage/timing is unknown, not zero, and run wall time is never a substitute.
  if (Number.isFinite(duration) && duration > 0 && output !== undefined &&
      Number.isFinite(output) && output >= 0) {
    state.speedTokens += output;
    state.speedDurationMs += duration;
  } else {
    state.speedPartial = true;
  }
}

function accumulate(state: UsageState, event: AgentEvent) {
  state.display = advanceContextDisplay(state.display, event);
  accumulateSpeed(state, event);
  if (event.type === "run_started") {
    state.pending = emptyTotals();
    state.pendingReports = 0;
  }
  if (event.type === "context_usage") {
    const usage = event.usage;
    if (usage.basis !== "projected" && usage.promptTokens !== undefined) {
      state.requests++;
      state.latestCache =
        usage.cachedPromptTokens !== undefined && usage.promptTokens > 0
          ? usage.cachedPromptTokens / usage.promptTokens
          : undefined;
      if (usage.cachedPromptTokens !== undefined) {
        state.cacheInput += usage.promptTokens;
        state.cacheRead += usage.cachedPromptTokens;
        state.cacheReports++;
      }
      state.pending = add(state.pending, {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens ?? 0,
        totalTokens: usage.promptTokens + (usage.completionTokens ?? 0),
      });
      state.pendingReports++;
    }
  }
  if (event.type === "run_finished") {
    if (state.pendingReports === 0 && event.usage) {
      state.requests++;
      if (event.usage.cachedPromptTokens !== undefined) {
        state.cacheInput += event.usage.promptTokens;
        state.cacheRead += event.usage.cachedPromptTokens;
        state.cacheReports++;
      }
    }
    state.total = add(state.total, event.usage ?? state.pending);
    state.reports += event.usage ? 1 : state.pendingReports;
    state.partial ||= !event.usage || event.usageComplete === false;
    state.pending = emptyTotals();
    state.pendingReports = 0;
  }
}

function summarize(state: UsageState) {
  return {
    context: state.display.context,
    projected: state.display.projected,
    compacted: state.display.compacted,
    total:
      state.reports + state.pendingReports
        ? add(state.total, state.pending)
        : undefined,
    partial: state.partial,
    latestCache: state.latestCache,
    averageCache:
      state.cacheInput > 0 ? state.cacheRead / state.cacheInput : undefined,
    cacheRead: state.cacheReports ? state.cacheRead : undefined,
    cachePartial: state.cacheReports < state.requests,
    speed: {
      outputTokens: state.speedTokens,
      durationMs: state.speedDurationMs,
      partial: state.speedPartial,
      requestStartedAt: state.request?.startedAt,
    },
  };
}

// Event arrays are immutable snapshots. Weak keys release cached data with the snapshot.
const cache = new WeakMap<
  readonly AgentEvent[],
  { state: UsageState; result: ReturnType<typeof summarize> }
>();
function entry(events: readonly AgentEvent[]) {
  const existing = cache.get(events);
  if (existing) return existing;
  const state = emptyState();
  for (const event of events) accumulate(state, event);
  const value = { state, result: summarize(state) };
  cache.set(events, value);
  return value;
}

export function sessionUsage(events: readonly AgentEvent[]) {
  return entry(events).result;
}

/** The reducer owns append provenance; fetched/replaced arrays always get a fresh scan. */
export function appendSessionEvent(
  events: readonly AgentEvent[],
  event: AgentEvent,
): readonly AgentEvent[] {
  const previous = entry(events);
  const next = [...events, event];
  if (event.type !== "context_usage" && event.type !== "context_compacted" &&
      event.type !== "provider_attempt" && !requestBoundaries.has(event.type))
    cache.set(next, previous);
  else {
    const state = { ...previous.state };
    accumulate(state, event);
    cache.set(next, { state, result: summarize(state) });
  }
  return next;
}

const tokenFormatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export function compactTokens(value: number): string {
  return tokenFormatter.format(value);
}
