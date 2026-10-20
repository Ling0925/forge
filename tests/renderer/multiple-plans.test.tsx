import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  listWorkspaceDirectory,
  readWorkspaceFilePreview,
} from "../../src/core/workspace-files";
import { parseContextMemory } from "../../src/renderer/components/workbench/context-memory-parser";
import {
  ContextMemoryView,
  PlanDocumentPanel,
  PlanProgressPanel,
  PlanSection,
} from "../../src/renderer/components/workbench/RuntimePanels";
import { ToolDisclosure } from "../../src/renderer/components/primitives/ToolDisclosure";
import { mergeTranscript } from "../../src/renderer/state/transcript-sync";
import { initialWorkbenchState, workbenchReducer, type WorkbenchState } from "../../src/renderer/state/workbench-reducer";
import { runIdSchema } from "../../src/shared/ipc";
import { sessionSnapshotSchema, type TaskPlan } from "../../src/shared/schemas";

const first: TaskPlan = { id: "plan-a", title: "First task", explanation: "Task A only",
  steps: [{ step: "A verified", status: "completed" }] };
const second: TaskPlan = { id: "plan-b", title: "Second task", explanation: "Task B only",
  steps: [{ step: "B work", status: "in_progress" }] };
const snapshot = sessionSnapshotSchema.parse({ version: 1, id: "11111111-1111-4111-8111-111111111111",
  title: "Task", workspace: "/workspace", model: "fixture", status: "running",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", messages: [], events: [], changes: [],
  plan: first, plans: [first],
});

