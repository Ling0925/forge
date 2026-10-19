import { expect, it } from "vitest";
import { shouldRefreshTranscript } from "../../src/renderer/state/refresh-events";

it("refreshes the transcript as soon as the accepted user turn is persisted", () => {
  // The runtime saves the user message and then emits run_started; without this
  // the sent message stays invisible until the first tool or run_finished.
  expect(shouldRefreshTranscript("run_started")).toBe(true);
  expect(shouldRefreshTranscript("title_changed")).toBe(true);
});

it("also refreshes when a tool, agent or approval changes the stored transcript", () => {
  expect(shouldRefreshTranscript("tool_started")).toBe(true);
  expect(shouldRefreshTranscript("tool_finished")).toBe(true);
  expect(shouldRefreshTranscript("agent_update")).toBe(true);
  expect(shouldRefreshTranscript("approval_requested")).toBe(true);
});

it("does not refetch for high-frequency stream deltas", () => {
  expect(shouldRefreshTranscript("text_delta")).toBe(false);
  expect(shouldRefreshTranscript("reasoning_delta")).toBe(false);
});
