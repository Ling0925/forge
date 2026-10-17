import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../../src/renderer/shared-types";
import { reduceTimeline } from "../../src/renderer/state/timeline";
import { createDiffPatch } from "../../src/shared/diff";
import {
  sessionIdSchema,
  sessionSnapshotSchema,
} from "../../src/shared/schemas";
const id = sessionIdSchema.parse("11111111-1111-4111-8111-111111111111");
it("reuses timeline for the same immutable snapshot and rebuilds replacements", () => {
  const first = reduceTimeline(base);
  expect(reduceTimeline(base)).toBe(first);
  const replaced = {
    ...base,
    messages: [
      ...base.messages,
      { role: "user" as const, content: "new turn" },
    ],
  };
  const next = reduceTimeline(replaced);
  expect(next).not.toBe(first);
  expect(next.at(-1)).toMatchObject({ content: "new turn" });
});
const base: SessionSnapshot = {
  version: 1,
  id,
  title: "test",
  workspace: "/tmp",
  model: "m",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:03Z",
  status: "completed",
  messages: [
    { role: "user", content: "do it" },
    {
      role: "assistant",
      content: "checking",
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "ok" },
    { role: "assistant", content: "done" },
  ],
  events: [
    {
      type: "tool_started",
      sessionId: id,
      timestamp: "2026-01-01T00:00:01Z",
      call: {
        id: "c1",
        type: "function",
        function: { name: "read_file", arguments: "{}" },
      },
    },
    {
      type: "tool_finished",
      sessionId: id,
      timestamp: "2026-01-01T00:00:02Z",
      toolCallId: "c1",
      result: { content: "ok", isError: false },
    },
  ],
  changes: [],
};
describe("chronological execution timeline", () => {
  it("places dialogue, tool execution and assistant result in order", () => {
    expect(sessionSnapshotSchema.parse(base)).toEqual(base);
    expect(reduceTimeline(base).map((entry) => entry.kind)).toEqual([
      "message",
      "message",
      "tool",
      "message",
    ]);
    expect(reduceTimeline(base)[2]).toMatchObject({
      kind: "tool",
      status: "completed",
      output: "ok",
    });
  });
  it("measures a tool duration from the recorded start and finish timestamps", () => {
    // base: tool_started at 00:00:01Z, tool_finished at 00:00:02Z.
    expect(reduceTimeline(base)[2]).toMatchObject({
      kind: "tool",
      durationMs: 1000,
      startedAt: "2026-01-01T00:00:01Z",
    });
  });
  it("reports no duration when the recorded timestamps are out of order", () => {
    const timed = (start?: string, finish?: string) =>
      reduceTimeline(
        sessionSnapshotSchema.parse({
          ...base,
          events: [
            {
              ...base.events[0],
              ...(start === undefined ? {} : { timestamp: start }),
            },
            {
              ...base.events[1],
              ...(finish === undefined ? {} : { timestamp: finish }),
            },
          ],
        }),
      )[2];
    // Out of order: a negative or invented duration is never displayed.
    // (Unparseable timestamps never reach here: sessionSnapshotSchema rejects
    // them before the transcript sees the snapshot.)
    expect(timed("2026-01-01T00:00:09Z", "2026-01-01T00:00:02Z")).not.toHaveProperty(
      "durationMs",
    );
    // A recorded start without a finish still reports when the action began.
    expect(timed("2026-01-01T00:00:01Z", undefined)).toMatchObject({
      startedAt: "2026-01-01T00:00:01Z",
    });
  });
  it("extracts file changes from a persisted tool result for the diff viewer", () => {
    const call = {
      id: "e1",
      type: "function" as const,
      function: {
        name: "edit_file",
        arguments: JSON.stringify({
          path: "a.ts",
          old_text: "x",
          new_text: "y",
        }),
      },
    };
    const change = {
      path: "a.ts",
      kind: "modified" as const,
      before: "x",
      after: "y",
      truncated: false,
    };
    const snapshot = sessionSnapshotSchema.parse({
      ...base,
      messages: [
        { role: "user", content: "edit" },
        { role: "assistant", content: null, tool_calls: [call] },
        {
          role: "tool",
          tool_call_id: "e1",
          content: JSON.stringify({
            content: JSON.stringify({ edited: true, replacements: 1 }),
            isError: false,
            changes: [change],
          }),
        },
      ],
      events: [],
    });
    const tool = reduceTimeline(snapshot).find((item) => item.kind === "tool");
    expect(tool).toMatchObject({
      status: "completed",
      changes: [{ path: "a.ts", kind: "modified", patch: createDiffPatch("x", "y") }],
    });
    if (tool?.kind !== "tool") throw new Error("missing tool item");
    expect(tool.changes?.[0]).not.toHaveProperty("before");
    expect(tool.changes?.[0]).not.toHaveProperty("after");
    expect(tool.changes?.[0]).not.toHaveProperty("truncated");
  });
  it("validates patch-only message changes and skips malformed entries independently", () => {
    const change = { path: "a.ts", kind: "modified", patch: createDiffPatch("x", "y") };
    const snapshot = sessionSnapshotSchema.parse({
      ...base,
      events: [],
      messages: [
        base.messages[1],
        {
          role: "tool", tool_call_id: "c1",
          content: JSON.stringify({
            content: "edited", isError: false,
            changes: [null, { ...change, patch: { version: 1, hunks: "invalid" } }, change],
          }),
        },
      ],
    });
    const tool = reduceTimeline(snapshot).find((item) => item.kind === "tool");
    expect(tool).toMatchObject({ status: "completed", output: "edited", changes: [change] });
  });
  it("retains failure evidence without declaring a later session state failed", () => {
    const failed = {
      ...base,
      events: [
        ...base.events,
        {
          type: "error" as const,
          sessionId: id,
          timestamp: "2026-01-01T00:00:03Z",
          error: {
            code: "provider" as const,
            message: "offline",
            retryable: true,
          },
        },
      ],
    };
    expect(failed.status).toBe("completed");
    expect(
      reduceTimeline(failed).some(
        (entry) => entry.kind === "error" && entry.message === "offline",
      ),
    ).toBe(true);
  });
});

