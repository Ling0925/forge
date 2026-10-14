import type {
  ApprovalRequest,
  ErrorInfo,
  PublicSettings,
  RunEvent,
  RunHandle,
  RunId,
  SessionId,
  SessionSnapshot,
  SessionStatus,
  SessionSummary,
} from "../shared-types";
// Draft-only ceiling. Stored snapshots are never sliced by this reducer.
export const STREAMING_TEXT_LIMIT = 1000000;

export interface ActiveRunState {
  readonly runId?: RunId | undefined;
  readonly sessionId: SessionId;
  readonly status: SessionStatus;
  readonly streamingText: string;
  readonly streamingTruncated?: boolean;
  readonly streamingTurn?: number;
  readonly accepted?: boolean;
  readonly approvalQueue?: readonly ApprovalRequest[];
  readonly pendingApproval?: ApprovalRequest | undefined;
  readonly isSubmittingApproval?: boolean | undefined;
  readonly isCancelling?: boolean | undefined;
  readonly error?: ErrorInfo | undefined;
}
export interface WorkbenchState {
  readonly settings: PublicSettings | null;
  readonly isSettingsLoading: boolean;
  readonly settingsError: string | null;
  readonly sessions: readonly SessionSummary[];
  readonly isSessionsLoading: boolean;
  readonly activeSessionId: SessionId | null;
  readonly activeSnapshot: SessionSnapshot | null;
  readonly isSnapshotLoading: boolean;
  readonly activeRuns: Readonly<Record<string, ActiveRunState>>;
  readonly isSettingsOpen: boolean;
  readonly isNewSessionOpen: boolean;
  readonly mobileTab: "task" | "inspector";
  readonly isMobileSidebarOpen: boolean;
  readonly alertError: string | null;
}
export const initialWorkbenchState: WorkbenchState = {
  settings: null,
  isSettingsLoading: false,
  settingsError: null,
  sessions: [],
  isSessionsLoading: false,
  activeSessionId: null,
  activeSnapshot: null,
  isSnapshotLoading: false,
  activeRuns: {},
  isSettingsOpen: false,
  isNewSessionOpen: false,
  mobileTab: "task",
  isMobileSidebarOpen: false,
  alertError: null,
};
export type WorkbenchAction =
  | { readonly type: "SET_SETTINGS"; readonly settings: PublicSettings }
  | { readonly type: "SET_SETTINGS_LOADING"; readonly isLoading: boolean }
  | { readonly type: "SET_SETTINGS_ERROR"; readonly error: string | null }
  | {
      readonly type: "SET_SESSIONS";
      readonly sessions: readonly SessionSummary[];
    }
  | { readonly type: "SET_SESSIONS_LOADING"; readonly isLoading: boolean }
  | { readonly type: "SELECT_SESSION"; readonly sessionId: SessionId }
  | {
      readonly type: "SET_ACTIVE_SNAPSHOT";
      readonly snapshot: SessionSnapshot | null;
    }
  | { readonly type: "SET_SNAPSHOT_LOADING"; readonly isLoading: boolean }
  | { readonly type: "START_RUN_INITIATED"; readonly sessionId: SessionId }
  | { readonly type: "START_RUN_FAILED"; readonly sessionId: SessionId }
  | { readonly type: "START_RUN_RESOLVED"; readonly runHandle: RunHandle }
  | { readonly type: "RUN_EVENT_RECEIVED"; readonly event: RunEvent }
  | {
      readonly type: "SET_RUN_CANCELLING";
      readonly sessionId: SessionId;
      readonly isCancelling: boolean;
    }
  | {
      readonly type: "SET_APPROVAL_SUBMITTING";
      readonly sessionId: SessionId;
      readonly isSubmitting: boolean;
    }
  | {
      readonly type: "APPROVAL_ANSWERED";
      readonly sessionId: SessionId;
      readonly approvalId: string;
    }
  | { readonly type: "OPEN_SETTINGS"; readonly isOpen: boolean }
  | { readonly type: "OPEN_NEW_SESSION"; readonly isOpen: boolean }
  | { readonly type: "SET_MOBILE_TAB"; readonly tab: "task" | "inspector" }
  | { readonly type: "SET_MOBILE_SIDEBAR"; readonly isOpen: boolean }
  | { readonly type: "SET_ALERT_ERROR"; readonly error: string | null };
