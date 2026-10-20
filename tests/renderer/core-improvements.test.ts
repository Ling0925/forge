import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mcpRegisterDtoSchema } from "../../src/shared/ipc";
import { sessionIdSchema, type SessionSnapshot } from "../../src/shared/schemas";
import { reduceTimeline } from "../../src/renderer/state/timeline";
import { shouldRefreshTranscript } from "../../src/renderer/state/refresh-events";
import { ToolDisclosure } from "../../src/renderer/components/primitives/ToolDisclosure";
import { StoredTranscript } from "../../src/renderer/components/workbench/Transcript";

const id = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");

describe("MCP registration DTO schema", () => {
  it("accepts legacy stdio registration shape", () => {
    const stdio = {
      id: "local-srv",
      label: "Local Service",
      command: "node",
      args: ["./srv.js"],
      enabled: false,
    };
    const parsed = mcpRegisterDtoSchema.safeParse(stdio);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(stdio);
      expect("transport" in parsed.data).toBe(false);
    }
  });

  it("accepts remote HTTP registration with private headers", () => {
    const remote = {
      id: "remote-http",
      label: "Remote HTTP MCP",
      transport: "http" as const,
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer top-secret-token" },
      enabled: false,
    };
    const parsed = mcpRegisterDtoSchema.safeParse(remote);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(remote);
    }
  });

  it("accepts remote SSE registration without headers", () => {
    const remote = {
      id: "remote-sse",
      label: "Remote SSE MCP",
      transport: "sse" as const,
      url: "http://127.0.0.1:8080/events",
      enabled: false,
    };
    const parsed = mcpRegisterDtoSchema.safeParse(remote);
    expect(parsed.success).toBe(true);
  });

  it("rejects remote URLs with embedded credentials or invalid protocol", () => {
    expect(
      mcpRegisterDtoSchema.safeParse({
        id: "bad-url",
        label: "Bad",
        transport: "http",
        url: "https://user:pass@example.com/mcp",
      }).success,
    ).toBe(false);

    expect(
      mcpRegisterDtoSchema.safeParse({
        id: "bad-url",
        label: "Bad",
        transport: "http",
        url: "ftp://example.com/mcp",
      }).success,
    ).toBe(false);
  });
});