it("matches repeated IDs by occurrence across multiple user turns", () => {
  const call = {
    id: "same",
    type: "function" as const,
    function: { name: "read_file", arguments: "{}" },
  };
  const timeline = reduceTimeline({
    ...base,
    events: [],
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "before first", tool_calls: [call] },
      { role: "tool", tool_call_id: "same", content: "first result" },
      { role: "assistant", content: "first done" },
      { role: "user", content: "second" },
      { role: "assistant", content: "before second", tool_calls: [call] },
      {
        role: "tool",
        tool_call_id: "same",
        content: JSON.stringify({ content: "denied", isError: true }),
      },
      { role: "assistant", content: "second done" },
    ],
  });
  expect(
    timeline.map((item) =>
      item.kind === "message"
        ? item.content
        : item.kind === "tool"
          ? item.output
          : item.message,
    ),
  ).toEqual([
    "first",
    "before first",
    "first result",
    "first done",
    "second",
    "before second",
    "denied",
    "second done",
  ]);
  const tools = timeline.filter((item) => item.kind === "tool");
  expect(tools.map((item) => item.status)).toEqual(["completed", "failed"]);
  expect(new Set(tools.map((item) => item.id)).size).toBe(2);
});
it("distinguishes unexecuted native calls from live started calls", () => {
  const call = {
    id: "c1",
    type: "function" as const,
    function: { name: "read_file", arguments: "{}" },
  };
  const messages = [
    { role: "assistant" as const, content: null, tool_calls: [call] },
  ];
  expect(reduceTimeline({ ...base, messages, events: [] })[0]).toMatchObject({
    status: "unexecuted",
    output: "",
  });
  expect(
    reduceTimeline({ ...base, messages, events: base.events.slice(0, 1) })[0],
  ).toMatchObject({ status: "running" });
});

it("does not consume a later start for an interrupted persisted same-ID call", () => {
  const call = {
    id: "c1",
    type: "function" as const,
    function: { name: "read_file", arguments: "{}" },
  };
  const interrupted = sessionSnapshotSchema.parse({
    ...base,
    status: "running",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: null, tool_calls: [call] },
      {
        role: "tool",
        tool_call_id: "c1",
        content: JSON.stringify({ content: "interrupted", isError: true }),
      },
      { role: "user", content: "retry" },
      { role: "assistant", content: null, tool_calls: [call] },
    ],
    events: base.events.slice(0, 1),
  });
  const tools = reduceTimeline(interrupted).filter(
    (item) => item.kind === "tool",
  );
  expect(tools.map((item) => [item.status, item.output])).toEqual([
    ["failed", "interrupted"],
    ["running", ""],
  ]);
});

