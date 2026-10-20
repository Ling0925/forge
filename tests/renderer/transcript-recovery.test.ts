import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StoredTranscript } from "../../src/renderer/components/workbench/Transcript";
import { reduceTimeline } from "../../src/renderer/state/timeline";
import { outputSaved, type PendingOutput } from "../../src/renderer/state/transcript-sync";
import { initialWorkbenchState, workbenchReducer, type WorkbenchState } from "../../src/renderer/state/workbench-reducer";
import { runIdSchema } from "../../src/shared/ipc";
import { agentEventSchema, sessionSnapshotSchema } from "../../src/shared/schemas";

const id = "11111111-1111-4111-8111-111111111111";
const base = { sessionId: id, timestamp: "2026-01-01T00:00:00.000Z" };
const event = (fields: { readonly type: string } & Record<string, unknown>) => agentEventSchema.parse({
  ...base, ...(fields.type === "run_finished" ? { toolCalls: 0 } : {}), ...fields,
});
const snapshot = sessionSnapshotSchema.parse({
  version: 1, id, title: "recovery", workspace: "/tmp", model: "fixture",
  status: "completed", createdAt: base.timestamp, updatedAt: base.timestamp, changes: [],
  messages: [{ role: "user", content: "A" }, { role: "user", content: "B" }, { role: "assistant", content: "answer B" }],
  events: [
    event({ type: "run_started", turn: 1, messageIndex: 0, model: "fixture", permission: "readonly" }),
    event({ type: "step_started", turn: 1, step: 1, messageIndex: 1 }),
    event({ type: "text_delta", text: "draft A" }),
    event({ type: "error", turn: 1, error: { code: "provider", message: "failure A", retryable: false } }),
    event({ type: "run_finished", turn: 1, status: "failed", turns: 1, messageIndex: 1 }),
    event({ type: "run_started", turn: 2, messageIndex: 1, model: "fixture", permission: "readonly" }),
    event({ type: "step_started", turn: 2, step: 1, messageIndex: 2 }),
    event({ type: "run_finished", turn: 2, status: "completed", turns: 1, messageIndex: 3 }),
  ],
});
const draft: PendingOutput = { id: "live-A", text: "draft A", truncated: false, afterMessage: 1, turn: 1, step: 1 };
const order = (value: typeof snapshot, pending: readonly PendingOutput[] = []) => reduceTimeline(value, pending)
  .map(item => item.kind === "message" ? `${item.role}:${item.content}` : item.kind === "error" ? `error:${item.message}` : item.kind);

it("restores failed legacy deltas before their error and next user, including cold reload", () => {
  const expected = ["user:A", "assistant:draft A", "error:failure A", "user:B", "assistant:answer B"];
  expect(order(snapshot)).toEqual(expected);
  expect(order(sessionSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot))))).toEqual(expected);
  expect(order(snapshot, [draft])).toEqual(expected);
  const html = renderToStaticMarkup(createElement(StoredTranscript, { snapshot, pendingOutputs: [draft] }));
  expect(html).toContain("未完成回复");
  expect(html.indexOf("draft A")).toBeLessThan(html.indexOf("failure A"));
  expect(html.match(/draft A/g)).toHaveLength(1);
});

it("keeps unconfirmed pending text in its original position while the saved snapshot lags", () => {
  const lagging = { ...snapshot, events: snapshot.events.filter(item => item.type !== "text_delta") };
  expect(outputSaved(draft, lagging)).toBe(false);
  expect(order(lagging, [draft])).toEqual(["user:A", "assistant:draft A", "error:failure A", "user:B", "assistant:answer B"]);
});

it("does not let another turn acknowledge a same-text draft", () => {
  expect(outputSaved({ ...draft, text: "answer B" }, snapshot)).toBe(false);
  expect(outputSaved({ ...draft, text: "answer B", turn: 2, afterMessage: 2 }, snapshot)).toBe(true);
  expect(outputSaved({ ...draft, turn: 2, afterMessage: 2 }, snapshot)).toBe(false);
  expect(outputSaved({ id: "legacy", text: "answer B", truncated: false, afterMessage: 0 }, snapshot)).toBe(true);
});

it("keeps same-text drafts from different failed runs separate", () => {
  const repeated = sessionSnapshotSchema.parse({ ...snapshot, status: "failed", messages: snapshot.messages.slice(0, 2), events: [
    ...snapshot.events.slice(0, 7),
    event({ type: "text_delta", turn: 2, step: 1, text: "draft A" }),
    event({ type: "run_finished", turn: 2, status: "failed", turns: 1, messageIndex: 2 }),
  ] });
  expect(order(repeated)).toEqual(["user:A", "assistant:draft A", "error:failure A", "user:B", "assistant:draft A"]);
});

it("recovers an anchored failure after unmatched older history", () => {
  const mixed = sessionSnapshotSchema.parse({ ...snapshot, status: "failed", messages: [
    { role: "user", content: "old A" }, { role: "user", content: "old B" }, { role: "user", content: "current" },
  ], events: [
    event({ type: "run_started", model: "fixture", permission: "readonly" }),
    event({ type: "run_finished", status: "failed", turns: 1 }),
    event({ type: "run_started", turn: 3, messageIndex: 2, model: "fixture", permission: "readonly" }),
    event({ type: "text_delta", text: "new draft" }),
    event({ type: "error", turn: 3, error: { code: "provider", message: "new failure", retryable: false } }),
    event({ type: "run_finished", turn: 3, status: "failed", turns: 1, messageIndex: 3 }),
  ] });
  expect(order(mixed)).toEqual(["user:old A", "user:old B", "user:current", "assistant:new draft", "error:new failure"]);
  const restored = reduceTimeline(mixed).find(item => item.kind === "message" && item.content === "new draft");
  expect(restored?.step).toBeUndefined();
});

it("retains conversation and step anchors without reusing the live chunk counter", () => {
  const runId = runIdSchema.parse("22222222-2222-4222-8222-222222222222");
  let state: WorkbenchState = { ...initialWorkbenchState, activeSessionId: snapshot.id, activeSnapshot: { ...snapshot, messages: snapshot.messages.slice(0, 1), events: [] } };
  for (const fields of [
    { type: "run_started", turn: 1, messageIndex: 0, model: "fixture", permission: "readonly" },
    { type: "text_delta", turn: 1, step: 2, text: "pending" },
    { type: "step_finished", turn: 1, step: 2, messageIndex: 1, status: "failed" },
    { type: "run_finished", turn: 1, status: "failed", turns: 2 },
  ]) state = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId, event: event(fields) } });
  expect(state.activeRuns[id]?.pendingOutputs?.[0]).toMatchObject({ turn: 1, step: 2, text: "pending" });
  state = workbenchReducer(state, { type: "START_RUN_INITIATED", sessionId: snapshot.id });
  expect(state.activeRuns[id]?.pendingOutputs).toHaveLength(1);
});
