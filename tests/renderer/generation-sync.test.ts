import { expect, it } from "vitest";
import { runIdSchema } from "../../src/shared/ipc";
import { agentEventSchema, sessionSnapshotSchema, type Message } from "../../src/shared/schemas";
import { initialWorkbenchState, streamedOutput, workbenchReducer, type WorkbenchState } from "../../src/renderer/state/workbench-reducer";
import { reduceTimeline } from "../../src/renderer/state/timeline";
import { reasoningSaved } from "../../src/renderer/state/transcript-sync";

const id = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const nextRun = "33333333-3333-4333-8333-333333333333";
const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const call = { id: "reused", type: "function" as const, function: { name: "read_file", arguments: "{}" } };
function harness() {
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 22, 0, 0, tick++)).toISOString();
  const base = sessionSnapshotSchema.parse({ version: 1, id, title: "generation test", workspace: "/tmp", model: "fixture",
    status: "running", createdAt: stamp(), updatedAt: stamp(), messages: [{ role: "user", content: "TASK" }], events: [], changes: [] });
  let state: WorkbenchState = { ...initialWorkbenchState, activeSessionId: base.id, activeSnapshot: base };
  const event = (data: object, run = runId) => {
    state = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId: runIdSchema.parse(run),
      event: agentEventSchema.parse({ sessionId: id, timestamp: stamp(), turn: 1, step: 1, ...data }) } });
  };
  event({ type: "run_started", model: "fixture", permission: "unrestricted", messageIndex: 0 });
  event({ type: "step_started", messageIndex: 1 });
  return {
    event,
    start: (generationId = first, messageIndex = 1, step = 1) => event({ type: "generation_started", generationId, messageIndex, step }),
    save(messages: readonly Message[], status = "running") {
      state = workbenchReducer(state, { type: "SET_ACTIVE_SNAPSHOT", snapshot: sessionSnapshotSchema.parse({
        ...state.activeSnapshot, messages, status, updatedAt: stamp(),
      }) });
    },
    get state() { return state; },
    get run() { return state.activeRuns[id]!; },
    get timeline() {
      const run = state.activeRuns[id];
      const text = run && streamedOutput(run);
      const thought = run && streamedOutput(run, true);
      return reduceTimeline(state.activeSnapshot!, [...(run?.pendingOutputs ?? []), ...(text ? [text] : [])],
        [...(run?.pendingReasoning ?? []), ...(thought ? [thought] : [])]);
    },
    get messages() { return state.activeSnapshot!.messages; },
  };
}

it("keeps one generation before all its tools through preview, lag and authoritative snapshot", () => {
  const h = harness(); h.start();
  h.event({ type: "reasoning_delta", generationId: first, text: "preview thought" });
  expect(h.timeline.at(-1)).toMatchObject({ kind: "message", reasoningLive: true });
  h.event({ type: "tool_call_preview", generationId: first, previewId: "p", name: "read_file", argumentsChars: 2 });
  h.event({ type: "reasoning_delta", generationId: first, text: " tail" });
  expect(h.timeline.at(-1)).toMatchObject({ reasoningLive: false });
  h.event({ type: "generation_finished", generationId: first, status: "completed" });
  const other = { ...call, id: "second-tool" };
  for (const [callIndex, value] of [call, other].entries()) h.event({ type: "tool_started", generationId: first, callIndex, call: value });
  expect(h.timeline.map(item => item.kind)).toEqual(["message", "message", "tool", "tool"]);
  expect(h.timeline[1]).toMatchObject({ id: `generation:${first}`, reasoning: "preview thought tail" });
  h.save([...h.messages, { role: "assistant", generationId: first, content: null, reasoning: "final authoritative thought", tool_calls: [call, other] }]);
  expect(h.run.pendingReasoning).toHaveLength(0);
  expect(h.timeline.map(item => item.kind)).toEqual(["message", "message", "tool", "tool"]);
  expect(h.timeline[1]).toMatchObject({ id: `generation:${first}`, reasoning: "final authoritative thought" });
});

it("acknowledges snapshot-first deltas without using the end-of-list cursor", () => {
  const h = harness(); h.start();
  h.save([...h.messages, { role: "assistant", generationId: first, content: "answer", reasoning: "same thought" }]);
  h.event({ type: "reasoning_delta", generationId: first, text: "same thought" });
  h.event({ type: "text_delta", generationId: first, text: "answer" });
  h.event({ type: "generation_finished", generationId: first, status: "completed" });
  expect(h.run.streamingReasoning).toBe("");
  expect(h.run.pendingReasoning).toHaveLength(0);
  expect(h.timeline).toHaveLength(2);
});