describe("multiple plan surfaces", () => {
  it("shows independent current and historical plans plus legacy snapshots", () => {
    const html = renderToStaticMarkup(createElement(PlanSection, { snapshot: { plan: second, plans: [first, second] } }));
    expect(html).toContain("Second task");
    expect(html).toContain("历史计划 1");
    expect(html).toContain("First task");
    expect(html).toContain("A verified");
    expect(html).toContain("B work");
    expect(html).toContain("1/1 已完成");
    const legacy = { explanation: "Old work", steps: first.steps };
    const oldHtml = renderToStaticMarkup(createElement(PlanSection, { snapshot: { plan: legacy } }));
    expect(oldHtml).toContain("原有计划");
    expect(oldHtml).not.toContain("历史计划");
  });

  it.each(["create_plan", "update_plan"])("shows the identity of a plan in %s output", (toolName) => {
    const html = renderToStaticMarkup(createElement(ToolDisclosure, { toolName, status: "completed",
      defaultExpanded: true, parameters: second, output: JSON.stringify(second) }));
    expect(html).toContain("Second task");
    expect(html).toContain('title="plan-b"');
  });

  it("upserts live plans by ID and keeps them when a stale snapshot arrives", () => {
    const runId = runIdSchema.parse("33333333-3333-4333-8333-333333333333");
    let state: WorkbenchState = { ...initialWorkbenchState, activeSessionId: snapshot.id, activeSnapshot: snapshot };
    const update = (plan: TaskPlan, timestamp: string) => workbenchReducer(state, {
      type: "RUN_EVENT_RECEIVED", event: { runId, event: { type: "plan_updated", sessionId: snapshot.id, timestamp, plan } },
    });
    state = update(second, "2026-01-01T00:00:01.000Z");
    expect(state.activeSnapshot?.plans).toEqual([first, second]);
    const revised = { ...first, explanation: "A follow-up", steps: [{ step: "A follow-up", status: "pending" as const }] };
    state = update(revised, "2026-01-01T00:00:02.000Z");
    expect(state.activeSnapshot?.plans).toEqual([revised, second]);
    expect(state.activeSnapshot?.plan).toEqual(revised);
    const merged = mergeTranscript(state.activeSnapshot, snapshot);
    expect(merged.plans).toEqual([revised, second]);
    expect(merged.plan).toEqual(revised);
  });

  it("separates Plan documentation/history from PlanProgress checklist and stats", () => {
    const docHtml = renderToStaticMarkup(
      createElement(PlanDocumentPanel, {
        snapshot: { plan: second, plans: [first, second] },
      }),
    );
    expect(docHtml).toContain("Second task");
    expect(docHtml).toContain("Task B only");
    expect(docHtml).toContain("历史计划 1");
    expect(docHtml).toContain("First task");

    const progressHtml = renderToStaticMarkup(
      createElement(PlanProgressPanel, {
        snapshot: { plan: second, plans: [first, second] },
      }),
    );
    expect(progressHtml).toContain("计划进度");
    expect(progressHtml).toContain("B work");
    expect(progressHtml).toContain("进行中 1");
    expect(progressHtml).not.toContain("历史计划 1");
  });

  it("lists workspace entries safely and previews UTF-8 files while filtering sensitive paths", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-ws-files-"));
    try {
      mkdirSync(join(workspace, "src"));
      writeFileSync(join(workspace, "src", "index.ts"), "export const ok = 42;\n");
      writeFileSync(join(workspace, ".env"), "SECRET_KEY=topsecret\n");

      const rootListing = await listWorkspaceDirectory(workspace);
      expect(rootListing.entries.map((entry) => entry.name)).toEqual(["src"]);

      const srcListing = await listWorkspaceDirectory(workspace, "src");
      expect(srcListing.entries.map((entry) => entry.path)).toEqual([
        "src/index.ts",
      ]);

      const preview = await readWorkspaceFilePreview(workspace, "src/index.ts");
      expect(preview.binary).toBe(false);
      expect(preview.content).toContain("export const ok = 42;");

      await expect(
        readWorkspaceFilePreview(workspace, ".env"),
      ).rejects.toThrow();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("parses working-state and run-checkpoint JSON memories into readable structured views", () => {
    const workingStateRaw = `Archive: m1..m12 in this session. Original records remain persisted. This state uses partial excerpts, NOT exhaustive coverage. Use history_search and history_read for missing constraints, evidence and exact details. Never replay historical actions.\nWorking state:\n${JSON.stringify({
      goal: "重构右侧会话信息栏",
      constraints: [{ text: "合并Token统计为单一总量统计", refs: ["m1", "m2"] }],
      decisions: [{ text: "解析记忆JSON结构化展示", refs: ["m4"] }],
      completed: [{ text: "完成文件管理面板", refs: ["m8"] }],
      nextSteps: [{ text: "运行聚焦测试", refs: ["m10"] }],
      verification: [],
      uncertainties: [],
    })}`;
    const parsedWs = parseContextMemory(workingStateRaw);
    expect(parsedWs.kind).toBe("working_state");
    const wsHtml = renderToStaticMarkup(
      createElement(ContextMemoryView, { parsed: parsedWs }),
    );
    expect(wsHtml).toContain("任务目标");
    expect(wsHtml).toContain("重构右侧会话信息栏");
    expect(wsHtml).toContain("合并Token统计为单一总量统计");
    expect(wsHtml).toContain("解析记忆JSON结构化展示");
    expect(wsHtml).toContain("m1");
    expect(wsHtml).not.toContain('"constraints"');

    const runCheckpointRaw = `Local run-end checkpoint; partial observations, NOT a verified semantic summary. Completed means the run ended, not that the user's goal is proven. All original records m1..m10 remain available through history_search/history_read. Inspect omitted constraints and evidence before proceeding; never replay actions from history.\n${JSON.stringify({
      status: "completed",
      endedAt: "2026-10-20T09:30:00.000Z",
      initialRequest: {
        ref: "m1",
        text: JSON.stringify({ role: "user", content: "初始用户请求内容" }),
        truncated: false,
      },
      latestRequest: {
        ref: "m5",
        text: JSON.stringify({ role: "user", content: "最新用户请求内容" }),
        truncated: false,
      },
      latestAssistantReport: {
        ref: "m8",
        text: JSON.stringify({ role: "assistant", content: "助手最终报告正文" }),
        truncated: false,
      },
      planExcerpt: JSON.stringify({
        title: "检查点计划",
        steps: [{ step: "步骤一", status: "completed" }],
      }),
      priorMemoryExcerpt: null,
      toolObservations: [
        {
          ref: "m7",
          text: JSON.stringify({
            role: "tool",
            content: JSON.stringify({ stdout: "命令执行成功输出", exit_code: 0 }),
          }),
          truncated: false,
        },
      ],
      effectsMayBeUncertain: false,
    })}`;
    const parsedRc = parseContextMemory(runCheckpointRaw);
    expect(parsedRc.kind).toBe("run_checkpoint");
    const rcHtml = renderToStaticMarkup(
      createElement(ContextMemoryView, { parsed: parsedRc }),
    );
    expect(rcHtml).toContain("运行检查点 · 已完成");
    expect(rcHtml).toContain("初始用户请求内容");
    expect(rcHtml).toContain("最新用户请求内容");
    expect(rcHtml).toContain("助手最终报告正文");
    expect(rcHtml).toContain("检查点计划");
    expect(rcHtml).toContain("命令执行成功输出");
    expect(rcHtml).not.toContain('"latestAssistantReport"');
  });
});
