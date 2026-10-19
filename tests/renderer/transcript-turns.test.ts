import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  computeTurnSummary,
  groupTurnEntries,
  partitionTurns,
  PlanStageDivider,
  StoredTranscript,
} from "../../src/renderer/components/workbench/Transcript";
import type { TimelineItem } from "../../src/renderer/state/timeline";
import { sessionSnapshotSchema } from "../../src/shared/schemas";

const toolCall = {
  id: "call-1",
  type: "function" as const,
  function: { name: "read_file", arguments: '{"path":"main.ts"}' },
};

const userItem = (id: string, content: string): TimelineItem => ({
  kind: "message",
  id,
  role: "user",
  content,
});

const assistantItem = (id: string, content: string): TimelineItem => ({
  kind: "message",
  id,
  role: "assistant",
  content,
});

const toolItem = (id: string): TimelineItem => ({
  kind: "tool",
  id,
  call: toolCall,
  status: "completed",
  output: "ok",
});

describe("Transcript Turn partitioning and grouping", () => {
  it("partitions a multi-turn conversation into separate turns", () => {
    const timeline: TimelineItem[] = [
      userItem("u1", "First prompt"),
      toolItem("t1"),
      assistantItem("a1", "First reply"),
      userItem("u2", "Second prompt"),
      toolItem("t2"),
      toolItem("t3"),
      assistantItem("a2", "Second reply"),
    ];

    const turns = partitionTurns(timeline);
    expect(turns).toHaveLength(2);

    expect(turns[0].turnNumber).toBe(1);
    expect(turns[0].userEntry?.item.content).toBe("First prompt");
    expect(turns[0].items).toHaveLength(2); // t1, a1

    expect(turns[1].turnNumber).toBe(2);
    expect(turns[1].userEntry?.item.content).toBe("Second prompt");
    expect(turns[1].items).toHaveLength(3); // t2, t3, a2
  });

  it("does not start a new turn for agent reconciliation internal messages", () => {
    const timeline: TimelineItem[] = [
      userItem("u1", "First prompt"),
      {
        kind: "message",
        id: "recon-1",
        role: "user",
        origin: "agent_reconciliation",
        content: "sub-agent summary",
      },
      assistantItem("a1", "Done"),
    ];

    const turns = partitionTurns(timeline);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnNumber).toBe(1);
    expect(turns[0].items).toHaveLength(2); // recon-1 and a1
  });

  it("groups consecutive tool calls without stage headers into a tool_group", () => {
    const entries = [
      { item: toolItem("t1"), index: 0 },
      { item: toolItem("t2"), index: 1 },
      { item: assistantItem("a1", "Reply"), index: 2 },
    ];
    const headers = [null, null, null];

    const blocks = groupTurnEntries(entries, headers);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe("tool_group");
    if (blocks[0].kind === "tool_group") {
      expect(blocks[0].entries).toHaveLength(2);
    }
    expect(blocks[1].kind).toBe("single");
  });

  it("computes accurate summary statistics for collapsed turns", () => {
    const items = [
      { item: toolItem("t1"), index: 0 },
      { item: toolItem("t2"), index: 1 },
      { item: assistantItem("a1", "Reply"), index: 2 },
    ];
    const summary = computeTurnSummary(items);
    expect(summary).toContain("2 次工具调用");
    expect(summary).toContain("已回复");
  });

  it("renders StoredTranscript with turn container, turn badge and compact tool call group", () => {
    const snapshot = sessionSnapshotSchema.parse({
      version: 1,
      id: "22222222-2222-4222-8222-222222222222",
      title: "turn test",
      workspace: "/tmp",
      model: "m",
      status: "completed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [
        { role: "user", content: "优化对话区域" },
        {
          role: "assistant",
          content: "已优化完成",
          tool_calls: [toolCall],
        },
        { role: "tool", tool_call_id: "call-1", content: "ok" },
      ],
      events: [],
      changes: [],
    });

    const html = renderToStaticMarkup(createElement(StoredTranscript, { snapshot }));

    expect(html).toContain('class="transcript-turn"');
    expect(html).toContain('class="transcript-turn-badge"');
    expect(html).toContain("第 1 轮");
    expect(html).toContain('class="transcript-turn-toggle"');
    expect(html).toContain("收起本轮");
    expect(html).toContain('class="tool-call-group"');
    expect(html).toContain("已优化完成");
  });

  it("renders PlanStageDivider with title, progress fill percentage, and count ratio", () => {
    const html = renderToStaticMarkup(
      createElement(PlanStageDivider, {
        title: "修订文档中的关联、去重、交接与验证方案",
        completed: 1,
        total: 3,
        percent: 33,
      }),
    );

    expect(html).toContain('class="transcript-stage-divider"');
    expect(html).toContain('class="transcript-stage-title"');
    expect(html).toContain("修订文档中的关联、去重、交接与验证方案");
    expect(html).toContain('class="transcript-stage-track"');
    expect(html).toContain('class="transcript-stage-fill"');
    expect(html).toContain('style="width:33%"');
    expect(html).toContain('class="transcript-stage-count"');
    expect(html).toContain("1/3");
  });

  it("separates update_plan tool entries as single blocks between surrounding tools", () => {
    const planTool: TimelineItem = {
      kind: "tool",
      id: "plan-tool-1",
      call: {
        id: "call-plan",
        type: "function",
        function: {
          name: "update_plan",
          arguments: JSON.stringify({
            explanation: "e",
            steps: [{ step: "s1", status: "completed" }, { step: "s2", status: "in_progress" }],
          }),
        },
      },
      status: "completed",
      output: JSON.stringify({
        explanation: "e",
        steps: [{ step: "s1", status: "completed" }, { step: "s2", status: "in_progress" }],
      }),
      changes: [],
    };

    const entries = [
      { item: toolItem("t1"), index: 0 },
      { item: planTool, index: 1 },
      { item: toolItem("t2"), index: 2 },
    ];
    const headers = [null, null, null];
    const blocks = groupTurnEntries(entries, headers);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].kind).toBe("tool_group");
    expect(blocks[1].kind).toBe("single");
    expect(blocks[1].entry.item.id).toBe("plan-tool-1");
    expect(blocks[2].kind).toBe("tool_group");
  });
});
