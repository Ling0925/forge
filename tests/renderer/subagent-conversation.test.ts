import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { runIdSchema } from "../../src/shared/ipc";
import { sessionIdSchema, sessionSnapshotSchema } from "../../src/shared/schemas";
import { childConversation, childFinalReport, type AgentProgress } from "../../src/renderer/state/subagent-conversation";
import { shouldRefreshTranscript } from "../../src/renderer/state/refresh-events";
import { initialWorkbenchState, workbenchReducer } from "../../src/renderer/state/workbench-reducer";

const parent = sessionIdSchema.parse(randomUUID());
const child = sessionIdSchema.parse(randomUUID());
const runId = runIdSchema.parse(randomUUID());
const timestamp = "2026-01-01T00:00:00.000Z";
const snapshot = sessionSnapshotSchema.parse({ version: 1, id: child, parentSessionId: parent, title: "child", model: "test", workspace: "/tmp",
  status: "running", createdAt: timestamp, updatedAt: timestamp, changes: [], events: [], messages: [] });
const progress: AgentProgress = { type: "agent_progress", sessionId: parent, childSessionId: child, timestamp, text: "live reply", truncated: false };

it("replaces cumulative child drafts without altering parent state, transcript or triggering reads", () => {
  const initial = { ...initialWorkbenchState, activeSessionId: parent, activeSnapshot: { ...snapshot, id: parent },
    activeRuns: { [parent]: { sessionId: parent, runId, status: "awaiting_approval" as const, streamingText: "parent reply" } } };
  let state = workbenchReducer(initial, { type: "RUN_EVENT_RECEIVED", event: { runId, event: progress } });
  state = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId, event: { ...progress, text: "live reply continued" } } });
  expect(state.agentProgress[child]?.text).toBe("live reply continued");
  expect(state.activeRuns).toBe(initial.activeRuns);
  expect(state.activeSnapshot).toBe(initial.activeSnapshot);
  expect(shouldRefreshTranscript("agent_progress")).toBe(false);
  state = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId, event: { ...progress, text: "", childStep: 2 } } });
  expect(state.agentProgress[child]?.text).toBe("");
  const stale = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId: runIdSchema.parse(randomUUID()), event: progress } });
  expect(stale).toBe(state);
  for (let index = 0; index < 40; index++) state = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId,
    event: { ...progress, childSessionId: sessionIdSchema.parse(randomUUID()) } } });
  expect(Object.keys(state.agentProgress)).toHaveLength(32);
});

it("deduplicates a persisted live reply, hides reasoning/system text and keeps tool errors", () => {
  const call = { id: "read", type: "function" as const, function: { name: "read_file", arguments: '{"path":"src/example.ts"}' } };
  const stored = { ...snapshot, messages: [
    { role: "system" as const, content: "private instructions" },
    { role: "user" as const, content: "task instructions" },
    { role: "assistant" as const, content: "live reply", reasoning: "private reasoning", tool_calls: [call] },
    { role: "tool" as const, tool_call_id: "read", content: JSON.stringify({ content: "read failed", isError: true }) },
  ] };
  const result = childConversation(stored, progress);
  expect(result.entries.filter(item => item.kind === "message")).toHaveLength(1);
  expect(result.liveId).toBeUndefined();
  expect(result.entries.at(-1)).toMatchObject({ kind: "tool", status: "failed", output: "read failed" });
  const completed = { ...snapshot, status: "completed" as const, messages: [{ role: "assistant" as const, content: "canonical final reply" }] };
  expect(childConversation(completed, progress).liveId).toBeUndefined();
  expect(childFinalReport({ ...stored, status: "failed" })).toBe("");
  expect(childFinalReport({ ...stored, status: "completed" })).toBe("");
  expect(childFinalReport({ ...stored, status: "completed", messages: [...stored.messages, { role: "assistant", content: "final report" }] })).toBe("final report");
});

it("retains a new step with repeated prose and bounds the expanded inline history", () => {
  const stored = { ...snapshot, messages: [
    { role: "user" as const, content: "go" },
    ...Array.from({ length: 90 }, (_, index) => ({ role: "assistant" as const, content: index === 89 ? progress.text : `past ${index}` })),
  ], events: [
    { type: "run_started" as const, sessionId: child, timestamp, turn: 1, messageIndex: 0, model: "test", permission: "readonly" as const },
    { type: "step_started" as const, sessionId: child, timestamp, turn: 1, step: 1, messageIndex: 1 },
    { type: "step_started" as const, sessionId: child, timestamp, turn: 1, step: 2, messageIndex: 91 },
  ] };
  const result = childConversation(stored, { ...progress, childTurn: 1, childStep: 2 });
  expect(result.entries).toHaveLength(80);
  expect(result.omitted).toBe(11);
  expect(result.liveId).toBeDefined();
  expect(result.entries.at(-1)).toMatchObject({ content: "live reply", incomplete: true });
  const beforeNewStepPersisted = childConversation({ ...stored, events: stored.events.slice(0, -1) }, { ...progress, childTurn: 1, childStep: 2 });
  expect(beforeNewStepPersisted.liveId).toBeDefined();
});
