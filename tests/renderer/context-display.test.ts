import { expect, it } from "vitest";
import { advanceContextDisplay, emptyContextDisplay, replayContextDisplay } from "../../src/shared/context-display";
import { agentEventSchema, type AgentEvent } from "../../src/shared/schemas";
import { appendSessionEvent, sessionUsage } from "../../src/renderer/state/session-usage";
import { contextFooter } from "../../src/cli/terminal/context-footer";

const base = { sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", timestamp: "2026-01-01T00:00:00Z" };
const projection = (tokens: number, windowTokens = 300000) => agentEventSchema.parse({ ...base, type: "context_usage", usage: {
  usedTokens: tokens, windowTokens, estimated: true, basis: "projected", parts: { instructions: 0, memory: 0, conversation: tokens, tools: 0 },
} });
const report = (tokens: number, output = 10000) => agentEventSchema.parse({ ...base, type: "context_usage", usage: {
  usedTokens: tokens + output, promptTokens: tokens, completionTokens: output, cachedPromptTokens: tokens / 2,
  windowTokens: 300000, estimated: true, basis: "request-with-output", parts: { instructions: 0, memory: 0, conversation: tokens + output, tools: 0 },
} });
const compacted = agentEventSchema.parse({ ...base, type: "context_compacted", removedMessages: 10, beforeChars: 800000, afterChars: 100000 });
const start = (model: string) => agentEventSchema.parse({ ...base, type: "run_started", model, permission: "readonly" });

it("holds 200K input reports across 120K estimates without counting output or changing billing totals", () => {
  let events: readonly AgentEvent[] = [];
  let state = emptyContextDisplay();
  const sequence = [projection(120000), report(200000), projection(121000), report(201000), projection(122000)];
  const counts = [120000, 200000, 200000, 201000, 201000];
  sequence.forEach((event, index) => {
    state = advanceContextDisplay(state, event);
    events = appendSessionEvent(events, event);
    expect(state.context?.usedTokens).toBe(counts[index]);
    expect(sessionUsage(events).context).toEqual(state.context);
    expect(sessionUsage([...events])).toEqual(sessionUsage(events));
  });
  expect(state.projected?.usedTokens).toBe(122000);
  expect(state.context).toMatchObject({ estimated: false, basis: "request" });
  expect(replayContextDisplay(events)).toEqual(state);
  expect(sessionUsage(events).total).toEqual({ promptTokens: 401000, completionTokens: 20000, totalTokens: 421000 });
  expect(sessionUsage(events).latestCache).toBe(0.5);
  const footer = contextFooter({ model: "model", usage: state.context! }, 100)[0]!.map(s => s.text).join("");
  expect(footer).toContain("实报输入 67.0%");
  expect(footer).not.toContain("≈67.0%");
  const wide = contextFooter({ model: "model", usage: state.context!, projectedTokens: 122000 }, 140)[0]!.map(s => s.text).join("");
  expect(wide).toContain("本地≈122k");
  expect(wide).toContain("实报输入 67.0%");
});

it("shows real compaction immediately and resumes reports afterwards without resetting totals", () => {
  const old = [projection(120000), report(200000)];
  const before = sessionUsage(old);
  const cleared = appendSessionEvent(old, compacted);
  expect(sessionUsage(cleared)).toMatchObject({ compacted: true, context: undefined, projected: undefined });
  const after = appendSessionEvent(cleared, projection(30000));
  expect(sessionUsage(after)).toMatchObject({ compacted: true, context: { usedTokens: 30000, estimated: true } });
  expect(sessionUsage(after).total).toEqual(before.total);
  expect(before.context?.usedTokens).toBe(200000);
  expect(contextFooter({ model: "model", usage: sessionUsage(after).context!, compacted: true }, 100)[0]!.map(s => s.text).join("")).toContain("压缩后预估");
  const measured = appendSessionEvent(after, report(45000));
  expect(sessionUsage(measured)).toMatchObject({ compacted: false, context: { usedTokens: 45000, estimated: false } });
});

it("handles missing reports, same-model new runs, changed models/windows and old input-only events", () => {
  const old = [start("a"), report(200000)];
  expect(replayContextDisplay([...old, start("a"), projection(120000)]).context?.usedTokens).toBe(200000);
  expect(replayContextDisplay([...old, start("b"), projection(120000)]).context?.usedTokens).toBe(120000);
  expect(replayContextDisplay([...old, projection(120000, 1000000)]).context?.windowTokens).toBe(1000000);
  expect(replayContextDisplay([projection(120000), projection(125000)]).context?.usedTokens).toBe(125000);
  const event = report(0, 50000);
  expect(replayContextDisplay([event]).context).toMatchObject({ usedTokens: 0, estimated: false });
  if (event.type !== "context_usage") throw Error("fixture");
  const inputOnly = { ...event, usage: { ...event.usage, basis: "request" as const, promptTokens: 100, usedTokens: 100, estimated: false } };
  expect(replayContextDisplay([inputOnly]).context).toEqual(inputOnly.usage);
});
