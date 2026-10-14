import { runIdSchema } from "../../src/shared/ipc";
import { sessionIdSchema } from "../../src/shared/schemas";
const sessionA = sessionIdSchema.parse("11111111-1111-4111-8111-111111111111");
const sessionB = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const runA = runIdSchema.parse("33333333-3333-4333-8333-333333333333");
import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../../src/renderer/shared-types";
import {
  initialWorkbenchState,
  workbenchReducer,
} from "../../src/renderer/state/workbench-reducer";
const snapshot: SessionSnapshot = {
  version: 1,
  id: sessionA,
  title: "Task",
  workspace: "/tmp/task",
  model: "model",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  status: "running",
  messages: [],
  events: [],
  changes: [],
};
describe("workbench authority", () => {
  it("reconciles terminal desktop controllers with a newer CLI run", () => {
    const state = {
      ...initialWorkbenchState,
      activeSessionId: snapshot.id,
      activeRuns: {
        [snapshot.id]: {
          sessionId: snapshot.id,
          status: "completed" as const,
          streamingText: "",
        },
      },
    };
    const listed = workbenchReducer(state, {
      type: "SET_SESSIONS",
      sessions: [snapshot],
    });
    expect(listed.sessions[0]?.status).toBe("running");
    const reconciled = workbenchReducer(listed, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot,
    });
    expect(reconciled.activeRuns[snapshot.id]).toBeUndefined();
    expect(reconciled.activeSnapshot?.status).toBe("running");
  });
  it("keeps a live local controller authoritative over stale disk status", () => {
    const started = workbenchReducer(initialWorkbenchState, {
      type: "START_RUN_INITIATED",
      sessionId: snapshot.id,
    });
    const listed = workbenchReducer(started, {
      type: "SET_SESSIONS",
      sessions: [{ ...snapshot, status: "completed" }],
    });
    expect(listed.sessions[0]?.status).toBe("running");
    expect(
      workbenchReducer(listed, {
        type: "SET_ACTIVE_SNAPSHOT",
        snapshot: { ...snapshot, status: "completed" },
      }).activeRuns[snapshot.id]?.status,
    ).toBe("running");
  });
  it("does not treat a transport handle as prompt acceptance", () => {
    const started = workbenchReducer(initialWorkbenchState, {
      type: "START_RUN_INITIATED",
      sessionId: snapshot.id,
    });
    const handled = workbenchReducer(started, {
      type: "START_RUN_RESOLVED",
      runHandle: { sessionId: snapshot.id, runId: runA },
    });
    expect(handled.activeRuns[snapshot.id]?.accepted).toBeUndefined();
    const accepted = workbenchReducer(handled, {
      type: "RUN_EVENT_RECEIVED",
      event: {
        runId: runA,
        event: {
          type: "run_started",
          sessionId: snapshot.id,
          timestamp: snapshot.updatedAt,
          model: "model",
          permission: "readonly",
        },
      },
    });
    expect(accepted.activeRuns[snapshot.id]?.accepted).toBe(true);
  });
  it("settles a successful older-disk read after reselect without discarding fresher transcript", () => {
    // Idle disk at t1; run handle; failed run_finished at t2 before persistence.
    const seeded = workbenchReducer(
      workbenchReducer(initialWorkbenchState, {
        type: "SELECT_SESSION",
        sessionId: snapshot.id,
      }),
      {
        type: "SET_ACTIVE_SNAPSHOT",
        snapshot: { ...snapshot, status: "idle" },
      },
    );
    expect(seeded.activeSnapshot?.updatedAt).toBe("2026-01-01T00:00:01.000Z");
    const started = workbenchReducer(seeded, {
      type: "START_RUN_INITIATED",
      sessionId: snapshot.id,
    });
    const failed = workbenchReducer(started, {
      type: "RUN_EVENT_RECEIVED",
      event: {
        runId: runA,
        event: {
          type: "run_finished",
          sessionId: snapshot.id,
          timestamp: "2026-01-01T00:00:02.000Z",
          status: "failed",
          turns: 0,
          toolCalls: 0,
        },
      },
    });
    expect(failed.activeSnapshot?.updatedAt).toBe("2026-01-01T00:00:02.000Z");
    expect(failed.activeSnapshot?.status).toBe("failed");
    // Reselect same session, then deliver the unchanged older idle disk snapshot.
    const reselected = workbenchReducer(failed, {
      type: "SELECT_SESSION",
      sessionId: snapshot.id,
    });
    expect(reselected.isSnapshotLoading).toBe(true);
    const settled = workbenchReducer(reselected, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot: { ...snapshot, status: "idle" },
    });
    expect(settled.isSnapshotLoading).toBe(false);
    expect(settled.activeRuns[snapshot.id]).toBeUndefined();
    // The fresher transient transcript is protected, not replaced by older disk.
    expect(settled.activeSnapshot?.updatedAt).toBe("2026-01-01T00:00:02.000Z");
    expect(settled.activeSnapshot?.status).toBe("failed");
  });
  it("ignores another session's late snapshot and settles loading on failure", () => {
    const selected = workbenchReducer(initialWorkbenchState, {
      type: "SELECT_SESSION",
      sessionId: sessionB,
    });
    const late = workbenchReducer(selected, {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot,
    });
    expect(late.activeSnapshot).toBeNull();
    expect(late.isSnapshotLoading).toBe(true);
    expect(
      workbenchReducer(late, { type: "SET_SNAPSHOT_LOADING", isLoading: false })
        .isSnapshotLoading,
    ).toBe(false);
  });
});

