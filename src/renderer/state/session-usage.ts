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

function accumulate(state: UsageState, event: AgentEvent) {
  state.display = advanceContextDisplay(state.display, event);
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
  if (event.type !== "context_usage" && event.type !== "run_finished" && event.type !== "context_compacted" && event.type !== "run_started")
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
