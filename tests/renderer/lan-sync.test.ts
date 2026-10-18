import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { initialWorkbenchState, workbenchReducer } from "../../src/renderer/state/workbench-reducer";
import { runIdSchema } from "../../src/shared/ipc";
import { sessionIdSchema } from "../../src/shared/schemas";

const sessionId = sessionIdSchema.parse(randomUUID());
const runId = runIdSchema.parse(randomUUID());
const nextRunId = runIdSchema.parse(randomUUID());
const timestamp = new Date().toISOString();
const root = { id: randomUUID(), sessionId, toolCallId: "tool", toolName: "run_command", description: "fixture" };
const queued = { ...root, id: randomUUID() };

it("removes phone-resolved approval cards while preserving the remaining queue", () => {
  const state = { ...initialWorkbenchState, activeRuns: { [sessionId]: {
    sessionId, runId, status: "awaiting_approval" as const, streamingText: "", pendingApproval: root, approvalQueue: [root, queued], isSubmittingApproval: true,
  } } };
  const next = workbenchReducer(state, { type: "RUN_EVENT_RECEIVED", event: { runId, event: { type: "approval_resolved", sessionId, timestamp, approvalId: root.id, approved: true } } });
  expect(next.activeRuns[sessionId]).toMatchObject({ pendingApproval: queued, approvalQueue: [queued], isSubmittingApproval: false, status: "awaiting_approval" });
  const resumed = workbenchReducer(next, { type: "RUN_EVENT_RECEIVED", event: { runId, event: { type: "approval_resolved", sessionId, timestamp, approvalId: queued.id, approved: false } } });
  expect(resumed.activeRuns[sessionId]).toMatchObject({ approvalQueue: [], status: "running" });
  expect(resumed.activeRuns[sessionId]?.pendingApproval).toBeUndefined();
});

it("accepts the next remote turn after completion but rejects mismatched live or late events", () => {
  const state = { ...initialWorkbenchState, activeRuns: { [sessionId]: {
    sessionId, runId, status: "completed" as const, streamingText: "old", streamingReasoning: "old", error: { code: "internal" as const, message: "old", retryable: false }, pendingApproval: root, isCancelling: true,
  } } };
  const started = { type: "RUN_EVENT_RECEIVED" as const, event: { runId: nextRunId, event: { type: "run_started" as const, sessionId, timestamp, model: "fixture", permission: "workspace" as const } } };
  const next = workbenchReducer(state, started);
  expect(next.activeRuns[sessionId]).toMatchObject({ runId: nextRunId, status: "running", streamingText: "", accepted: true });
  for (const key of ["streamingReasoning", "error", "pendingApproval", "isCancelling"] as const) expect(next.activeRuns[sessionId]?.[key]).toBeUndefined();
  const late = { type: "RUN_EVENT_RECEIVED" as const, event: { runId, event: { type: "text_delta" as const, sessionId, timestamp, text: "late" } } };
  expect(workbenchReducer(next, late)).toBe(next);
  expect(workbenchReducer(next, { ...started, event: { ...started.event, runId } })).toBe(next);
  expect(workbenchReducer(state, { ...late, event: { ...late.event, runId: nextRunId } })).toBe(state);
});
