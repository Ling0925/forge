import { expect, it } from "vitest";
import { appendSessionEvent, sessionUsage } from "../../src/renderer/state/session-usage";
import { initialWorkbenchState, workbenchReducer } from "../../src/renderer/state/workbench-reducer";
import { agentEventSchema, parseSessionId, sessionSnapshotSchema } from "../../src/shared/schemas";
import type { AgentEvent } from "../../src/shared/schemas";
import { runIdSchema } from "../../src/shared/ipc";
import type { WorkbenchState } from "../../src/renderer/state/workbench-reducer";

type AttemptEvent = Extract<AgentEvent, { type: "provider_attempt" }>;
const id = parseSessionId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const stamp = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
const start = (seconds: number) => agentEventSchema.parse({
  type: "run_started", sessionId: id, timestamp: stamp(seconds), model: "test", permission: "readonly",
});
const finish = (seconds: number, completionTokens?: number) => agentEventSchema.parse({
  type: "run_finished", sessionId: id, timestamp: stamp(seconds), status: "completed", turns: 1, toolCalls: 0,
  ...(completionTokens === undefined ? {} : { usage: { promptTokens: 100, completionTokens, totalTokens: 100 + completionTokens }, usageComplete: true }),
});
const attempt = (seconds: number, outcome: AttemptEvent["selection"]["outcome"], completionTokens?: number): AttemptEvent => ({
  type: "provider_attempt", sessionId: id, timestamp: stamp(seconds),
  selection: { sourceId: "test", model: "test", apiMode: "responses", attempt: 0, reason: "direct", outcome, timestamp: stamp(seconds),
    ...(completionTokens === undefined ? {} : { usage: { promptTokens: 100, completionTokens, totalTokens: 100 + completionTokens } }),
  },
});
const report = (seconds: number, completionTokens: number) => agentEventSchema.parse({
  type: "context_usage", sessionId: id, timestamp: stamp(seconds), usage: {
    basis: "request-with-output", estimated: false, windowTokens: 10000, usedTokens: 100 + completionTokens,
    promptTokens: 100, completionTokens, parts: { instructions: 0, memory: 0, conversation: 100, tools: 0 },
  },
});
const tool = (seconds: number) => agentEventSchema.parse({
  type: "tool_started", sessionId: id, timestamp: stamp(seconds),
  call: { id: "tool-1", type: "function", function: { name: "wait_agents", arguments: "{}" } },
});

it("weights requests across runs, excluding tool/child/approval/idle time and duplicate usage reports", () => {
  const events = [
    start(0), attempt(1, "started"), attempt(3, "succeeded", 50), report(3, 50), tool(3),
    agentEventSchema.parse({ type: "state_changed", sessionId: id, timestamp: stamp(50), status: "awaiting_approval" }),
    agentEventSchema.parse({ type: "state_changed", sessionId: id, timestamp: stamp(100), status: "running" }),
    attempt(101, "started"), attempt(103, "succeeded", 150), report(103, 150),
    { ...finish(200, 200), childUsage: { promptTokens: 100, completionTokens: 9000, totalTokens: 9100 } } as AgentEvent,
    start(3600), attempt(3601, "started"), attempt(3607, "succeeded", 100), finish(4000, 100),
  ];
  const speed = sessionUsage(events).speed;
  expect(speed).toEqual({ outputTokens: 300, durationMs: 10000, partial: false, requestStartedAt: undefined });
  const appended = events.reduce<readonly AgentEvent[]>((all, event) => appendSessionEvent(all, event), []);
  expect(sessionUsage(appended).speed).toEqual(speed);
  expect(sessionUsage(events).total?.completionTokens).toBe(300);
});

it("settles each request immediately using provider usage, without waiting for context or run totals", () => {
  const events = [start(0), attempt(10, "started")];
  const pending = sessionUsage(events);
  expect(pending.speed).toMatchObject({ requestStartedAt: Date.parse(stamp(10)), outputTokens: 0 });
  const settled = appendSessionEvent(events, attempt(12, "succeeded", 40));
  expect(sessionUsage(settled).speed).toMatchObject({ outputTokens: 40, durationMs: 2000, partial: false, requestStartedAt: undefined });
  // Cached prefixes remain immutable when a result arrives.
  expect(pending.speed.requestStartedAt).toBe(Date.parse(stamp(10)));
  expect(sessionUsage([...settled, report(12, 40), finish(100)]).speed).toEqual(sessionUsage(settled).speed);
});

it("does not invent request timing from legacy run totals or missing, zero, reversed timestamps", () => {
  for (const events of [
    [start(0), report(2, 50), finish(100, 50)],
    [attempt(1, "succeeded", 50)],
    [attempt(1, "started"), attempt(1, "succeeded", 50)],
    [attempt(2, "started"), attempt(1, "succeeded", 50)],
    [attempt(0, "started"), { ...attempt(1, "succeeded", 50), selection: { ...attempt(1, "succeeded", 50).selection, timestamp: "invalid" } }],
    [{ ...attempt(0, "started"), selection: { ...attempt(0, "started").selection, timestamp: "invalid" } }, attempt(1, "succeeded", 50)],
  ]) {
    expect(sessionUsage(events).speed).toEqual({ outputTokens: 0, durationMs: 0, partial: true, requestStartedAt: undefined });
  }
});