it("queues concurrent child approvals without overwriting and advances by UUID", () => {
  const approval = (id: string) => ({
    id,
    sessionId: sessionA,
    childSessionId: sessionB,
    toolCallId: id,
    toolName: "run_command",
    description: "child command",
    permission: "workspace" as const,
  });
  const first = approval("44444444-4444-4444-8444-444444444444");
  const second = approval("55555555-5555-4555-8555-555555555555");
  let state = initialWorkbenchState;
  for (const request of [first, second])
    state = workbenchReducer(state, {
      type: "RUN_EVENT_RECEIVED",
      event: {
        runId: runA,
        event: {
          type: "approval_requested",
          sessionId: sessionA,
          timestamp: snapshot.updatedAt,
          request,
        },
      },
    });
  expect(state.activeRuns[sessionA]?.pendingApproval?.id).toBe(first.id);
  expect(state.activeRuns[sessionA]?.approvalQueue).toHaveLength(2);
  state = workbenchReducer(state, {
    type: "APPROVAL_ANSWERED",
    sessionId: sessionA,
    approvalId: first.id,
  });
  expect(state.activeRuns[sessionA]?.pendingApproval?.id).toBe(second.id);
  expect(state.activeRuns[sessionA]?.approvalQueue).toHaveLength(1);
});

it("applies live plans without waiting for a tool finish and keeps child selection separate", () => {
  const parent = {
    ...initialWorkbenchState,
    activeSessionId: sessionA,
    activeSnapshot: snapshot,
  };
  const plan = {
    explanation: "Investigate",
    steps: [{ step: "Read", status: "in_progress" as const }],
  };
  const updated = workbenchReducer(parent, {
    type: "RUN_EVENT_RECEIVED",
    event: {
      runId: runA,
      event: {
        type: "plan_updated",
        sessionId: sessionA,
        timestamp: snapshot.updatedAt,
        plan,
      },
    },
  });
  expect(updated.activeSnapshot?.plan).toEqual(plan);
  const child = workbenchReducer(
    workbenchReducer(updated, { type: "SELECT_SESSION", sessionId: sessionB }),
    {
      type: "SET_ACTIVE_SNAPSHOT",
      snapshot: {
        ...snapshot,
        id: sessionB,
        parentSessionId: sessionA,
        status: "completed",
        messages: [{ role: "assistant", content: "child result" }],
      },
    },
  );
  expect(child.activeSnapshot?.messages[0]?.content).toBe("child result");
  expect(child.activeSnapshot?.status).toBe("completed");
  expect(child.activeRuns[sessionA]?.status).toBe("running");
});
describe("modal exclusivity invariant", () => {
  it("never leaves settings and new-task open at the same time", () => {
    const settingsOpen = workbenchReducer(initialWorkbenchState, {
      type: "OPEN_SETTINGS",
      isOpen: true,
    });
    expect(settingsOpen.isSettingsOpen).toBe(true);
    const stacked = workbenchReducer(settingsOpen, {
      type: "OPEN_NEW_SESSION",
      isOpen: true,
    });
    expect(stacked.isNewSessionOpen).toBe(true);
    expect(stacked.isSettingsOpen).toBe(false);
    const andSettings = workbenchReducer(stacked, {
      type: "OPEN_SETTINGS",
      isOpen: true,
    });
    expect(andSettings.isSettingsOpen).toBe(true);
    expect(andSettings.isNewSessionOpen).toBe(false);
    const closed = workbenchReducer(andSettings, {
      type: "OPEN_SETTINGS",
      isOpen: false,
    });
    expect(closed.isSettingsOpen).toBe(false);
    expect(closed.isNewSessionOpen).toBe(false);
  });
  it("closing one modal never closes the other on its own", () => {
    const newOpen = workbenchReducer(initialWorkbenchState, {
      type: "OPEN_NEW_SESSION",
      isOpen: true,
    });
    const untouched = workbenchReducer(newOpen, {
      type: "OPEN_SETTINGS",
      isOpen: false,
    });
    expect(untouched.isNewSessionOpen).toBe(true);
    expect(untouched.isSettingsOpen).toBe(false);
  });
});
