import { describe, expect, it } from "vitest";
import {
  checkpointDtoSchema,
  externalUrlSchema,
  mcpRegisterDtoSchema,
  projectContextDtoSchema,
  rpcRequestSchema,
  rpcResponseSchema,
  workerRequestSchema,
} from "../../src/shared/ipc";

const id = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
describe("extended public IPC contract", () => {
  it("accepts only bounded public MCP registration, rejects forwarded environment", () => {
    const input = {
      id: "example",
      label: "Example",
      command: "node",
      args: ["server.js"],
    };
    expect(mcpRegisterDtoSchema.safeParse(input).success).toBe(true);
    expect(
      rpcRequestSchema.safeParse({
        id,
        method: "registerMcpServer",
        input: { ...input, env: { KEY: "private" } },
      }).success,
    ).toBe(false);
  });
  it("rejects private instruction bodies and checkpoint file payloads", () => {
    const catalog = {
      workspace: "/tmp/project",
      instructionSources: [
        { path: "AGENTS.md", order: 0, bytes: 8, body: "private" },
      ],
      skills: [],
      warnings: [],
      counts: { instructions: 1, skills: 0, warnings: 0 },
    };
    expect(projectContextDtoSchema.safeParse(catalog).success).toBe(false);
    expect(
      checkpointDtoSchema.safeParse({
        id,
        sessionId,
        toolCallId: "call",
        path: "a",
        kind: "modified",
        state: "completed",
        beforeHash: null,
        beforeMode: null,
        afterHash: "a".repeat(64),
        createdAt: new Date().toISOString(),
        before: "secret",
      }).success,
    ).toBe(false);
  });
  it("bounds checkpoint routes to UUIDs and validates responses", () => {
    expect(
      rpcRequestSchema.safeParse({
        id,
        method: "restoreCheckpoint",
        sessionId,
        checkpointId: id,
      }).success,
    ).toBe(true);
    expect(
      rpcRequestSchema.safeParse({
        id,
        method: "restoreCheckpoint",
        sessionId,
        checkpointId: "../../x",
      }).success,
    ).toBe(false);
    expect(
      rpcResponseSchema.safeParse({
        id,
        method: "getCheckpointDiff",
        ok: true,
        result: "x".repeat(262145),
      }).success,
    ).toBe(false);
  });
  it("accepts only session ID for native export and cancellation, never renderer paths", () => {
    for (const method of ["exportSession", "cancelSession"]) {
      expect(
        rpcRequestSchema.safeParse({ id, method, sessionId }).success,
      ).toBe(true);
      expect(
        rpcRequestSchema.safeParse({
          id,
          method,
          sessionId,
          path: "/tmp/out.json",
        }).success,
      ).toBe(false);
      expect(
        rpcRequestSchema.safeParse({ id, method, sessionId: "../other" })
          .success,
      ).toBe(false);
      expect(
        rpcResponseSchema.safeParse({ id, method, ok: true, result: false })
          .success,
      ).toBe(true);
    }
    expect(
      workerRequestSchema.safeParse({ id, method: "exportSession", sessionId })
        .success,
    ).toBe(false);
    expect(
      workerRequestSchema.safeParse({ id, method: "cancelSession", sessionId })
        .success,
    ).toBe(true);
  });
  it("permits only safe external URLs and excludes external requests from worker", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:password@example.com",
      "https://example.com/\n",
    ])
      expect(externalUrlSchema.safeParse(url).success).toBe(false);
    expect(
      externalUrlSchema.safeParse("https://example.com/docs#intro").success,
    ).toBe(true);
    expect(
      externalUrlSchema.safeParse("https://example.com/credentials/guide")
        .success,
    ).toBe(true);
    expect(
      workerRequestSchema.safeParse({
        id,
        method: "openExternal",
        url: "https://example.com",
      }).success,
    ).toBe(false);
  });
});
