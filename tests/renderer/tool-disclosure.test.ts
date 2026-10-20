import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiffViewer } from "../../src/renderer/components/primitives/DiffViewer";
import {
  ToolDisclosure,
  type ToolDisclosureProps,
} from "../../src/renderer/components/primitives/ToolDisclosure";
import { createDiffPatch } from "../../src/shared/diff";

const render = (props: ToolDisclosureProps) =>
  renderToStaticMarkup(createElement(ToolDisclosure, props));

describe("tool disclosure row", () => {
  it.each(["src/renderer/a.ts", "C:\\workspace\\a.ts"])(
    "shows only the read filename in the header and the full path in details (%s)",
    (path) => {
      const html = render({
        toolName: "read_file",
        status: "completed",
        parameters: { path },
        defaultExpanded: true,
      });
      expect(html).toMatch(/class="tool-disclosure-target"[^>]*>a.ts<\/span>/);
      expect(html).toContain(
        `class="tool-section-content tool-read-path">${path}</pre>`,
      );
    },
  );
  it("opens failures and shows the supplied error once without an empty result", () => {
    for (const output of [
      undefined,
      "Access denied",
      JSON.stringify({ error: "Access denied" }),
    ]) {
      const html = render({
        toolName: "read_file",
        status: "failed",
        error: "Access denied",
        ...(output === undefined ? {} : { output }),
      });
      expect(html).toContain('aria-expanded="true"');
      expect(html.match(/Access denied/g)).toHaveLength(1);
      expect(html).not.toContain("未记录具体原因");
      expect(html).not.toContain('title">结果');
    }
  });

  it("places results before collapsed arguments", () => {
    const html = render({
      toolName: "list_files",
      status: "completed",
      defaultExpanded: true,
      parameters: { path: "src/a.ts" },
      output: "file contents",
    });
    expect(html.indexOf("file contents")).toBeLessThan(
      html.indexOf("调用参数"),
    );
    expect(html).toContain('<details class="tool-details">');
  });

  it("names the action and its target on the collapsed line, not just a symbol", () => {
    const html = render({
      toolName: "read_file",
      target: "src/a.ts",
      status: "completed",
    });
    expect(html).toContain("读取文件");
    expect(html).toContain("src/a.ts");
    expect(html).toContain('data-status="completed"');
  });

  it("falls back to a generic label for unknown tools", () => {
    const html = render({ toolName: "grep_client", status: "running" });
    expect(html).toContain("工具调用");
  });

  it("explains a command and keeps the concrete command in the expanded view", () => {
    const html = render({
      toolName: "run_command",
      target: "node --version",
      command: "node --version",
      cwd: "/tmp/project",
      status: "completed",
      defaultExpanded: true,
    });
    expect(html).toContain("运行命令");
    expect(html).toContain("命令");
    expect(html).toContain("node --version");
    expect(html).toContain("/tmp/project");
  });

  it("keeps a running command collapsed by default to avoid completion jitter, and opens when defaultExpanded", () => {
    const collapsed = render({
      toolName: "run_command",
      command: "rm -rf /",
      status: "running",
    });
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain("rm -rf /");

    const expanded = render({
      toolName: "run_command",
      command: "rm -rf /",
      status: "running",
      defaultExpanded: true,
    });
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain("rm -rf /");
    expect(expanded).toContain("结果");
  });

  it("renders parsed parameter rows instead of a raw JSON blob", () => {
    const html = render({
      toolName: "list_files",
      parameters: JSON.stringify({ path: "src/a.ts", offset: 40, limit: 80 }),
      status: "completed",
      defaultExpanded: true,
    });
    expect(html).toContain('class="tool-params"');
    expect(html).toContain("路径"); // human label for `path`
    expect(html).toContain("src/a.ts");
    expect(html).toContain("上限"); // human label for `limit`
    // The arguments are not dumped as a raw JSON object.
    expect(html).not.toContain('{"path"');
  });

  it("keeps a command card to the command and result, not parsed argument chips", () => {
    const html = render({
      toolName: "run_command",
      command: "node --version",
      parameters: JSON.stringify({ argv: ["node", "--version"] }),
      output: "v22.0.0",
      status: "completed",
      defaultExpanded: true,
    });
    // The parsed "参数输入" rows are dropped from a command card.
    expect(html).not.toContain('class="tool-param-chips"');
    expect(html).not.toContain("参数输入");
    // The command and its raw result are both shown.
    expect(html).toContain("node --version");
    expect(html).toContain("v22.0.0");
  });

  it("defaults to collapsed quiet rows for completed commands and reads", () => {
    const html = render({
      toolName: "run_command",
      command: "node --version",
      status: "completed",
    });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("node --version");
    expect(html).not.toContain('class="tool-terminal-output"');
  });

  it("falls back to plain text for malformed arguments", () => {
    const html = render({
      toolName: "list_files",
      parameters: "{not json",
      status: "completed",
      defaultExpanded: true,
    });
    expect(html).toContain("{not json");
  });

  it("decodes a command result envelope instead of printing escaped JSON", () => {
    const html = render({
      toolName: "run_command",
      command: "ls -la",
      status: "completed",
      output: JSON.stringify({
        stdout: "total 8\ndrwxr-xr-x 2 ling ling 4096 src",
        stderr: "",
        exit_code: 0,
        duration_ms: 42,
        truncated: false,
      }),
      defaultExpanded: true,
    });
    // The stdout is unescaped and readable, one line per row.
    expect(html).toContain("drwxr-xr-x 2 ling ling 4096 src");
    expect(html).not.toContain("total 8\\n");
    // The envelope's own JSON keys are not dumped at the reader.
    expect(html).not.toContain("&quot;stdout&quot;");
    // Machine facts are shown as quiet labelled values, not raw fields.
    expect(html).toContain("退出码 0");
    expect(html).toContain("42ms");
  });

  it("shows a command envelope's stderr and flags a timeout", () => {
    const html = render({
      toolName: "run_command",
      command: "sleep 30",
      status: "failed",
      output: JSON.stringify({
        stdout: "",
        stderr: "killed after deadline",
        exit_code: null,
        timed_out: true,
        duration_ms: 30000,
      }),
      defaultExpanded: true,
    });
    expect(html).toContain("killed after deadline");
    expect(html).toContain("命令超时后已被终止。");
    expect(html).toContain("30s");
  });

  it("renders plain console output verbatim", () => {
    const html = render({
      toolName: "run_command",
      command: "pnpm test",
      status: "completed",
      output: "✓ 4 tests passed\nTest Files  1 passed (1)",
      defaultExpanded: true,
    });
    expect(html).toContain("✓ 4 tests passed");
    expect(html).toContain("Test Files  1 passed (1)");
  });

  it("leads a failed non-command tool with its recorded reason", () => {
    const html = render({
      toolName: "read_file",
      target: "src/a.ts",
      status: "failed",
      output: JSON.stringify({
        error: "Workspace path rejected: outside root",
      }),
      defaultExpanded: true,
    });
    expect(html).toContain("失败原因");
    expect(html).toContain("Workspace path rejected: outside root");
    // Shown once: the reason is not repeated in the result rows.
    expect(html.match(/Workspace path rejected/g)).toHaveLength(1);
  });

  it("uses a plain-text result as the failure reason instead of printing it twice", () => {
    const html = render({
      toolName: "list_files",
      status: "failed",
      output: "boom",
      parameters: JSON.stringify({ path: "src" }),
      defaultExpanded: true,
    });
    expect(html).toContain("失败原因");
    expect(html).toContain("boom");
    // The plain-text result is the reason; it is not printed twice.
    expect(html.match(/boom/g)).toHaveLength(1);
  });

  it("says no reason was recorded rather than inventing one", () => {
    const html = render({
      toolName: "read_file",
      target: "src/a.ts",
      status: "failed",
      output: "",
      parameters: JSON.stringify({ path: "src/a.ts" }),
      defaultExpanded: true,
    });
    expect(html).toContain("失败原因");
    expect(html).toContain("失败，但未记录具体原因。");
  });

  it("gives a long multi-line result its own block instead of a one-line cell", () => {
    const html = render({
      toolName: "read_file",
      status: "completed",
      output: JSON.stringify({
        path: "src/a.ts",
        content: "1: const a = 1;\n2: const b = 2;\n3: export { a, b };",
      }),
      defaultExpanded: true,
    });
    expect(html).toContain('class="tool-param-block"');
    expect(html).toContain("3: export { a, b };");
    // A real line break survives rendering, not a literal \n escape.
    expect(html).not.toContain("1: const a = 1;\\n");
  });

  it("offers a copy control for the command and its output", () => {
    const html = render({
      toolName: "run_command",
      command: "git status --short",
      status: "completed",
      output: " M src/a.ts",
      defaultExpanded: true,
    });
    expect(html).toContain('aria-label="复制命令"');
    expect(html).toContain('aria-label="复制输出"');
  });

  it("marks a failed row with the word 失败, not only a glyph", () => {
    const html = render({
      toolName: "run_command",
      command: "false",
      status: "failed",
    });
    expect(html).toContain("tool-disclosure-failure");
    expect(html).toContain("失败");
    expect(html).toContain('data-status="failed"');
  });

  it("shows a measured duration when one is recorded", () => {
    const html = render({
      toolName: "read_file",
      target: "src/a.ts",
      status: "completed",
      durationMs: 1420,
      timestamp: "2026-01-01T00:00:01.000Z",
    });
    expect(html).toContain("1.4s");
  });

  it("warns when the shown evidence was clipped by the interface", () => {
    const html = render({
      toolName: "list_files",
      status: "completed",
      output: "src/a.ts",
      truncated: true,
      defaultExpanded: true,
    });
    expect(html).toContain("展示内容已截断");
  });

  it("decodes a background command task page into a console", () => {
    const html = render({
      toolName: "command_task",
      status: "running",
      parameters: JSON.stringify({ action: "status", id: "task-1" }),
      output: JSON.stringify({
        id: "task-1",
        status: "running",
        output_available: false,
        next_offset: null,
      }),
      defaultExpanded: true,
    });
    expect(html).not.toContain("&quot;output_available&quot;");
    expect(html).toContain("命令仍在运行，输出尚未生成。");
  });

  it("unwraps nested command envelope JSON inside command_task output cleanly", () => {
    const innerEnvelope = {
      stdout: "1 failed | 23 passed\nFAIL tests/core/memory.test.ts",
      stderr: "ExperimentalWarning: SQLite is an experimental feature",
      exit_code: 1,
      duration_ms: 1965,
    };
    const html = render({
      toolName: "command_task",
      status: "failed",
      parameters: JSON.stringify({
        action: "wait",
        id: "aa118abe-d428-4184-bd72-c45459a6eb79",
      }),
      output: JSON.stringify({
        id: "aa118abe-d428-4184-bd72-c45459a6eb79",
        status: "failed",
        output_available: true,
        exit_code: 1,
        output_id: "0d64fdcb-e750-4f0d-9180-7139ed89991d",
        preview_truncated: false,
        result_is_error: true,
        offset: 0,
        offset_units: "utf16_code_units",
        output: JSON.stringify(innerEnvelope),
      }),
      defaultExpanded: true,
    });

    // Inner stdout is rendered cleanly with genuine lines, not escaped JSON quotes
    expect(html).toContain("1 failed | 23 passed\nFAIL tests/core/memory.test.ts");
    expect(html).not.toContain("&quot;stdout&quot;");
    // Inner stderr is extracted into its own stream
    expect(html).toContain("标准错误");
    expect(html).toContain("ExperimentalWarning: SQLite is an experimental feature");
    // Exit code is surfaced
    expect(html).toContain("退出码 1");
    // Facts show duration and short task id, but omit internal protocol clutter
    expect(html).toContain("2.0s");
    expect(html).toContain("#aa118abe");
    expect(html).not.toContain("0d64fdcb-e750-4f0d-9180-7139ed89991d");
    expect(html).not.toContain("offset_units");
    expect(html).not.toContain("result_is_error");
    // Target is formatted cleanly with action and short id
    expect(html).toContain("等待完成 · #aa118abe");
  });

  it("renders command_task list view with structured task cards", () => {
    const html = render({
      toolName: "command_task",
      status: "completed",
      parameters: JSON.stringify({ action: "list" }),
      output: JSON.stringify({
        tasks: [
          {
            id: "task-abc12345-6789",
            status: "completed",
            title: "npm test",
            exit_code: 0,
            duration_ms: 1200,
          },
          {
            id: "task-def98765-4321",
            status: "failed",
            title: "cargo build",
            exit_code: 101,
            duration_ms: 3400,
          },
        ],
        pending_ids: [],
      }),
      defaultExpanded: true,
    });

    expect(html).toContain('class="command-tasks-view"');
    expect(html).toContain("#task-abc");
    expect(html).toContain("已完成");
    expect(html).toContain("npm test");
    expect(html).toContain("#task-def");
    expect(html).toContain("失败");
    expect(html).toContain("cargo build");
  });

  it("default-expands a file edit and shows the diff", () => {
    const html = render({
      toolName: "edit_file",
      target: "src/a.ts",
      status: "completed",
      changes: [
        {
          path: "src/a.ts",
          kind: "modified",
          patch: createDiffPatch("const old = 1;", "const next = 2;"),
        },
      ],
    });
    // No defaultExpanded: an edit opens itself and renders the change.
    expect(html).toContain("文件改动");
    expect(html).toContain("const next = 2;");
    expect(html).toContain("src/a.ts");
    // Only the diff is shown; the raw before/after argument rows are dropped.
    expect(html).not.toContain("参数输入");
    expect(html).not.toContain("原内容");
    expect(html).not.toContain("新内容");
  });

  it("shows colored +added / -removed counts in the file-edit header", () => {
    const before = ["keep", "old one", "old two", "tail"].join("\n");
    const after = ["keep", "new one", "new two", "extra", "tail"].join("\n");
    const html = render({
      toolName: "edit_file",
      target: "src/a.ts",
      status: "completed",
      changes: [
        {
          path: "src/a.ts",
          kind: "modified",
          patch: createDiffPatch(before, after),
        },
      ],
    });
    // 3 added (new one, new two, extra), 2 removed (old one, old two).
    expect(html).toContain('class="tool-diff-stat tool-diff-added">+3<');
    expect(html).toContain('class="tool-diff-stat tool-diff-removed">-2<');
  });

  it("shows a late edit from the patch, never a bogus no-difference message", () => {
    const beforeLines = Array.from({ length: 1800 }, (_, i) => `line ${i}`);
    const beforeFull = beforeLines.join("\n");
    const afterFull = beforeFull.replace("line 1700", "changed late");
    const html = render({
      toolName: "edit_file",
      target: "src/a.ts",
      status: "completed",
      changes: [
        {
          path: "src/a.ts",
          kind: "modified",
          patch: createDiffPatch(beforeFull, afterFull),
        },
      ],
    });
    expect(html).not.toContain("无行级差异");
    expect(html).toContain("changed late");
    expect(html).toContain('class="tool-diff-stat tool-diff-added">+1<');
    expect(html).toContain('class="tool-diff-stat tool-diff-removed">-1<');
  });

  it.each([
    [undefined, "缺少完整内容"],
    ["budget", "内容超出计算预算"],
  ] as const)(
    "explains why a patch is unavailable (%s)",
    (reason, expected) => {
      const html = renderToStaticMarkup(
        createElement(DiffViewer, {
          change: {
            path: "a.ts",
            kind: "modified",
            patch: {
              version: 1,
              status: "unavailable",
              ...(reason ? { reason } : {}),
              omittedLines: 0,
              omittedHunks: 0,
              hunks: [],
            },
          },
        }),
      );
      expect(html).toContain(expected);
      expect(html).not.toContain("无文本改动");
    },
  );

  it("does not label a fully omitted patch as unchanged", () => {
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        change: {
          path: "a.ts",
          kind: "created",
          patch: createDiffPatch("", "x".repeat(9000)),
        },
      }),
    );
    expect(html).toContain("差异内容已截断");
    expect(html).not.toContain("无文本改动");
  });

  it("renders an object tool result as parsed rows, not raw JSON", () => {
    const html = render({
      toolName: "edit_file",
      status: "completed",
      output: JSON.stringify({ edited: true, replacements: 2 }),
      defaultExpanded: true,
    });
    expect(html).toContain("替换");
    expect(html).toContain("true");
    expect(html).not.toContain('{"edited"');
  });

  it("previews only the first 10 diff lines and offers an expand control", () => {
    const after = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const html = render({
      toolName: "edit_file",
      status: "completed",
      changes: [
        {
          path: "src/a.ts",
          kind: "created",
          patch: createDiffPatch("", after),
        },
      ],
    });
    // Only the leading preview lines are rendered while collapsed.
    expect(html).toContain("line 0");
    expect(html).toContain("line 9");
    expect(html).not.toContain("line 10");
    expect(html).toContain("展开全部差异");
    expect(html).toContain("还有 20 行");
  });

  it("shows a small diff in full without an expand control", () => {
    const html = render({
      toolName: "edit_file",
      status: "completed",
      changes: [
        {
          path: "src/a.ts",
          kind: "modified",
          patch: createDiffPatch("const old = 1;", "const next = 2;"),
        },
      ],
    });
    expect(html).not.toContain("展开全部差异");
    expect(html).toContain("const next = 2;");
  });

  it("renders exactly one line-number column per diff row", () => {
    const html = render({
      toolName: "edit_file",
      status: "completed",
      changes: [
        {
          path: "src/a.ts",
          kind: "modified",
          patch: createDiffPatch(
            "keep\nconst old = 1;",
            "keep\nconst next = 2;",
          ),
        },
      ],
    });
    // One number cell per row; the previous double before/after gutter is gone.
    const rows = html.match(/class="diff-line diff-line-\w+"/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(html.match(/class="diff-line-number"/g)?.length).toBe(rows.length);
  });

  it("shows only the changed lines and ±5 context, not the whole file", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const before = lines.join("\n");
    // Insert one line in the middle; the patch keeps only the change + context.
    const after = [...lines.slice(0, 30), "inserted", ...lines.slice(30)].join(
      "\n",
    );
    // Render the diff directly with no leading-line preview so the assertion is
    // about context filtering, not the 10-line preview window.
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        change: {
          path: "src/a.ts",
          kind: "modified",
          patch: createDiffPatch(before, after),
        },
        isSuggested: false,
        previewLines: 0,
      }),
    );
    // The change and its 5 context lines on each side are present...
    expect(html).toContain("line 25");
    expect(html).toContain("inserted");
    expect(html).toContain("line 34");
    // ...but one line beyond the context and the far ends of the file are not.
    expect(html).not.toContain("line 35");
    expect(html).not.toContain("line 0<");
    expect(html).not.toContain("line 59");
  });

  it("collapses distant unchanged runs into a separator row", () => {
    // Two far-apart changes force two hunks, so the gap between them is elided.
    const before = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const after = before
      .replace("line 5", "changed early")
      .replace("line 70", "changed late");
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        change: {
          path: "src/a.ts",
          kind: "modified",
          patch: createDiffPatch(before, after),
        },
        isSuggested: false,
        previewLines: 0,
      }),
    );
    expect(html).toContain("changed early");
    expect(html).toContain("changed late");
    expect(html).toContain("已省略");
  });

  it("aligns command and standalone command sections consistently without orphaned buttons", () => {
    const html = render({
      toolName: "command_task",
      command: "npm test",
      cwd: "/repo",
      status: "completed",
      defaultExpanded: true,
      output: JSON.stringify({ stdout: "PASS", exit_code: 0 }),
    });
    expect(html).toContain('class="tool-terminal-header tool-section"');
    expect(html).toContain('class="tool-terminal-prompt"');
    expect(html).toContain('class="tool-terminal-header-meta"');
    expect(html).toContain("复制命令");
    expect(html).toContain("复制输出");
  });

  it("renders update_plan with structured progress steps instead of raw JSON", () => {
    const plan = {
      explanation: "优化对话区域及 plan 工具展示",
      steps: [
        { step: "步骤一：分析代码", status: "completed" },
        { step: "步骤二：实现结构化渲染", status: "in_progress" },
        { step: "步骤三：自动化测试", status: "pending" },
      ],
    };
    const html = render({
      toolName: "update_plan",
      status: "completed",
      defaultExpanded: true,
      parameters: plan,
      output: JSON.stringify(plan),
    });

    // 结构化组件已渲染
    expect(html).toContain('class="tool-plan-view"');
    expect(html).toContain("计划进度 1 / 3 项完成");
    expect(html).toContain("33%");
    expect(html).toContain("优化对话区域及 plan 工具展示");
    expect(html).toContain("步骤一：分析代码");
    expect(html).toContain("步骤二：实现结构化渲染");
    expect(html).toContain("步骤三：自动化测试");
    expect(html).toContain("已完成");
    expect(html).toContain("进行中");
    expect(html).toContain("待处理");

    // 杜绝原始 JSON pre 块
    expect(html).not.toContain("tool-param-json");
  });

  it("renders spawn_agent with structured model, ownership, writePaths, and readable task body", () => {
    const params = {
      model: "cbcn/deepseek-v4.1-flash",
      ownership: "Backend estimation",
      writePaths: ["src/shared/schemas.ts", "src/core/runtime.ts"],
      task: "请在后端实现实时行数估算\n1. 修改 schemas\n2. 增加扫描器",
    };
    const html = render({
      toolName: "spawn_agent",
      status: "completed",
      defaultExpanded: true,
      parameters: params,
      output: JSON.stringify({
        childSessionId: "1202b3b5-1fea-48b8-8c14-aa39b90071c3",
        model: "cbcn/deepseek-v4.1-flash",
      }),
    });

    expect(html).toContain("委派子任务");
    expect(html).toContain("Backend estimation");
    expect(html).toContain('class="agent-card-view"');
    expect(html).toContain("cbcn/deepseek-v4.1-flash");
    expect(html).toContain("src/shared/schemas.ts");
    expect(html).toContain("src/core/runtime.ts");
    expect(html).toContain("请在后端实现实时行数估算");
    expect(html).toContain("子会话 1202b3b5");
    // 杜绝重复未折叠参数
    expect(html).not.toContain('{"task":');
  });

  it("renders wait_agents with structured sub-agent report cards, status badges, and usage", () => {
    const reports = [
      {
        id: "1202b3b5-1fea-48b8-8c14-aa39b90071c3",
        status: "completed",
        model: "cbcn/deepseek-v4.1-flash",
        summary: "已完成并提交（commit 6b10a24）。全部测试通过。",
        usage: { promptTokens: 13087478, completionTokens: 80040 },
      },
    ];
    const html = render({
      toolName: "wait_agents",
      status: "completed",
      defaultExpanded: true,
      parameters: { ids: ["1202b3b5-1fea-48b8-8c14-aa39b90071c3"] },
      output: JSON.stringify(reports),
    });

    expect(html).toContain("等待子任务");
    expect(html).toContain('class="agent-reports-view"');
    expect(html).toContain("已完成");
    expect(html).toContain("cbcn/deepseek-v4.1-flash");
    expect(html).toContain("1202b3b5");
    expect(html).toContain("已完成并提交（commit 6b10a24）");
    expect(html).toContain("13.1M 入 / 80.0k 出");
  });

  it("renders read_file with clean content, compact metadata badges, and copies, dropping raw param rows", () => {
    const rawResult = {
      path: "src/sample.ts",
      content: "const msg = 'hello world';",
      version: "cded94407e9e8d4d66730259d0e10266b95b44a2ec239621fc4bc482d37a225",
      end_line: 171,
      size_bytes: 5653,
      lines_returned: 171,
      offset: 0,
      next_offset: null,
      total_lines: 171,
      truncated: false,
      partial_line: false,
      cache_hit: true,
    };
    const html = render({
      toolName: "read_file",
      status: "completed",
      defaultExpanded: true,
      parameters: { path: "src/sample.ts" },
      output: JSON.stringify(rawResult),
    });

    // 主视图结构清晰：文件内容、复制按钮与紧凑图标 badge
    expect(html).toContain("文件内容");
    expect(html).toContain('aria-label="复制内容"');
    expect(html).toContain("hello world");
    expect(html).toContain("共 171 行");
    expect(html).toContain("5.5 KB");
    expect(html).toContain("缓存命中");

    // 不再平铺展示冗长内部字段
    expect(html).not.toContain('<dt class="tool-param-key">返回行数</dt>');
    expect(html).not.toContain('<dt class="tool-param-key">末行不完整</dt>');
    expect(html).not.toContain('<dt class="tool-param-key">下一页偏移</dt>');
    expect(html).not.toContain("cded94407e9e8d4d66730259d0e10266b95b44a2ec239621fc4bc482d37a225");

    // 不再显示“调用参数”与“调试信息”
    expect(html).not.toContain("调用参数");
    expect(html).not.toContain("调试信息");
    expect(html).not.toContain("tool-disclosure-footer");
  });

  it("renders partial read_file with line range badge and truncation warning", () => {
    const rawResult = {
      path: "src/big.ts",
      content: "line 10\nline 11",
      size_bytes: 12000,
      lines_returned: 2,
      offset: 9,
      end_line: 11,
      total_lines: 50,
      truncated: true,
      cache_hit: false,
    };
    const html = render({
      toolName: "read_file",
      status: "completed",
      defaultExpanded: true,
      output: JSON.stringify(rawResult),
    });

    expect(html).toContain("第 10–11 行 / 共 50 行");
    expect(html).toContain("12 KB");
    expect(html).toContain("已截断");
  });

  it("renders read_file with unchanged message when cached unchanged is returned", () => {
    const rawResult = {
      path: "src/cached.ts",
      unchanged: true,
      size_bytes: 1024,
      lines_returned: 0,
      total_lines: 40,
      cache_hit: true,
    };
    const html = render({
      toolName: "read_file",
      status: "completed",
      defaultExpanded: true,
      output: JSON.stringify(rawResult),
    });

    expect(html).toContain("文件内容未变更（与当前缓存一致）");
    expect(html).toContain("共 40 行");
    expect(html).toContain("1.0 KB");
  });

  it("renders list_files result with structured file list and badges instead of raw JSON", () => {
    const rawResult = {
      entries: [
        { path: "tests/store/locking.test.ts", kind: "file" },
        { path: "tests/store/memory.test.ts", kind: "file" },
        { path: "tests/store/subfolder", kind: "directory" },
      ],
      offset: 0,
      next_offset: null,
      truncated: false,
      scan_truncated: false,
    };
    const html = render({
      toolName: "list_files",
      status: "completed",
      defaultExpanded: true,
      parameters: { path: "tests/store", glob: "*.test.ts" },
      output: JSON.stringify(rawResult),
    });

    expect(html).toContain("文件列表");
    expect(html).toContain("2 个文件 · 1 个目录");
    expect(html).toContain("*.test.ts");
    expect(html).toContain("tool-file-list");
    expect(html).toContain("locking.test.ts");
    expect(html).toContain("tests/store/");
    expect(html).toContain("subfolder");
    expect(html).toContain("目录");
    // Ensure raw JSON key-value dump is not shown
    expect(html).not.toContain("条目数");
    expect(html).not.toContain("已截断 false");
  });

  it("renders list_files warning badges when truncated or scan truncated", () => {
    const rawResult = {
      entries: [{ path: "src/a.ts", kind: "file" }],
      offset: 0,
      next_offset: 50,
      truncated: true,
      scan_truncated: true,
    };
    const html = render({
      toolName: "list_files",
      status: "completed",
      defaultExpanded: true,
      output: JSON.stringify(rawResult),
    });

    expect(html).toContain("已截断 (下一页: 50)");
    expect(html).toContain("扫描超出上限");
  });

  it("renders list_files empty state when no files found", () => {
    const rawResult = {
      entries: [],
      offset: 0,
      next_offset: null,
      truncated: false,
      scan_truncated: false,
    };
    const html = render({
      toolName: "list_files",
      status: "completed",
      defaultExpanded: true,
      output: JSON.stringify(rawResult),
    });

    expect(html).toContain("0 个项目");
    expect(html).toContain("无匹配文件");
  });
});

