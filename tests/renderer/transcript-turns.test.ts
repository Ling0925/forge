import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  computeTurnSummary,
  groupTurnEntries,
  partitionTurns,
  PlanStageDivider,
  StoredTranscript,
  ToolPreviews,
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

  it("keeps consecutive tools with different steps in the same compact tool_group", () => {
    const entries = [
      { item: { ...toolItem("t1"), step: 1 }, index: 0 },
      { item: { ...toolItem("t2"), step: 2 }, index: 1 },
      { item: { ...toolItem("t3"), step: 3 }, index: 2 },
    ];
    const headers = [null, null, null];
    const blocks = groupTurnEntries(entries, headers);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("tool_group");
    if (blocks[0].kind === "tool_group") {
      expect(blocks[0].entries).toHaveLength(3);
    }
  });

  it("keeps a title-less stage header from splitting the first tool row out of the group", () => {
    const entries = [
      { item: toolItem("t1"), index: 0 },
      { item: toolItem("t2"), index: 1 },
    ];
    // A phase marker without a title renders nothing (StageHeader returns null),
    // so it must not cost the first row its compact 1px group rhythm.
    const headers = [{ id: 1, title: null }, null];
    const blocks = groupTurnEntries(entries, headers);
    expect(blocks.map((block) => block.kind)).toEqual(["tool_group"]);
    expect(
      blocks.map((block) =>
        block.kind === "tool_group" ? block.entries.length : 0,
      ),
    ).toEqual([2]);
  });

  it("still starts a new block when the stage header carries a title", () => {
    const entries = [
      { item: toolItem("t1"), index: 0 },
      { item: toolItem("t2"), index: 1 },
    ];
    const headers = [
      null,
      { id: 1, title: "检查参数", completed: 0, total: 2, percent: 0 },
    ];
    const blocks = groupTurnEntries(entries, headers);
    expect(blocks.map((block) => block.kind)).toEqual(["tool_group", "single"]);
    expect(
      blocks.map((block) =>
        block.kind === "single" ? block.entry.item.id : "",
      ),
    ).toEqual(["", "t2"]);
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
    expect(html).toContain('class="transcript-stage-fill-active"');
    expect(html).toContain('style="width:33%"');
    expect(html).toContain('class="transcript-stage-count"');
    expect(html).toContain("1/3");
  });

  it("renders animated active progress segment for in-progress stage at 0/3 and omits it when all steps are completed", () => {
    const initialHtml = renderToStaticMarkup(
      createElement(PlanStageDivider, {
        title: "检查模型发现调用链、存储约定及相关测试，确定最小实现范围",
        completed: 0,
        total: 3,
        plan: {
          steps: [
            { step: "检查模型发现调用链、存储约定及相关测试，确定最小实现范围", status: "in_progress" },
            { step: "实现按来源隔离的模型元数据持久缓存并接通刷新入口", status: "pending" },
            { step: "运行聚焦功能测试并编译 CLI，检查 diff 后提交本轮修改", status: "pending" },
          ],
        },
      }),
    );

    expect(initialHtml).toContain('class="transcript-stage-fill" style="width:0%"');
    expect(initialHtml).toContain('class="transcript-stage-fill-active" style="width:33%"');
    expect(initialHtml).toContain("0/3");

    const completedHtml = renderToStaticMarkup(
      createElement(PlanStageDivider, {
        title: "全部步骤已完成",
        completed: 3,
        total: 3,
        plan: {
          steps: [
            { step: "步骤 1", status: "completed" },
            { step: "步骤 2", status: "completed" },
            { step: "步骤 3", status: "completed" },
          ],
        },
      }),
    );

    expect(completedHtml).toContain('class="transcript-stage-fill" style="width:100%"');
    expect(completedHtml).not.toContain("transcript-stage-fill-active");
    expect(completedHtml).toContain("3/3");
  });

  it.each(["create_plan", "update_plan"])("separates %s tool entries as single blocks between surrounding tools", (name) => {
    const planTool: TimelineItem = {
      kind: "tool",
      id: "plan-tool-1",
      call: {
        id: "call-plan",
        type: "function",
        function: {
          name,
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

  it("renders live tool previews with real-time diff badges (+added / -removed)", () => {
    const html = renderToStaticMarkup(
      createElement(ToolPreviews, {
        previews: [
          {
            previewId: "write-1",
            name: "write_file",
            argumentsChars: 3878,
            linesAdded: 123,
            linesRemoved: 12,
          },
        ],
      }),
    );

    expect(html).toContain('class="tool-diff-stat tool-diff-added tool-live-diff"');
    expect(html).toContain("+123");
    expect(html).toContain('class="tool-diff-stat tool-diff-removed tool-live-diff"');
    expect(html).toContain("-12");
    expect(html).toContain("3878 字符");
    expect(html).toContain("生成参数中");
  });
});
