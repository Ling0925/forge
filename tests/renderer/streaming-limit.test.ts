import { expect, it } from "vitest";
import {
  STREAMING_TEXT_LIMIT,
  initialWorkbenchState,
  workbenchReducer,
} from "../../src/renderer/state/workbench-reducer";
import { runIdSchema } from "../../src/shared/ipc";
import { sessionSnapshotSchema } from "../../src/shared/schemas";
const snapshot = sessionSnapshotSchema.parse({
  version: 1,
  id: "11111111-1111-4111-8111-111111111111",
  title: "stream",
  workspace: "/workspace",
  model: "test",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "running",
  messages: [],
  events: [],
  changes: [],
});
const runId = runIdSchema.parse("33333333-3333-4333-8333-333333333333");
const common = { sessionId: snapshot.id, timestamp: snapshot.updatedAt };
it("bounds the draft prefix explicitly and never truncates the committed transcript", () => {
  const source = `BEGIN${"x".repeat(STREAMING_TEXT_LIMIT)}END`;
  const state = {
    ...initialWorkbenchState,
    activeSessionId: snapshot.id,
    activeSnapshot: snapshot,
  };
  const streamed = workbenchReducer(state, {
    type: "RUN_EVENT_RECEIVED",
    event: { runId, event: { ...common, type: "text_delta", text: source } },
  });
  expect(streamed.activeRuns[snapshot.id]?.streamingText).toBe(
    source.slice(0, STREAMING_TEXT_LIMIT),
  );
  expect(streamed.activeRuns[snapshot.id]?.streamingTruncated).toBe(true);
  expect(streamed.activeSnapshot).toBe(snapshot);
  const finished = workbenchReducer(streamed, {
    type: "RUN_EVENT_RECEIVED",
    event: {
      runId,
      event: {
        ...common,
        type: "run_finished",
        status: "completed",
        turns: 1,
        toolCalls: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    },
  });
  expect(finished.activeRuns[snapshot.id]?.streamingTruncated).toBe(false);
  const saved = workbenchReducer(finished, {
    type: "SET_ACTIVE_SNAPSHOT",
    snapshot: {
      ...snapshot,
      status: "completed",
      messages: [{ role: "assistant", content: source }],
    },
  });
  expect(saved.activeSnapshot?.messages[0]?.content).toBe(source);
});
it("resets the draft ceiling and changes render identity at tool boundaries", () => {
  const state = {
    ...initialWorkbenchState,
    activeRuns: {
      [snapshot.id]: {
        sessionId: snapshot.id,
        runId,
        status: "running" as const,
        streamingText: "old",
        streamingTruncated: true,
      },
    },
  };
  const next = workbenchReducer(state, {
    type: "RUN_EVENT_RECEIVED",
    event: {
      runId,
      event: {
        ...common,
        type: "tool_started",
        call: {
          id: "tool",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      },
    },
  });
  expect(next.activeRuns[snapshot.id]).toMatchObject({
    streamingText: "",
    streamingTruncated: false,
    streamingTurn: 1,
  });
});
