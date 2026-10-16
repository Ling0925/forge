import { expect, it } from "vitest";
import {
  foldedTool,
  phaseMarkers,
} from "../../src/renderer/components/workbench/Transcript";
import type { TimelineItem } from "../../src/renderer/state/timeline";
import type { ToolCall } from "../../src/shared-types";

const call: ToolCall = {
  id: "t",
  type: "function",
  function: { name: "read_file", arguments: '{"path":"a.ts"}' },
};
const user = (id: string): TimelineItem => ({
  kind: "message",
  id,
  role: "user",
  content: "go",
});
const assistant = (id: string): TimelineItem => ({
  kind: "message",
  id,
  role: "assistant",
  content: "ok",
});
const tool = (id: string): TimelineItem => ({
  kind: "tool",
  id,
  call,
  status: "completed",
  output: "",
});
const internal = (id: string): TimelineItem => ({
  kind: "message",
  id,
  role: "user",
  content: "join",
  origin: "agent_reconciliation",
});

it("opens a new phase only on a real human turn", () => {
  const phases = phaseMarkers([
    user("u1"),
    assistant("a1"),
    tool("t1"),
    user("u2"),
  ]);
  expect([...phases]).toEqual([1, 1, 1, 2]);
  // Internal reconciliation joins do not open a phase.
  expect([...phaseMarkers([user("u1"), internal("i1"), tool("t1")])]).toEqual([
    1, 1, 1,
  ]);
});

it("folds older tool phases but leaves the current phase open", () => {
  const phases = phaseMarkers([user("u1"), tool("t1"), user("u2"), tool("t2")]);
  expect(foldedTool(1, phases)).toBe(true); // t1 is in the past phase
  expect(foldedTool(3, phases)).toBe(false); // t2 is in the current phase
  // A single-phase transcript never folds.
  const single = phaseMarkers([user("u1"), tool("t1")]);
  expect(foldedTool(1, single)).toBe(false);
});