const active = (status: SessionStatus) =>
  status === "running" || status === "awaiting_approval";
function putRun(state: WorkbenchState, run: ActiveRunState): WorkbenchState {
  return {
    ...state,
    activeRuns: { ...state.activeRuns, [run.sessionId]: run },
  };
}
export function workbenchReducer(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case "SET_SETTINGS":
      return {
        ...state,
        settings: action.settings,
        isSettingsLoading: false,
        settingsError: null,
      };
    case "SET_SETTINGS_LOADING":
      return { ...state, isSettingsLoading: action.isLoading };
    case "SET_SETTINGS_ERROR":
      return {
        ...state,
        settingsError: action.error,
        isSettingsLoading: false,
      };
    case "SET_SESSIONS":
      return {
        ...state,
        sessions: action.sessions.map((s) => {
          const run = state.activeRuns[s.id];
          return {
            ...s,
            status: run && active(run.status) ? run.status : s.status,
          };
        }),
        isSessionsLoading: false,
      };
    case "SET_SESSIONS_LOADING":
      return { ...state, isSessionsLoading: action.isLoading };
    case "SELECT_SESSION":
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeSnapshot:
          state.activeSnapshot?.id === action.sessionId
            ? state.activeSnapshot
            : null,
        isSnapshotLoading: true,
        isMobileSidebarOpen: false,
      };
    case "SET_ACTIVE_SNAPSHOT": {
      const snap = action.snapshot;
      if (!snap)
        return { ...state, activeSnapshot: null, isSnapshotLoading: false };
      const fresherTranscript =
        state.activeSnapshot?.id === snap.id &&
        state.activeSnapshot.updatedAt > snap.updatedAt
          ? state.activeSnapshot
          : undefined;
      const run = state.activeRuns[snap.id];
      // Read completion is independent of transcript freshness. Terminal local
      // events may never reach disk (for example, a pre-acceptance busy failure).
      const selectedSnapshot = fresherTranscript
        ? {
            ...fresherTranscript,
            status:
              run && active(run.status) ? run.status : fresherTranscript.status,
          }
        : snap;
      // A disk read can race a newly started controller. Never terminate it from a stale snapshot.
      const runs = { ...state.activeRuns };
      if (run && !active(run.status)) delete runs[snap.id];
      const next = { ...state, activeRuns: runs };
      return {
        ...next,
        activeSnapshot:
          state.activeSessionId === snap.id
            ? selectedSnapshot
            : state.activeSnapshot,
        isSnapshotLoading:
          state.activeSessionId === snap.id ? false : state.isSnapshotLoading,
        sessions: state.sessions.map((s) =>
          s.id === snap.id
            ? {
                ...s,
                title: snap.title,
                model: snap.model,
                updatedAt: snap.updatedAt,
                status: run && active(run.status) ? run.status : snap.status,
              }
            : s,
        ),
      };
    }
    case "SET_SNAPSHOT_LOADING":
      return { ...state, isSnapshotLoading: action.isLoading };
    case "START_RUN_INITIATED":
      return putRun(state, {
        sessionId: action.sessionId,
        status: "running",
        streamingText: "",
      });
    case "START_RUN_FAILED": {
      const runs = { ...state.activeRuns };
      delete runs[action.sessionId];
      return { ...state, activeRuns: runs };
    }
    case "START_RUN_RESOLVED": {
      const { sessionId, runId } = action.runHandle;
      const previous = state.activeRuns[sessionId];
      return putRun(state, {
        sessionId,
        status: "running",
        streamingText: "",
        ...previous,
        runId,
      });
    }
    case "RUN_EVENT_RECEIVED": {
      const { runId, event } = action.event;
      const previous = state.activeRuns[event.sessionId];
      if (previous?.runId && previous.runId !== runId) return state;
      const run: ActiveRunState = {
        sessionId: event.sessionId,
        status: "running",
        streamingText: "",
        ...previous,
        runId,
      };
      let next = run;
      if (event.type === "run_started") next = { ...run, accepted: true };
      if (event.type === "text_delta")
        next = {
          ...run,
          streamingText:
            run.streamingText +
            event.text.slice(
              0,
              Math.max(0, STREAMING_TEXT_LIMIT - run.streamingText.length),
            ),
          streamingTruncated:
            !!run.streamingTruncated ||
            run.streamingText.length + event.text.length > STREAMING_TEXT_LIMIT,
        };
      if (event.type === "tool_started")
        next = {
          ...run,
          streamingText: "",
          streamingTruncated: false,
          streamingTurn: (run.streamingTurn ?? 0) + 1,
        };
      if (event.type === "approval_requested")
        next = {
          ...run,
          status: "awaiting_approval",
          pendingApproval: run.pendingApproval ?? event.request,
          approvalQueue: [
            ...(run.approvalQueue ??
              (run.pendingApproval ? [run.pendingApproval] : [])),
            event.request,
          ].filter(
            (request, index, queue) =>
              queue.findIndex((other) => other.id === request.id) === index,
          ),
        };
      if (event.type === "state_changed")
        next = {
          ...run,
          pendingApproval: run.pendingApproval,
          status: run.pendingApproval ? "awaiting_approval" : event.status,
        };
      if (event.type === "run_finished")
        next = {
          ...run,
          status: event.status,
          streamingText: "",
          streamingTruncated: false,
          pendingApproval: undefined,
          approvalQueue: [],
          isCancelling: false,
          isSubmittingApproval: false,
        };
      if (event.type === "error") next = { ...run, error: event.error };
      const result = putRun(state, next);
      if (event.type === "text_delta") return result; // transient text never copies the stored transcript
      const snapshot = state.activeSnapshot;
      return {
        ...result,
        sessions: state.sessions.map((s) =>
          s.id === event.sessionId
            ? { ...s, status: next.status, updatedAt: event.timestamp }
            : s,
        ),
        activeSnapshot:
          snapshot?.id === event.sessionId
            ? {
                ...snapshot,
                status: next.status,
                plan:
                  event.type === "plan_updated" ? event.plan : snapshot.plan,
                updatedAt: event.timestamp,
                events: [...snapshot.events, event],
              }
            : snapshot,
      };
    }
    case "SET_RUN_CANCELLING": {
      const run = state.activeRuns[action.sessionId];
      return run
        ? putRun(state, { ...run, isCancelling: action.isCancelling })
        : state;
    }
    case "SET_APPROVAL_SUBMITTING": {
      const run = state.activeRuns[action.sessionId];
      return run
        ? putRun(state, { ...run, isSubmittingApproval: action.isSubmitting })
        : state;
    }
    case "APPROVAL_ANSWERED": {
      const run = state.activeRuns[action.sessionId];
      return run?.pendingApproval?.id === action.approvalId
        ? putRun(state, {
            ...run,
            approvalQueue: (run.approvalQueue ?? []).filter(
              (request) => request.id !== action.approvalId,
            ),
            pendingApproval: (run.approvalQueue ?? []).find(
              (request) => request.id !== action.approvalId,
            ),
            isSubmittingApproval: false,
          })
        : state;
    }
    case "OPEN_SETTINGS":
      // Modal invariant: settings and new-task are mutually exclusive.
      return action.isOpen
        ? { ...state, isSettingsOpen: true, isNewSessionOpen: false }
        : { ...state, isSettingsOpen: false };
    case "OPEN_NEW_SESSION":
      return action.isOpen
        ? { ...state, isNewSessionOpen: true, isSettingsOpen: false }
        : { ...state, isNewSessionOpen: false };
    case "SET_MOBILE_TAB":
      return { ...state, mobileTab: action.tab };
    case "SET_MOBILE_SIDEBAR":
      return { ...state, isMobileSidebarOpen: action.isOpen };
    case "SET_ALERT_ERROR":
      return { ...state, alertError: action.error };
  }
}
