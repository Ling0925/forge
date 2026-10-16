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

  it("opens a command by default so its command and result read as one unit", () => {
    const html = render({
      toolName: "run_command",
      command: "rm -rf /",
      status: "running",
    });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("rm -rf /");
    expect(html).toContain("结果");
  });

  it("renders parsed parameter rows instead of a raw JSON blob", () => {
    const html = render({
      toolName: "read_file",
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
    });
    // The parsed "参数输入" rows are dropped from a command card.
    expect(html).not.toContain('class="tool-param-chips"');
    expect(html).not.toContain("参数输入");
    // The command and its raw result are both shown.
    expect(html).toContain("node --version");
    expect(html).toContain("v22.0.0");
  });

  it("falls back to plain text for malformed arguments", () => {
    const html = render({
      toolName: "read_file",
      parameters: "{not json",
      status: "completed",
      defaultExpanded: true,
    });
    expect(html).toContain("{not json");
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
        { path: "src/a.ts", kind: "modified", patch: createDiffPatch(before, after) },
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
  ] as const)("explains why a patch is unavailable (%s)", (reason, expected) => {
    const html = renderToStaticMarkup(createElement(DiffViewer, {
      change: {
        path: "a.ts", kind: "modified",
        patch: {
          version: 1, status: "unavailable", ...(reason ? { reason } : {}),
          omittedLines: 0, omittedHunks: 0, hunks: [],
        },
      },
    }));
    expect(html).toContain(expected);
    expect(html).not.toContain("无文本改动");
  });

  it("does not label a fully omitted patch as unchanged", () => {
    const html = renderToStaticMarkup(createElement(DiffViewer, {
      change: { path: "a.ts", kind: "created", patch: createDiffPatch("", "x".repeat(9000)) },
    }));
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
          patch: createDiffPatch("keep\nconst old = 1;", "keep\nconst next = 2;"),
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
        change: { path: "src/a.ts", kind: "modified", patch: createDiffPatch(before, after) },
        isSuggested: false,
        previewLines: 0,
      }),
    );
    expect(html).toContain("changed early");
    expect(html).toContain("changed late");
    expect(html).toContain("已省略");
  });
});