it("positions prior errors at proven run boundaries without inventing message timestamps", () => {
  const started = (timestamp: string) => ({
    type: "run_started" as const,
    sessionId: id,
    timestamp,
    model: "m",
    permission: "readonly" as const,
  });
  const history = sessionSnapshotSchema.parse({
    ...base,
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second" },
      { role: "assistant", content: "second answer" },
    ],
    events: [
      started("2026-01-01T00:00:00Z"),
      {
        type: "error",
        sessionId: id,
        timestamp: "2026-01-01T00:00:01Z",
        error: { code: "provider", message: "old failure", retryable: true },
      },
      started("2026-01-01T00:00:02Z"),
    ],
  });
  expect(
    reduceTimeline(history).map((item) =>
      item.kind === "error"
        ? item.message
        : item.kind === "message"
          ? item.content
          : item.output,
    ),
  ).toEqual([
    "first",
    "first answer",
    "old failure",
    "second",
    "second answer",
  ]);
});

it("does not reuse a completed old start for a later unexecuted same-ID call", () => {
  const call = {
    id: "c1",
    type: "function" as const,
    function: { name: "read_file", arguments: "{}" },
  };
  const history = sessionSnapshotSchema.parse({
    ...base,
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: "c1", content: "ok" },
      { role: "user", content: "second" },
      { role: "assistant", content: null, tool_calls: [call] },
    ],
  });
  expect(
    reduceTimeline(history)
      .filter((item) => item.kind === "tool")
      .map((item) => item.status),
  ).toEqual(["completed", "unexecuted"]);
});

it("metadata-only child joins preserve human run alignment and repeated call correlation", () => {
  const call = {
    id: "same",
    type: "function" as const,
    function: { name: "read_file", arguments: "{}" },
  };
  const start = (timestamp: string) => ({
    type: "run_started" as const,
    sessionId: id,
    timestamp,
    model: "m",
    permission: "readonly" as const,
  });
  const history = sessionSnapshotSchema.parse({
    ...base,
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: null, tool_calls: [call] },
      {
        role: "user",
        origin: "agent_reconciliation",
        content: '子代理汇总：{"result":1}',
      },
      { role: "tool", tool_call_id: "same", content: "first result" },
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "user", content: '子代理汇总：{"result":1}' },
      { role: "assistant", content: "second answer" },
    ],
    events: [
      start("2026-01-01T00:00:00Z"),
      {
        type: "tool_started",
        sessionId: id,
        timestamp: "2026-01-01T00:00:01Z",
        call,
      },
      {
        type: "tool_finished",
        sessionId: id,
        timestamp: "2026-01-01T00:00:02Z",
        toolCallId: "same",
        result: { content: "first result", isError: false },
      },
      {
        type: "tool_started",
        sessionId: id,
        timestamp: "2026-01-01T00:00:03Z",
        call,
      },
      {
        type: "tool_finished",
        sessionId: id,
        timestamp: "2026-01-01T00:00:04Z",
        toolCallId: "same",
        result: { content: "second result", isError: true },
      },
      {
        type: "error",
        sessionId: id,
        timestamp: "2026-01-01T00:00:05Z",
        error: {
          code: "provider",
          message: "first run failure",
          retryable: true,
        },
      },
      start("2026-01-01T00:00:06Z"),
    ],
  });
  const timeline = reduceTimeline(history);
  expect(
    timeline
      .filter((item) => item.kind === "tool")
      .map((item) => [item.status, item.output]),
  ).toEqual([
    ["completed", "first result"],
    ["failed", "second result"],
  ]);
  expect(
    timeline
      .filter((item) => item.kind === "message")
      .map((item) => item.origin),
  ).toEqual([undefined, "agent_reconciliation", undefined, undefined]);
  const errorIndex = timeline.findIndex((item) => item.kind === "error");
  expect(timeline[errorIndex + 1]).toMatchObject({
    kind: "message",
    role: "user",
    content: '子代理汇总：{"result":1}',
  });
});
