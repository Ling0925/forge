import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ToolDisclosure } from "../../src/renderer/components/primitives/ToolDisclosure";
import type { SessionSnapshot } from "../../src/renderer/shared-types";
import { reduceTimeline } from "../../src/renderer/state/timeline";
import { sessionSnapshotSchema } from "../../src/shared/schemas";

const id = sessionSnapshotSchema.parse({
  version: 1,
  id: "11111111-1111-4111-8111-111111111111",
  title: "t",
  workspace: "/tmp",
  model: "m",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:05Z",
  status: "completed",
  messages: [],
  events: [],
  changes: [],
}).id;

const call = {
  id: "c1",
  type: "function" as const,
  function: {
    name: "run_command",
    arguments: JSON.stringify({
      argv: ["git", "status", "--short"],
      cwd: "/tmp/project",
    }),
  },
};

/**
 * The card must survive the real persisted path: a tool result envelope stored
 * in a `tool` message reaches the timeline, then the card, decoded — no raw
 * protocol JSON at the reader and a measured duration from real events.
 */
it("decodes a persisted command result end to end without leaking JSON", () => {
  const snapshot: SessionSnapshot = sessionSnapshotSchema.parse({
    version: 1,
    id,
    title: "t",
    workspace: "/tmp/project",
    model: "m",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:05Z",
    status: "completed",
    messages: [
      { role: "user", content: "status" },
      { role: "assistant", content: null, tool_calls: [call] },
      {
        role: "tool",
        tool_call_id: "c1",
        content: JSON.stringify({
          content: JSON.stringify({
            stdout: " M src/a.ts\n?? src/b.ts",
            stderr: "",
            exit_code: 0,
            duration_ms: 55,
            truncated: false,
          }),
          isError: false,
        }),
      },
    ],
    events: [
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
        toolCallId: "c1",
        result: {
          content: JSON.stringify({
            stdout: " M src/a.ts\n?? src/b.ts",
            stderr: "",
            exit_code: 0,
            duration_ms: 55,
            truncated: false,
          }),
          isError: false,
        },
      },
    ],
    changes: [],
  }) as SessionSnapshot;
  const item = reduceTimeline(snapshot).find((entry) => entry.kind === "tool");
  if (item?.kind !== "tool") throw new Error("missing tool item");
  // Real event timestamps produce the measured duration.
  expect(item.durationMs).toBe(1000);
  // `unexecuted` is a transcript-only state (a call with no executed record);
  // this persisted exchange is a completed execution.
  expect(item.status).toBe("completed");
  if (item.status === "unexecuted")
    throw new Error("unexpected unexecuted call");
  const html = renderToStaticMarkup(
    createElement(ToolDisclosure, {
      toolName: item.call.function.name,
      command: "git status --short",
      cwd: "/tmp/project",
      output: item.output,
      status: item.status,
      ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
      defaultExpanded: true,
    }),
  );
  // Both stdout lines are readable, and no escaped-JSON artifact remains.
  expect(html).toContain(" M src/a.ts");
  expect(html).toContain("?? src/b.ts");
  expect(html).not.toContain("&quot;stdout&quot;");
  expect(html).not.toContain("stdout\\n");
  // The header shows the measured event duration (1s, one decimal below 10s);
  // the console keeps the process's own reported time as a separate fact.
  expect(html).toContain("1.0s");
  expect(html).toContain("55ms");
  expect(html).toContain("进程耗时");
});
