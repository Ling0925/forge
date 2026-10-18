import { expect, it } from "vitest";
import { appendSessionEvent, sessionUsage } from "../../src/renderer/state/session-usage";
import { initialWorkbenchState, workbenchReducer } from "../../src/renderer/state/workbench-reducer";
import { agentEventSchema, parseSessionId, sessionSnapshotSchema } from "../../src/shared/schemas";
import type { AgentEvent } from "../../src/shared/schemas";
import { runIdSchema } from "../../src/shared/ipc";
import type { WorkbenchState } from "../../src/renderer/state/workbench-reducer";

const id = parseSessionId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const stamp = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
const start = (seconds: number) => agentEventSchema.parse({
  type: "run_started", sessionId: id, timestamp: stamp(seconds), model: "test", permission: "readonly",
});
const finish = (seconds: number, completionTokens?: number) => agentEventSchema.parse({
  type: "run_finished", sessionId: id, timestamp: stamp(seconds), status: "completed", turns: 1, toolCalls: 0,
  ...(completionTokens === undefined ? {} : { usage: { promptTokens: 100, completionTokens, totalTokens: 100 + completionTokens }, usageComplete: true }),
});
const report = (seconds: number, completionTokens: number) => agentEventSchema.parse({
  type: "context_usage", sessionId: id, timestamp: stamp(seconds), usage: {
    basis: "request-with-output", estimated: false, windowTokens: 10000, usedTokens: 100 + completionTokens,
    promptTokens: 100, completionTokens, parts: { instructions: 0, memory: 0, conversation: 100, tools: 0 },
  },
});

it("weights all runs by duration, excludes idle gaps and avoids counting reports twice", () => {
  const events = [start(0), report(2, 50), report(4, 150), finish(4, 200), start(3600), finish(3606, 100)];
  const speed = sessionUsage(events).speed;
  expect(speed).toMatchObject({ outputTokens: 300, durationMs: 10000, partial: false });
  const appended = events.reduce<readonly AgentEvent[]>((all, event) => appendSessionEvent(all, event), []);
  expect(sessionUsage(appended).speed).toEqual(speed);
});

it("uses available per-request reports when final usage is missing and exposes live pending usage", () => {
  const events = [start(0), report(1, 40)];
  expect(sessionUsage(events).speed).toMatchObject({ runStartedAt: Date.parse(stamp(0)), pendingTokens: 40 });
  expect(sessionUsage([...events, finish(2)]).speed).toMatchObject({ outputTokens: 40, durationMs: 2000, partial: true, pendingTokens: 0 });
});

it("ignores missing, zero or reversed timing instead of inventing speed or idle duration", () => {
  for (const events of [[finish(1, 50)], [start(1), finish(1, 50)], [start(2), finish(1, 50)], [start(0), finish(1)]]) {
    expect(sessionUsage(events).speed).toMatchObject({ outputTokens: 0, durationMs: 0, runStartedAt: undefined });
  }
  expect(sessionUsage([start(0), start(3600), finish(3602, 20)]).speed).toMatchObject({ outputTokens: 20, durationMs: 2000 });
});

it("tracks live unreported text/reasoning across tools and replaces estimates on reports/retries", () => {
  const runId = runIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  let state: WorkbenchState = { ...initialWorkbenchState, activeSessionId: id, activeSnapshot: sessionSnapshotSchema.parse({
    version: 1, id, title: "test", workspace: "/tmp", model: "test", createdAt: stamp(0), updatedAt: stamp(0),
    status: "running", messages: [], events: [], changes: [],
  }) };
  const send = (event: AgentEvent) => {
    state = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId, event } });
    return state.activeRuns[id]?.unreportedOutputTokens;
  };
  expect(send(start(0))).toBe(0);
  expect(send(agentEventSchema.parse({ type: "text_delta", sessionId: id, timestamp: stamp(1), text: "x".repeat(40) }))).toBe(10);
  expect(send(agentEventSchema.parse({ type: "reasoning_delta", sessionId: id, timestamp: stamp(1), text: "思".repeat(10) }))).toBe(20);
  expect(send(agentEventSchema.parse({ type: "tool_started", sessionId: id, timestamp: stamp(1), call: { id: "tool-1", type: "function", function: { name: "read_file", arguments: "{}" } } }))).toBe(20);
  expect(send(report(2, 30))).toBe(0);
  expect(sessionUsage(state.activeSnapshot!.events).speed.pendingTokens).toBe(30);
  expect(send(agentEventSchema.parse({ type: "text_delta", sessionId: id, timestamp: stamp(3), text: "x".repeat(40) }))).toBe(10);
  expect(send(agentEventSchema.parse({ type: "retry_reset", sessionId: id, timestamp: stamp(3) }))).toBe(0);
  expect(send(finish(4, 40))).toBe(0);
  expect(sessionUsage(state.activeSnapshot!.events).speed.outputTokens).toBe(40);
});
