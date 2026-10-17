import { describe, expect, it } from "vitest";
import { runIdSchema } from "../../src/shared/ipc";
import { sessionIdSchema } from "../../src/shared/schemas";
import type { SessionSnapshot } from "../../src/renderer/shared-types";
import {
  initialWorkbenchState,
  workbenchReducer,
  type WorkbenchState,
} from "../../src/renderer/state/workbench-reducer";
import { reduceTimeline } from "../../src/renderer/state/timeline";

const session = sessionIdSchema.parse("11111111-1111-4111-8111-111111111111");
const run = runIdSchema.parse("33333333-3333-4333-8333-333333333333");
const ts = (seconds: number) =>
  `2026-01-01T00:00:${String(seconds).padStart(2, "0")}.000Z`;

/** Only the user turn is persisted yet: no assistant message, no tool call. */
const base: SessionSnapshot = {
  version: 1,
  id: session,
  title: "live",
  workspace: "/tmp/live",
  model: "m",
  createdAt: ts(0),
  updatedAt: ts(0),
  status: "running",
  messages: [{ role: "user", content: "read the file" }],
  events: [],
  changes: [],
};

const call = {
  id: "call-1",
  type: "function" as const,
  function: { name: "read_file", arguments: '{"path":"a.ts"}' },
};

function receive(state: WorkbenchState, event: Record<string, unknown>) {
  return workbenchReducer(state, {
    type: "RUN_EVENT_RECEIVED",
    event: { runId: run, event: event as never },
  });
}

function toolRows(state: WorkbenchState) {
  return state.activeSnapshot
    ? reduceTimeline(state.activeSnapshot).filter((item) => item.kind === "tool")
    : [];
}

describe("live tool cards without a snapshot refresh", () => {
  it("shows tool_started immediately, completes on tool_finished, then keeps one row", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      activeSessionId: session,
      activeSnapshot: base,
      activeRuns: {
        [session]: { sessionId: session, runId: run, status: "running", streamingText: "" },
      },
    };
    // No getSession call: only a run event arrives.
    state = receive(state, {
      type: "tool_started",
      sessionId: session,
      timestamp: ts(1),
      call,
    });
    expect(toolRows(state)).toMatchObject([{ status: "running", output: "" }]);
    expect(toolRows(state)[0]).not.toHaveProperty("changes");

    state = receive(state, {
      type: "tool_finished",
      sessionId: session,
      timestamp: ts(2),
      toolCallId: "call-1",
      result: { content: "file body", isError: false },
    });
    expect(toolRows(state)).toMatchObject([
      { status: "completed", output: "file body" },
    ]);

    // The delayed snapshot catches up: the same occurrence must not double-render.
    state = workbenchReducer(state, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot: {
        ...base,
        updatedAt: ts(3),
        status: "running",
        messages: [
          { role: "user", content: "read the file" },
          { role: "assistant", content: null, tool_calls: [call] },
          { role: "tool", tool_call_id: "call-1", content: "file body" },
        ],
        events: [
          { type: "tool_started", sessionId: session, timestamp: ts(1), call },
          {
            type: "tool_finished",
            sessionId: session,
            timestamp: ts(2),
            toolCallId: "call-1",
            result: { content: "file body", isError: false },
          },
        ],
      },
    });
    expect(toolRows(state)).toHaveLength(1);
    expect(toolRows(state)[0]).toMatchObject({
      status: "completed",
      output: "file body",
    });
  });

  it("does not reuse a historical same-id execution for a new live turn", () => {
    const history: SessionSnapshot = {
      ...base,
      updatedAt: ts(4),
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: null, tool_calls: [call] },
        { role: "tool", tool_call_id: "call-1", content: "old body" },
        { role: "user", content: "again" },
      ],
      events: [
        { type: "run_started", sessionId: session, timestamp: ts(0), model: "m", permission: "readonly" },
        { type: "tool_started", sessionId: session, timestamp: ts(1), call },
        {
          type: "tool_finished",
          sessionId: session,
          timestamp: ts(2),
          toolCallId: "call-1",
          result: { content: "old body", isError: false },
        },
        { type: "run_started", sessionId: session, timestamp: ts(3), model: "m", permission: "readonly" },
      ],
    };
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      activeSessionId: session,
      activeSnapshot: history,
      activeRuns: {
        [session]: { sessionId: session, runId: run, status: "running", streamingText: "" },
      },
    };
    state = receive(state, {
      type: "tool_started",
      sessionId: session,
      timestamp: ts(5),
      call,
    });
    expect(toolRows(state).map((item) => item.status)).toEqual([
      "completed",
      "running",
    ]);
    expect(toolRows(state)[1]).toMatchObject({ output: "" });

    state = receive(state, {
      type: "tool_finished",
      sessionId: session,
      timestamp: ts(6),
      toolCallId: "call-1",
      result: { content: "new body", isError: true },
    });
    expect(toolRows(state).map((item) => [item.status, item.output])).toEqual([
      ["completed", "old body"],
      ["failed", "new body"],
    ]);
  });
});