describe("tool_hook diagnostics in timeline and refresh events", () => {
  it("triggers transcript refresh for tool_hook events", () => {
    expect(shouldRefreshTranscript("tool_hook")).toBe(true);
  });

  it("surfaces denied and failed hook diagnostics, but skips ok and skipped events", () => {
    const snapshot: SessionSnapshot = {
      version: 1,
      id,
      title: "Hook test",
      workspace: "/tmp",
      model: "test-model",
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:05Z",
      status: "completed",
      changes: [],
      messages: [
        { role: "user", content: "Run hook" },
        {
          role: "assistant",
          content: "calling tool",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "run_command", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "ok" },
      ],
      events: [
        {
          type: "run_started",
          sessionId: id,
          timestamp: "2026-03-01T00:00:00Z",
          turn: 0,
          model: "test-model",
          permission: "workspace",
        },
        // ok hook — should be silent
        {
          type: "tool_hook",
          sessionId: id,
          timestamp: "2026-03-01T00:00:01Z",
          turn: 0,
          toolCallId: "call-1",
          diagnostic: {
            hook: "beforeTool",
            id: "lint-hook",
            status: "ok",
            durationMs: 12,
            stdoutBytes: 0,
            stderrBytes: 0,
            outputTruncated: false,
          },
        },
        // skipped hook — should be silent
        {
          type: "tool_hook",
          sessionId: id,
          timestamp: "2026-03-01T00:00:01Z",
          turn: 0,
          toolCallId: "call-1",
          diagnostic: {
            hook: "beforeTool",
            id: "skip-hook",
            status: "skipped",
            durationMs: 0,
            stdoutBytes: 0,
            stderrBytes: 0,
            outputTruncated: false,
          },
        },
        // denied hook — should be surfaced
        {
          type: "tool_hook",
          sessionId: id,
          timestamp: "2026-03-01T00:00:02Z",
          turn: 0,
          toolCallId: "call-1",
          diagnostic: {
            hook: "beforeTool",
            id: "security-gate",
            status: "denied",
            reason: "Path outside workspace denied",
            durationMs: 45,
            stdoutBytes: 10,
            stderrBytes: 20,
            outputTruncated: false,
          },
        },
        // failed hook (runEnd) — should be surfaced
        {
          type: "tool_hook",
          sessionId: id,
          timestamp: "2026-03-01T00:00:04Z",
          turn: 0,
          diagnostic: {
            hook: "runEnd",
            id: "cleanup-hook",
            status: "failed",
            reason: "Non-zero exit",
            exitCode: 1,
            durationMs: 100,
            stdoutBytes: 0,
            stderrBytes: 50,
            outputTruncated: false,
          },
        },
      ],
    };

    const timeline = reduceTimeline(snapshot);
    const diagnostics = timeline.filter((item) => item.kind === "hook_diagnostic");

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      kind: "hook_diagnostic",
      hook: "beforeTool",
      hookId: "security-gate",
      status: "denied",
      reason: "Path outside workspace denied",
      toolCallId: "call-1",
    });
    expect(diagnostics[1]).toMatchObject({
      kind: "hook_diagnostic",
      hook: "runEnd",
      hookId: "cleanup-hook",
      status: "failed",
      exitCode: 1,
      reason: "Non-zero exit",
    });
  });

  it("remains backward-compatible with sessions lacking tool_hook events", () => {
    const legacySnapshot: SessionSnapshot = {
      version: 1,
      id,
      title: "Legacy Session",
      workspace: "/tmp",
      model: "legacy-model",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:01Z",
      status: "completed",
      changes: [],
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
      events: [
        {
          type: "run_started",
          sessionId: id,
          timestamp: "2026-01-01T00:00:00Z",
          turn: 0,
          model: "legacy-model",
          permission: "workspace",
        },
        {
          type: "run_finished",
          sessionId: id,
          timestamp: "2026-01-01T00:00:01Z",
          turn: 0,
          status: "completed",
          turns: 1,
          toolCalls: 0,
        },
      ],
    };

    const timeline = reduceTimeline(legacySnapshot);
    expect(timeline.filter((item) => item.kind === "hook_diagnostic")).toHaveLength(0);
    expect(timeline.filter((item) => item.kind === "message")).toHaveLength(2);
  });

  it("renders compact hook diagnostic badge in the transcript", () => {
    const hookSnapshot: SessionSnapshot = {
      version: 1,
      id,
      title: "Hook Transcript Test",
      workspace: "/tmp",
      model: "test-model",
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:05Z",
      status: "completed",
      changes: [],
      messages: [
        { role: "user", content: "Do work" },
        {
          role: "assistant",
          content: "calling tool",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "run_command", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "ok" },
      ],
      events: [
        {
          type: "run_started",
          sessionId: id,
          timestamp: "2026-03-01T00:00:00Z",
          turn: 0,
          model: "test-model",
          permission: "workspace",
        },
        {
          type: "tool_hook",
          sessionId: id,
          timestamp: "2026-03-01T00:00:02Z",
          turn: 0,
          toolCallId: "call-1",
          diagnostic: {
            hook: "beforeTool",
            id: "security-gate",
            status: "denied",
            reason: "Forbidden path",
            durationMs: 15,
            stdoutBytes: 0,
            stderrBytes: 0,
            outputTruncated: false,
          },
        },
      ],
    };

    const html = renderToStaticMarkup(createElement(StoredTranscript, { snapshot: hookSnapshot }));
    expect(html).toContain('class="hook-diagnostic-badge"');
    expect(html).toContain('data-status="denied"');
    expect(html).toContain("Hook security-gate (beforeTool) 拒绝执行");
    expect(html).toContain("Forbidden path");
  });
});

describe("agent worktree and isolation presentation", () => {
  it("renders isolation and workspace chips in SpawnAgentView", () => {
    const html = renderToStaticMarkup(
      createElement(ToolDisclosure, {
        toolName: "spawn_agent",
        status: "completed",
        defaultExpanded: true,
        parameters: {
          task: "Sub task",
          isolation: "worktree",
        },
        output: JSON.stringify({
          childSessionId: "12345678-abcd-ef01-2345-6789abcdef01",
          workspace: "/home/user/project/.worktrees/agent-1",
          isolation: "worktree",
        }),
      }),
    );

    expect(html).toContain("agent-isolation-chip");
    expect(html).toContain("隔离：worktree");
    expect(html).toContain("agent-workspace-chip");
    expect(html).toContain("/home/user/project/.worktrees/agent-1");
  });

  it("renders worktree location in WaitAgentsView and get_agent_result", () => {
    const reportData = [
      {
        id: "child-session-id-1234",
        status: "completed",
        model: "deepseek-v4",
        summary: "Task finished in dedicated worktree",
        worktree: {
          repository: "/home/user/project",
          worktree: "/home/user/project/.worktrees/agent-isolated",
          baseRevision: "0123456789abcdef0123456789abcdef01234567",
        },
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ToolDisclosure, {
        toolName: "get_agent_result",
        status: "completed",
        defaultExpanded: true,
        parameters: { id: "child-session-id-1234" },
        output: JSON.stringify(reportData),
      }),
    );

    expect(html).toContain("agent-paths-title");
    expect(html).toContain("工作树：");
    expect(html).toContain("/home/user/project/.worktrees/agent-isolated");
    expect(html).toContain("仓库：/home/user/project");
  });
});
