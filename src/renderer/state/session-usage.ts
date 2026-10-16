import type { AgentEvent, ContextUsage, Usage } from "../../shared/schemas";

export function sessionUsage(events: readonly AgentEvent[]) {
  let context: ContextUsage | undefined;
  let latestCache: number | undefined;
  let cacheInput = 0;
  let cacheRead = 0;
  let cacheReports = 0;
  let requests = 0;
  let partial = false;
  const total = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let pending: Usage[] = [];
  let reports = 0;
  const add = (usage: Usage) => {
    total.promptTokens += usage.promptTokens;
    total.completionTokens += usage.completionTokens;
    total.totalTokens += usage.totalTokens;
    reports++;
  };
  for (const event of events) {
    if (event.type === "context_usage") {
      context = event.usage;
      const usage = event.usage;
      if (usage.basis !== "projected" && usage.promptTokens !== undefined) {
        requests++;
        latestCache =
          usage.cachedPromptTokens !== undefined && usage.promptTokens > 0
            ? usage.cachedPromptTokens / usage.promptTokens
            : undefined;
        if (usage.cachedPromptTokens !== undefined) {
          cacheInput += usage.promptTokens;
          cacheRead += usage.cachedPromptTokens;
          cacheReports++;
        }
        pending.push({
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens ?? 0,
          totalTokens: usage.promptTokens + (usage.completionTokens ?? 0),
        });
      }
    }
    if (event.type === "run_finished") {
      if (pending.length === 0 && event.usage) {
        requests++;
        if (event.usage.cachedPromptTokens !== undefined) {
          cacheInput += event.usage.promptTokens;
          cacheRead += event.usage.cachedPromptTokens;
          cacheReports++;
        }
      }
      if (event.usage) add(event.usage);
      else {
        pending.forEach(add);
        partial = true;
      }
      partial ||= event.usageComplete === false;
      pending = [];
    }
  }
  pending.forEach(add);
  return {
    context,
    total: reports ? total : undefined,
    partial,
    latestCache,
    averageCache: cacheInput > 0 ? cacheRead / cacheInput : undefined,
    cacheRead: cacheReports ? cacheRead : undefined,
    cachePartial: cacheReports < requests,
  };
}

export function compactTokens(value: number): string {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
