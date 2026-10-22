import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createWorkerController } from "../../src/desktop/controller";
import type { EventSink } from "../../src/shared/contracts";
import { defaultPublicSettings, sessionSnapshotSchema } from "../../src/shared/schemas";
import { extendedService } from "../cli/service-fixture";

it("forwards previews before completion and recovers only the latest active generation metadata", async () => {
  const snapshot = sessionSnapshotSchema.parse({ version: 1, id: randomUUID(), workspace: "/tmp", title: "Test", model: "test",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "running", messages: [], events: [], changes: [] });
  let emit!: EventSink;
  let finish!: () => void;
  const forwarded: string[] = [];
  const controller = createWorkerController({ ...extendedService(),
    getSettings: async () => defaultPublicSettings, updateSettings: async () => defaultPublicSettings,
    listModels: async () => [], listSessions: async () => [], createSession: async () => snapshot,
    getSession: async () => snapshot, cancelSession: async () => false, compactSession: async () => snapshot,
    forkSession: async () => snapshot, renameSession: async () => snapshot, archiveSession: async () => snapshot,
    getDiagnostics: async () => ({ transcriptChars: 0, projectedChars: 0, messageCount: 0, summaryFallback: false }),
    dispose: async () => {}, run: async (_input, onEvent) => {
    emit = onEvent;
    await new Promise<void>(resolve => { finish = resolve; });
    return snapshot;
  } }, message => { if (message.kind === "event") forwarded.push(message.data.event.type); });
  try {
    await controller.handle({ id: randomUUID(), method: "startRun", input: { sessionId: snapshot.id, prompt: "go" } });
    await new Promise<void>(resolve => setImmediate(resolve));
    const base = { sessionId: snapshot.id, timestamp: snapshot.updatedAt };
    emit({ ...base, type: "tool_call_preview", previewId: "1:0:0", name: "read_file", argumentsChars: 1 });
    emit({ ...base, type: "tool_call_preview", previewId: "1:0:0", name: "read_file", argumentsChars: 99 });
    expect(forwarded).toEqual(["tool_call_preview", "tool_call_preview"]);
    expect(controller.recoveryEvents().filter(e => e.event.type === "tool_call_preview").map(e => e.event)).toEqual([expect.objectContaining({ type: "tool_call_preview", argumentsChars: 99 })]);
    emit({ ...base, type: "tool_started", previewId: "1:0:0", call: { id: "call", type: "function", function: { name: "read_file", arguments: "{}" } } });
    expect(controller.recoveryEvents().some(e => e.event.type === "tool_call_preview")).toBe(false);
    emit({ ...base, type: "tool_call_preview", previewId: "2:0:0", name: "read_file", argumentsChars: 1 });
    emit({ ...base, type: "retry_reset" });
    expect(controller.recoveryEvents().some(e => e.event.type === "tool_call_preview")).toBe(false);
    emit({ ...base, type: "tool_call_preview", previewId: "2:1:0", name: "read_file", argumentsChars: 1 });
    emit({ ...base, type: "tool_preview_reset" });
    expect(controller.recoveryEvents().some(e => e.event.type === "tool_call_preview")).toBe(false);
    const first = randomUUID(); const second = randomUUID();
    emit({ ...base, type: "generation_started", generationId: first, messageIndex: 1, turn: 1, step: 1 });
    emit({ ...base, type: "reasoning_delta", generationId: first, text: "old" });
    emit({ ...base, type: "generation_finished", generationId: first, status: "completed" });
    emit({ ...base, type: "generation_started", generationId: second, messageIndex: 3, turn: 1, step: 2 });
    emit({ ...base, type: "reasoning_delta", generationId: second, text: "new" });
    emit({ ...base, type: "reasoning_delta", generationId: second, text: " thought" });
    emit({ ...base, type: "generation_finished", generationId: second, status: "failed" });
    const recovered = controller.recoveryEvents().map(value => value.event).filter(event => event.generationId);
    expect(recovered.map(event => event.type)).toEqual(["generation_started", "reasoning_delta", "generation_finished"]);
    expect(recovered.every(event => event.generationId === second)).toBe(true);
    expect(recovered[1]).toMatchObject({ text: "new thought" });
  } finally {
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    await controller.dispose();
  }
});
