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
});