it("does not clear an identical next-step thought or bind a reused tool ID to history", () => {
  const h = harness(); h.start();
  h.save([...h.messages, { role: "assistant", generationId: first, content: null, reasoning: "same", tool_calls: [call] },
    { role: "tool", tool_call_id: call.id, content: "old result" }]);
  h.event({ type: "generation_finished", generationId: first, status: "completed" });
  h.event({ type: "step_started", step: 2, messageIndex: 3 });
  h.start(second, 3, 2);
  h.event({ type: "reasoning_delta", generationId: second, text: "same", step: 2 });
  h.save(h.messages);
  expect(h.run.streamingReasoning).toBe("same");
  h.event({ type: "generation_finished", generationId: second, status: "completed", step: 2 });
  h.event({ type: "tool_started", generationId: second, callIndex: 0, call, step: 2 });
  h.event({ type: "tool_finished", generationId: second, callIndex: 0, toolCallId: call.id, result: { content: "new result", isError: false }, step: 2 });
  const items = h.timeline.filter(item => item.generationId);
  expect(items.map(item => item.generationId)).toEqual([first, first, second, second]);
  expect(items.at(-1)).toMatchObject({ kind: "tool", output: "new result", status: "completed" });
});

it.each(["failed", "cancelled"] as const)("anchors %s reasoning to its original turn across continuation and refreshes", status => {
  const h = harness(); h.start();
  h.event({ type: "reasoning_delta", generationId: first, text: "unsaved thought" });
  h.event({ type: "generation_finished", generationId: first, status });
  h.event({ type: "error", error: { code: "provider", message: "fixture error", retryable: false } });
  h.event({ type: "run_finished", status, turns: 1, toolCalls: 0, messageIndex: 1 });
  h.save(h.messages, status);
  h.event({ type: "run_started", turn: 2, model: "fixture", permission: "unrestricted", messageIndex: 1 }, nextRun);
  for (let index = 0; index < 3; index++) h.save([{ role: "user", content: "TASK" }, { role: "user", content: "CONTINUE" }]);
  expect(h.timeline.map(item => item.kind)).toEqual(["message", "message", "error", "message"]);
  expect(h.timeline[1]).toMatchObject({ turn: 1, reasoning: "unsaved thought", reasoningStatus: status });
  expect(h.timeline[2]).toMatchObject({ error: { code: "provider" } });
  expect(h.timeline.at(-1)).toMatchObject({ content: "CONTINUE", turn: 2 });
});

it("drops only a superseded attempt and rejects its late deltas and reset", () => {
  const h = harness(); h.start();
  h.event({ type: "reasoning_delta", generationId: first, text: "abandoned" });
  h.event({ type: "generation_finished", generationId: first, status: "superseded" });
  h.start(second);
  h.event({ type: "reasoning_delta", generationId: second, text: "fresh" });
  h.event({ type: "reasoning_delta", generationId: first, text: "late" });
  h.event({ type: "retry_reset", generationId: first });
  h.start(first); // Replayed old lifecycle must not displace the current attempt.
  expect(h.run.streamingReasoning).toBe("fresh");
  expect(h.run.pendingReasoning).toHaveLength(0);
  expect(h.timeline.at(-1)).toMatchObject({ generationId: second, reasoningLive: true });
});

it("keeps a missing saved channel as an explicitly unconfirmed preview in the same generation", () => {
  const h = harness(); h.start();
  h.event({ type: "reasoning_delta", generationId: first, text: "display-only" });
  h.event({ type: "text_delta", generationId: first, text: "answer" });
  h.event({ type: "generation_finished", generationId: first, status: "completed" });
  h.save([...h.messages, { role: "assistant", generationId: first, content: "answer" }]);
  expect(h.timeline).toHaveLength(2);
  expect(h.timeline[1]).toMatchObject({ content: "answer", reasoning: "display-only", reasoningStatus: "unconfirmed" });
});

it("requires paired tool identity and never acknowledges ambiguous generation IDs", () => {
  const h = harness();
  expect(agentEventSchema.safeParse({ type: "tool_started", sessionId: id, timestamp: new Date().toISOString(), generationId: first, call }).success).toBe(false);
  h.save([...h.messages, ...[1, 2].map(() => ({ role: "assistant" as const, generationId: first, content: null, reasoning: "same" }))]);
  expect(reasoningSaved({ id: "x", text: "same", truncated: false, afterMessage: 0, generationId: first }, h.state.activeSnapshot)).toBe(false);
});
