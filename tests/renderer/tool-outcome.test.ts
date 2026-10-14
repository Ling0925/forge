import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../../src/renderer/shared-types";
import { toolOutcome } from "../../src/renderer/state/tool-outcome";
import { sessionIdSchema } from "../../src/shared/schemas";
const snapshot: SessionSnapshot = {
  version: 1,
  id: sessionIdSchema.parse("11111111-1111-4111-8111-111111111111"),
  title: "Approval task",
  workspace: "/tmp/task",
  model: "model",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  status: "cancelled",
  messages: [],
  events: [],
  changes: [],
};
function persisted(content: string): SessionSnapshot {
  return {
    ...snapshot,
    messages: [{ role: "tool", tool_call_id: "command-1", content }],
  };
}
describe("persisted tool outcomes", () => {
  it.each(["Cancelled before execution", "Permission denied by user"])(
    "does not claim completion for %s without tool_finished",
    (content) => {
      const saved = persisted(JSON.stringify({ content, isError: true }));
      expect(toolOutcome(saved, "command-1")).toEqual({
        status: "failed",
        output: content,
      });
      expect(saved.events).toEqual([]);
    },
  );
  it("recognizes validated successful persisted results after reload", () => {
    expect(
      toolOutcome(
        persisted(JSON.stringify({ content: "exit code 0", isError: false })),
        "command-1",
      ),
    ).toEqual({ status: "completed", output: "exit code 0" });
  });
  it.each([
    "not JSON",
    '{"content":"cancelled"}',
    '{"content":"ok","isError":"false"}',
  ])("does not treat invalid result %s as success", (content) => {
    expect(toolOutcome(persisted(content), "command-1").status).toBe("failed");
  });
  it("uses actual tool_finished data without modifying chronological events", () => {
    const saved: SessionSnapshot = {
      ...persisted(JSON.stringify({ content: "older", isError: false })),
      events: [
        {
          type: "tool_finished",
          sessionId: snapshot.id,
          timestamp: snapshot.updatedAt,
          toolCallId: "command-1",
          result: { content: "execution failed", isError: true },
        },
      ],
    };
    const before = JSON.stringify(saved);
    expect(toolOutcome(saved, "command-1")).toEqual({
      status: "failed",
      output: "execution failed",
    });
    expect(JSON.stringify(saved)).toBe(before);
  });
  it("does not leave an unsettled call running after cancellation", () => {
    expect(toolOutcome(snapshot, "command-1").status).toBe("failed");
    expect(
      toolOutcome({ ...snapshot, status: "awaiting_approval" }, "command-1")
        .status,
    ).toBe("running");
  });
});
