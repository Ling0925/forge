import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createWorkerController } from "../../src/desktop/controller";
import { runEventSchema, type WorkerMessage } from "../../src/shared/ipc";
import { defaultPublicSettings, parseSessionId, type SessionSnapshot } from "../../src/shared/schemas";
import { extendedService } from "../cli/service-fixture";

for (const action of ["approve", "permission"] as const) {
  it(`broadcasts ${action} settlements once to both clients`, async () => {
    const sessionId = parseSessionId(randomUUID());
    const timestamp = new Date().toISOString();
    const snapshot: SessionSnapshot = { version: 1, id: sessionId, title: "fixture", workspace: "/tmp", model: "fixture", createdAt: timestamp, updatedAt: timestamp, status: "running", messages: [], events: [], changes: [] };
    const approval = { id: randomUUID(), sessionId, toolCallId: "fixture-tool", toolName: "run_command", description: "fixture" };
    const desktop: WorkerMessage[] = [];
    const phone: WorkerMessage[] = [];
    let release = () => {};
    const held = new Promise<void>(done => { release = done; });
    let answer: boolean | undefined;
    const controller = createWorkerController({
      ...extendedService(),
      getSettings: async () => defaultPublicSettings,
      updateSettings: async () => defaultPublicSettings,
      listModels: async () => [],
      listSessions: async () => [],
      createSession: async () => snapshot,
      compactSession: async () => snapshot,
      forkSession: async () => snapshot,
      renameSession: async () => snapshot,
      archiveSession: async () => snapshot,
      cancelSession: async () => false,
      getDiagnostics: async () => ({ transcriptChars: 0, projectedChars: 0, messageCount: 0, summaryFallback: false }),
      getSession: async () => snapshot,
      dispose: async () => {},
      run: async (_input, onEvent, approve, signal) => {
        onEvent({ type: "run_started", sessionId, timestamp, model: "fixture", permission: "workspace" });
        onEvent({ type: "text_delta", sessionId, timestamp, text: "x".repeat(131072) });
        onEvent({ type: "text_delta", sessionId, timestamp, text: "overflow" });
        onEvent({ type: "approval_requested", sessionId, timestamp, request: approval });
        answer = await approve(approval, signal);
        await held;
        return snapshot;
      },
    }, message => { desktop.push(message); phone.push(message); });
    try {
      await controller.handle({ id: randomUUID(), method: "startRun", input: { sessionId, prompt: "fixture" } });
      await new Promise(done => setImmediate(done));
      const handle = phone.find(message => message.kind === "response" && message.response.ok && message.response.method === "startRun");
      if (!handle || handle.kind !== "response" || !handle.response.ok || handle.response.method !== "startRun") throw new Error("Missing run");
      const runId = handle.response.result.runId;
      const recovery = controller.recoveryEvents();
      for (const event of recovery) expect(runEventSchema.safeParse(event).success).toBe(true);
      expect(recovery.flatMap(item => item.event.type === "text_delta" ? [item.event.text] : []).join("")).toHaveLength(131073);
      await controller.handle(action === "approve"
        ? { id: randomUUID(), method: "answerApproval", runId, approvalId: approval.id, approved: true }
        : { id: randomUUID(), method: "setRunPermission", runId, permission: "unrestricted" });
      await new Promise(done => setImmediate(done));
      expect(answer).toBe(true);
      for (const messages of [desktop, phone]) {
        const events = messages.filter(message => message.kind === "event" && message.data.event.type === "approval_resolved");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ data: { runId, event: { approvalId: approval.id, approved: true } } });
      }
      expect(controller.recoveryEvents().some(item => item.event.type === "approval_requested")).toBe(false);
      const id = randomUUID();
      await controller.handle({ id, method: "answerApproval", runId, approvalId: approval.id, approved: true });
      expect(phone.find(message => message.kind === "response" && message.response.id === id)).toMatchObject({ response: { ok: false } });
      expect(phone.filter(message => message.kind === "event" && message.data.event.type === "approval_resolved")).toHaveLength(1);
    } finally {
      release();
      await controller.dispose();
    }
  });
}
