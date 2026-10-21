import { expect, it } from "vitest";
import { paginateSession } from "../../src/shared/session-page";
import { parseSessionId, sessionSnapshotSchema } from "../../src/shared/schemas";
import { executionTurns } from "../../src/shared/execution";
import { pageSnapshot, prependSessionPage } from "../../src/renderer/state/session-pages";
import { mergeTranscript, outputSaved, reasoningSaved } from "../../src/renderer/state/transcript-sync";
import { reduceTimeline } from "../../src/renderer/state/timeline";
import { completedTurnExecutions } from "../../src/renderer/state/turn-execution";
import { initialWorkbenchState, workbenchReducer } from "../../src/renderer/state/workbench-reducer";
import { sessionUsage } from "../../src/renderer/state/session-usage";

const id = parseSessionId("11111111-1111-4111-8111-111111111111");
const stamp = (n: number) => `2026-10-01T00:00:${String(n).padStart(2, "0")}.000Z`;
const snapshot = sessionSnapshotSchema.parse({
  version: 1, id, title: "Paged fixture", workspace: "/tmp/forge-pages", model: "fixture",
  createdAt: stamp(0), updatedAt: stamp(30), status: "completed", changes: [],
  messages: [1, 2, 3].flatMap(turn => [
    { role: "user", content: `question-${turn}` },
    { role: "assistant", content: `answer-${turn}`, reasoning: `reason-${turn}` },
  ]),
  events: [1, 2, 3].flatMap(turn => [
    { type: "run_started", sessionId: id, timestamp: stamp(turn * 5), turn, messageIndex: (turn - 1) * 2, model: "fixture", permission: "readonly" },
    { type: "step_started", sessionId: id, timestamp: stamp(turn * 5 + 1), turn, step: 1, messageIndex: (turn - 1) * 2 + 1 },
    { type: "step_finished", sessionId: id, timestamp: stamp(turn * 5 + 2), turn, step: 1, messageIndex: turn * 2, status: "completed" },
    { type: "run_finished", sessionId: id, timestamp: stamp(turn * 5 + 3), turn, status: "completed", turns: 1, steps: 1, toolCalls: 0,
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } },
  ]),
});

it("retains absolute message identities, turn numbers, output matching and aggregate usage while prepending", () => {
  const tail = pageSnapshot(paginateSession(snapshot));
  expect(tail.messages.map(m => m.content)).toEqual(["question-3", "answer-3"]);
  expect(executionTurns(tail).map(t => [t.turn, t.messageStart, t.messageEnd])).toEqual([[3, 0, 2]]);
  expect(reduceTimeline(tail).map(item => item.id)).toEqual(["message:4", "message:5"]);
  expect(completedTurnExecutions(tail)[0]?.finalMessageId).toBe("message:5");
  const debt = { id: "stream", text: "answer-3", truncated: false, afterMessage: 5, turn: 3, step: 1 };
  expect(outputSaved(debt, tail)).toBe(true);
  expect(reasoningSaved({ ...debt, text: "reason-3" }, tail)).toBe(true);
  const more = prependSessionPage(tail, paginateSession(snapshot, { before: 4 }));
  expect(more.transcript?.messageOffset).toBe(2);
  expect(reduceTimeline(more).slice(-2)).toEqual(reduceTimeline(tail));
  expect(outputSaved(debt, more)).toBe(true);
  expect(sessionUsage(more.events)).toEqual(sessionUsage(snapshot.events));
  expect(sessionUsage(tail.events)).toEqual(sessionUsage(snapshot.events));
});

it("does not lose newly loaded history when a tail refresh was already in flight", () => {
  const tail = pageSnapshot(paginateSession(snapshot));
  const expanded = prependSessionPage(tail, paginateSession(snapshot, { before: 4 }));
  const refreshed = pageSnapshot(paginateSession({ ...snapshot, updatedAt: stamp(31), title: "updated" }, { from: 4 }));
  const merged = mergeTranscript(expanded, refreshed, snapshot.updatedAt);
  expect(merged.messages).toEqual(snapshot.messages.slice(2));
  expect(merged.events).toEqual(snapshot.events.slice(4));
  expect(merged.transcript?.messageOffset).toBe(2);
  expect(merged.transcript?.eventOffset).toBe(4);
  expect(merged.title).toBe("updated");
  expect(sessionUsage(merged.events)).toEqual(sessionUsage(snapshot.events));
  expect(() => prependSessionPage(expanded, paginateSession(snapshot, { before: 4 }))).toThrow("边界");
});

it("keeps unsaved live events while loading history and rejects a stale tail snapshot", () => {
  const tail = pageSnapshot(paginateSession(snapshot));
  const event = { type: "error" as const, timestamp: stamp(32), sessionId: id, error: { code: "provider" as const, message: "live", retryable: true } };
  const live = { ...tail, updatedAt: stamp(32), events: [...tail.events, event] };
  const expanded = prependSessionPage(live, paginateSession(snapshot, { before: 4 }));
  const synced = mergeTranscript(expanded, tail, stamp(30));
  expect(synced.events.at(-1)).toEqual(event);
  expect(synced.messages).toEqual(snapshot.messages.slice(2));
  expect(mergeTranscript(synced, tail, stamp(31))).toBe(synced);
});

it("keeps streaming boundaries absolute and releases paged history on session navigation", () => {
  let state = workbenchReducer(initialWorkbenchState, { type: "SELECT_SESSION", sessionId: id });
  state = workbenchReducer(state, { type: "SET_ACTIVE_SNAPSHOT", snapshot: pageSnapshot(paginateSession(snapshot)) });
  state = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId: "22222222-2222-4222-8222-222222222222" as never,
    event: { type: "text_delta", sessionId: id, timestamp: stamp(32), turn: 4, step: 1, text: "new live" } } });
  expect(state.activeRuns[id]?.streamStartMessage).toBe(6);
  state = workbenchReducer(state, { type: "PREPEND_SESSION_PAGE", result: paginateSession(snapshot, { before: 4 }) });
  expect(state.activeRuns[id]?.streamStartMessage).toBe(6);
  const other = parseSessionId("33333333-3333-4333-8333-333333333333");
  state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: other });
  expect(state.snapshotCache[id]).toBeUndefined();
  const ignored = workbenchReducer(state, { type: "PREPEND_SESSION_PAGE", result: paginateSession(snapshot, { before: 2 }) });
  expect(ignored).toBe(state);
  state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: id });
  expect(state.activeSnapshot).toBeNull();
  expect(state.isSnapshotLoading).toBe(true);
});