describe("ephemeral tool previews", () => {
  it("replaces by previewId, stays out of the transcript, and is cleared by lifecycle events", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      activeSessionId: session,
      activeSnapshot: base,
      activeRuns: {
        [session]: { sessionId: session, runId: run, status: "running", streamingText: "" },
      },
    };
    const preview = (argumentsChars: number) => ({
      type: "tool_call_preview",
      sessionId: session,
      timestamp: ts(1),
      previewId: "p1",
      name: "read_file",
      argumentsChars,
    });
    state = receive(state, preview(12));
    state = receive(state, preview(48));
    expect(state.activeRuns[session]?.toolPreviews).toEqual([
      { previewId: "p1", name: "read_file", argumentsChars: 48 },
    ]);
    // High-frequency preview metadata never enters the stored event list.
    expect(state.activeSnapshot?.events).toEqual([]);

    // The validated call supersedes its own preview, and is now the live card.
    state = receive(state, {
      type: "tool_started",
      sessionId: session,
      timestamp: ts(2),
      call,
      previewId: "p1",
    });
    expect(state.activeRuns[session]?.toolPreviews).toEqual([]);
    expect(toolRows(state)).toMatchObject([{ status: "running" }]);

    state = receive(state, { type: "tool_preview_reset", sessionId: session, timestamp: ts(3) });
    expect(state.activeRuns[session]?.toolPreviews).toEqual([]);
  });

  it("bounds the preview map and clears it on retry_reset, run_started and run_finished", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      activeSessionId: session,
      activeSnapshot: base,
      activeRuns: {
        [session]: { sessionId: session, runId: run, status: "running", streamingText: "" },
      },
    };
    for (let index = 0; index < 300; index++)
      state = receive(state, {
        type: "tool_call_preview",
        sessionId: session,
        timestamp: ts(1),
        previewId: `p${index}`,
        name: "read_file",
        argumentsChars: index,
      });
    const previews = state.activeRuns[session]?.toolPreviews ?? [];
    expect(previews).toHaveLength(256);
    expect(previews.at(-1)?.previewId).toBe("p299");

    state = receive(state, { type: "retry_reset", sessionId: session, timestamp: ts(2) });
    expect(state.activeRuns[session]?.toolPreviews).toEqual([]);

    state = receive(state, {
      type: "tool_call_preview",
      sessionId: session,
      timestamp: ts(3),
      previewId: "p1",
      name: "read_file",
      argumentsChars: 5,
    });
    state = receive(state, {
      type: "run_started",
      sessionId: session,
      timestamp: ts(4),
      model: "m",
      permission: "readonly",
    });
    expect(state.activeRuns[session]?.toolPreviews).toEqual([]);

    state = receive(state, {
      type: "tool_call_preview",
      sessionId: session,
      timestamp: ts(5),
      previewId: "p2",
      name: "read_file",
      argumentsChars: 7,
    });
    state = receive(state, { type: "state_changed", sessionId: session, timestamp: ts(6), status: "cancelled" });
    expect(state.activeRuns[session]?.toolPreviews).toEqual([]);
    state = receive(state, { type: "tool_call_preview", sessionId: session, timestamp: ts(6), previewId: "p3", name: "read_file", argumentsChars: 8 });
    state = receive(state, {
      type: "run_finished",
      sessionId: session,
      timestamp: ts(6),
      status: "failed",
      turns: 1,
      toolCalls: 0,
    });
    expect(state.activeRuns[session]?.toolPreviews).toEqual([]);
    expect(state.activeRuns[session]?.status).toBe("failed");
  });
});
