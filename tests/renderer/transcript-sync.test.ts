import { expect, it } from "vitest";
import { reduceTimeline } from "../../src/renderer/state/timeline";
import {
  type WorkbenchState,
  initialWorkbenchState,
  workbenchReducer,
} from "../../src/renderer/state/workbench-reducer";
import { runIdSchema } from "../../src/shared/ipc";
import {
  agentEventSchema,
  sessionSnapshotSchema,
} from "../../src/shared/schemas";

const id = "11111111-1111-4111-8111-111111111111";
const runId = runIdSchema.parse("22222222-2222-4222-8222-222222222222");
const base = sessionSnapshotSchema.parse({
  version: 1,
  id,
  title: "test",
  workspace: "/tmp",
  model: "m",
  status: "running",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  messages: [{ role: "user", content: "task" }],
  events: [],
  changes: [],
});
const call = {
  id: "tool",
  type: "function" as const,
  function: { name: "read_file", arguments: "{}" },
};

for (const historicalError of [false, true])
  it(`retains output through lagging reads and multiple tool starts (historical error: ${historicalError})`, () => {
    const initial = {
      ...base,
      events: historicalError
        ? [
            agentEventSchema.parse({
              type: "error",
              sessionId: id,
              timestamp: base.createdAt,
              error: {
                code: "provider",
                message: "old failure",
                retryable: true,
              },
            }),
          ]
        : [],
    };
    let state = workbenchReducer(
      { ...initialWorkbenchState, activeSessionId: base.id },
      { type: "SET_ACTIVE_SNAPSHOT", snapshot: initial },
    );
    const event = (data: object) => {
      state = workbenchReducer(state, {
        type: "RUN_EVENT_RECEIVED",
        event: {
          runId,
          event: agentEventSchema.parse({
            sessionId: id,
            timestamp: "2026-01-01T00:00:03.000Z",
            ...data,
          }),
        },
      });
    };
    event({ type: "text_delta", text: "first answer" });
    event({ type: "tool_started", call });
    event({ type: "tool_started", call: { ...call, id: "tool-2" } });
    expect(
      state.activeRuns[id]?.pendingOutputs?.map((output) => output.text),
    ).toEqual(["first answer"]);
    state = workbenchReducer(state, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot: initial,
    });
    expect(state.activeRuns[id]?.pendingOutputs).toHaveLength(1);
    event({ type: "text_delta", text: "second answer" });
    const saved = sessionSnapshotSchema.parse({
      ...initial,
      updatedAt: "2026-01-01T00:00:02.000Z",
      messages: [
        ...initial.messages,
        { role: "assistant", content: "first answer", tool_calls: [call] },
      ],
    });
    state = workbenchReducer(state, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot: saved,
    });
    expect(state.activeSnapshot?.messages).toHaveLength(2);
    expect(state.activeRuns[id]?.pendingOutputs).toHaveLength(0);
    expect(state.activeRuns[id]?.streamingText).toBe("second answer");
    event({
      type: "run_finished",
      status: "completed",
      turns: 2,
      toolCalls: 2,
    });
    state = workbenchReducer(state, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot: saved,
    });
    expect(state.activeRuns[id]?.pendingOutputs?.[0]?.text).toBe(
      "second answer",
    );
    const final = sessionSnapshotSchema.parse({
      ...saved,
      updatedAt: "2026-01-01T00:00:04.000Z",
      status: "completed",
      messages: [
        ...saved.messages,
        { role: "assistant", content: "second answer" },
      ],
    });
    state = workbenchReducer(state, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot: final,
    });
    expect(state.activeRuns[id]).toBeUndefined();
    expect(state.activeSnapshot?.messages).toHaveLength(3);
    state = workbenchReducer(state, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot: initial,
    });
    expect(state.activeSnapshot?.messages).toHaveLength(3);
    const timeline = reduceTimeline(state.activeSnapshot ?? final);
    expect(timeline.at(-1)).toMatchObject({
      kind: "message",
      content: "second answer",
    });
    if (historicalError)
      expect(timeline[0]).toMatchObject({ kind: "error", historical: true });
  });

it("preserves partial failed output across snapshot refresh and the next run", () => {
  let state: WorkbenchState = {
    ...initialWorkbenchState,
    activeSessionId: base.id,
    activeSnapshot: base,
  };
  for (const data of [
    { type: "text_delta", text: "partial output" },
    { type: "run_finished", status: "failed", turns: 1, toolCalls: 0 },
  ]) {
    state = workbenchReducer(state, {
      type: "RUN_EVENT_RECEIVED",
      event: {
        runId,
        event: agentEventSchema.parse({
          sessionId: id,
          timestamp: base.updatedAt,
          ...data,
        }),
      },
    });
  }
  state = workbenchReducer(state, {
    type: "SET_ACTIVE_SNAPSHOT",
    snapshot: base,
  });
  state = workbenchReducer(state, {
    type: "START_RUN_INITIATED",
    sessionId: base.id,
  });
  expect(state.activeRuns[id]?.pendingOutputs?.[0]?.text).toBe(
    "partial output",
  );
});
