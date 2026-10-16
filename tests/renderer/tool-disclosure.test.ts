import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ToolDisclosure,
  type ToolDisclosureProps,
} from "../../src/renderer/components/primitives/ToolDisclosure";

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

  it("keeps the collapsed view free of the expanded command body", () => {
    const html = render({
      toolName: "run_command",
      command: "rm -rf /",
      status: "running",
    });
    expect(html).not.toContain("rm -rf /");
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

  it("lists scalar array arguments as chips", () => {
    const html = render({
      toolName: "run_command",
      command: "node --version",
      parameters: JSON.stringify({ argv: ["node", "--version"] }),
      status: "completed",
      defaultExpanded: true,
    });
    expect(html).toContain('class="tool-param-chips"');
    expect(html).toContain("node");
    expect(html).toContain("--version");
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
});
