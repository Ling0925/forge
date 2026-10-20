import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createWorkerController } from "../../src/desktop/controller";
import type { EventSink } from "../../src/shared/contracts";
import { defaultPublicSettings, sessionIdSchema, sessionSnapshotSchema, type AgentEvent } from "../../src/shared/schemas";
import { extendedService } from "../cli/service-fixture";

it("recovers the latest child drafts separately from parent text, then drops settled children", async () => {
  const snapshot = sessionSnapshotSchema.parse({ version: 1, id: randomUUID(), workspace: "/tmp", title: "Test", model: "test",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "running", messages: [], events: [], changes: [] });
  let emit!: EventSink;
  let finish!: () => void;
  const forwarded: AgentEvent[] = [];
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
    },
  }, message => { if (message.kind === "event") forwarded.push(message.data.event); });
  try {
    await controller.handle({ id: randomUUID(), method: "startRun", input: { sessionId: snapshot.id, prompt: "go" } });
    await new Promise<void>(resolve => setImmediate(resolve));
    const base = { sessionId: snapshot.id, timestamp: snapshot.updatedAt };
    const childSessionId = sessionIdSchema.parse(randomUUID());
    const draft = { ...base, type: "agent_progress" as const, childSessionId, text: "one", truncated: false, childTurn: 1, childStep: 1 };
    emit({ ...base, type: "text_delta", text: "parent text" });
    emit(draft);
    emit({ ...draft, text: "one two" });
    expect(forwarded.filter(event => event.type === "agent_progress")).toHaveLength(2);
    expect(controller.recoveryEvents().filter(event => event.event.type === "agent_progress").map(event => event.event)).toEqual([{ ...draft, text: "one two" }]);
    expect(controller.recoveryEvents().find(event => event.event.type === "text_delta")?.event).toMatchObject({ text: "parent text" });
    emit({ ...draft, text: "", childStep: 2 });
    expect(controller.recoveryEvents().find(event => event.event.type === "agent_progress")?.event).toMatchObject({ text: "", childStep: 2 });
    for (let index = 0; index < 40; index++) emit({ ...draft, childSessionId: sessionIdSchema.parse(randomUUID()) });
    expect(controller.recoveryEvents().filter(event => event.event.type === "agent_progress")).toHaveLength(32);
    emit({ ...base, type: "agent_update", childSessionId, model: "child", status: "completed", summary: "settled" });
    expect(controller.recoveryEvents().some(event => event.event.type === "agent_progress" && event.event.childSessionId === childSessionId)).toBe(false);
    // Child completion must not finish its owning parent controller.
    expect(controller.recoveryEvents().some(event => event.event.type === "text_delta")).toBe(true);
  } finally {
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    await controller.dispose();
  }
});