it("pairs by route, attempt, turn and step, using provider timestamps rather than delivery timestamps", () => {
  const begun = { ...attempt(0, "started"), turn: 1, step: 1 };
  const done = { ...attempt(2, "succeeded", 40), turn: 1, step: 1 };
  for (const mismatch of [
    { ...done, turn: 2 }, { ...done, step: 2 },
    ...[{ attempt: 1 }, { sourceId: "other" }, { model: "other" }, { apiMode: "other" }, { groupId: "other" }, { credentialId: "other" }]
      .map(patch => ({ ...done, selection: { ...done.selection, ...patch } })),
  ]) {
    expect(sessionUsage([start(0), begun, mismatch, finish(100, 40)]).speed)
      .toEqual({ outputTokens: 0, durationMs: 0, partial: true, requestStartedAt: undefined });
  }
  expect(sessionUsage([{ ...begun, timestamp: stamp(100) }, { ...done, timestamp: stamp(200) }]).speed)
    .toMatchObject({ outputTokens: 40, durationMs: 2000, partial: false });
});

it("excludes unknown-usage attempts and retry backoff instead of treating them as zero-token requests", () => {
  const events = [start(0), attempt(1, "started"), attempt(2, "failed"),
    agentEventSchema.parse({ type: "provider_retry", sessionId: id, timestamp: stamp(2), attempt: 1, maxAttempts: 5, reason: "network" }),
    attempt(10, "started"), attempt(12, "succeeded", 80),
    attempt(100, "started"), attempt(120, "succeeded"), finish(200, 80),
  ];
  expect(sessionUsage(events).speed).toEqual({ outputTokens: 80, durationMs: 2000, partial: true, requestStartedAt: undefined });
});

it("clears unmatched requests at run/step/tool/approval boundaries without counting the gap", () => {
  const boundaries = [start(100), finish(100), tool(100),
    agentEventSchema.parse({ type: "step_started", sessionId: id, timestamp: stamp(100), turn: 1, step: 2, messageIndex: 0 }),
    agentEventSchema.parse({ type: "step_finished", sessionId: id, timestamp: stamp(100), turn: 1, step: 1, messageIndex: 0, status: "cancelled" }),
    agentEventSchema.parse({ type: "approval_requested", sessionId: id, timestamp: stamp(100), request: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", sessionId: id, toolCallId: "tool", toolName: "run_command", description: "test",
    } }),
  ];
  for (const boundary of boundaries) {
    const prefix = [start(0), attempt(1, "started")];
    const reset = appendSessionEvent(prefix, boundary);
    expect(sessionUsage(reset).speed.requestStartedAt).toBeUndefined();
    const events = [...reset, attempt(101, "started"), attempt(103, "succeeded", 20), finish(200, 20)];
    expect(sessionUsage(events).speed).toEqual({ outputTokens: 20, durationMs: 2000, partial: true, requestStartedAt: undefined });
    const appended = events.reduce<readonly AgentEvent[]>((all, event) => appendSessionEvent(all, event), []);
    expect(sessionUsage(appended).speed).toEqual(sessionUsage(events).speed);
  }
});

it("keeps estimates scoped to the current request and replaces them with reported usage", () => {
  const runId = runIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  let state: WorkbenchState = { ...initialWorkbenchState, activeSessionId: id, activeSnapshot: sessionSnapshotSchema.parse({
    version: 1, id, title: "test", workspace: "/tmp", model: "test", createdAt: stamp(0), updatedAt: stamp(0),
    status: "running", messages: [], events: [], changes: [],
  }) };
  const send = (event: AgentEvent) => {
    state = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId, event } });
    return state.activeRuns[id]?.unreportedOutputTokens;
  };
  const text = (seconds: number) => agentEventSchema.parse({ type: "text_delta", sessionId: id, timestamp: stamp(seconds), text: "x".repeat(40) });
  expect(send(start(0))).toBe(0);
  expect(send(attempt(0, "started"))).toBe(0);
  expect(send(text(1))).toBe(10);
  expect(send(agentEventSchema.parse({ type: "reasoning_delta", sessionId: id, timestamp: stamp(1), text: "思".repeat(10) }))).toBe(20);
  send(attempt(2, "succeeded", 30));
  expect(send(report(2, 30))).toBe(0);
  expect(sessionUsage(state.activeSnapshot!.events).speed).toMatchObject({ outputTokens: 30, durationMs: 2000, requestStartedAt: undefined });
  send(tool(2));
  send(attempt(100, "started"));
  expect(send(text(101))).toBe(10);
  send(attempt(102, "succeeded")); // no usage to replace this estimate
  expect(send(attempt(200, "started"))).toBe(0); // do not carry it into the next request
  expect(send(text(201))).toBe(10);
  expect(send(agentEventSchema.parse({ type: "retry_reset", sessionId: id, timestamp: stamp(201) }))).toBe(0);
  send(attempt(202, "failed"));
  send(attempt(210, "started"));
  send(attempt(212, "succeeded", 10));
  expect(send(finish(300, 40))).toBe(0);
  expect(sessionUsage(state.activeSnapshot!.events).speed.outputTokens).toBe(40);
});
