import type {
  ApprovalRequest,
  ErrorInfo,
  Permission,
  PublicSettings,
  RunEvent,
  RunHandle,
  RunId,
  SessionId,
  SessionSnapshot,
  SessionStatus,
  SessionSummary,
} from "../shared-types";
import { appendSessionEvent } from "./session-usage";
import { estimateTokens } from "../../shared/context-usage";
import { recordPlan } from "../../shared/plans";
import {
  type PendingOutput,
  mergeTranscript,
  outputSaved,
  reasoningSaved,
} from "./transcript-sync";
// Draft-only ceiling. Stored snapshots are never sliced by this reducer.
export const STREAMING_TEXT_LIMIT = 1000000;
export const STREAMING_REASONING_LIMIT = 131072;
/** Display-only generation metadata; bounded so a hostile stream cannot grow state. */
export const TOOL_PREVIEW_LIMIT = 256;
export interface ToolPreviewEntry {
  readonly previewId: string;
  readonly name: string;
  readonly argumentsChars: number;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
}

export interface ActiveRunState {
  /** Output not yet replaced by a provider context_usage report; survives tool turns. */
  readonly unreportedOutputTokens?: number;
  /**
   * Ephemeral tool-argument generation metadata, keyed by `previewId`. Entries
   * are never tool calls, never executable and never written to
   * `activeSnapshot.events` (high-frequency display state only).
   */
  readonly toolPreviews?: readonly ToolPreviewEntry[];
  readonly webSearch?: import("../../shared/web-search").WebSearchProgress | undefined;
  readonly providerRetry?: number | undefined;
  readonly streamingReasoning?: string;
  readonly reasoningTruncated?: boolean;
  readonly reasoningStartMessage?: number;
  readonly pendingReasoning?: readonly PendingOutput[];
  readonly pendingOutputs?: readonly PendingOutput[];
  readonly streamStartMessage?: number;
  readonly permission?: Permission;
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
  readonly snapshotCache: Readonly<Record<string, { readonly snapshot: SessionSnapshot; readonly persistedAt: string | null }>>;
  readonly snapshotPersistedAt: string | null;
  readonly isSnapshotLoading: boolean;
  readonly activeRuns: Readonly<Record<string, ActiveRunState>>;
  readonly isSettingsOpen: boolean;
  readonly isUsageDashboardOpen: boolean;
  readonly isNewSessionOpen: boolean;
  readonly mobileTab: "task" | "inspector";
  readonly isMobileSidebarOpen: boolean;
  readonly alertError: string | null;
}
function retainOutput(
  run: ActiveRunState,
  snapshot: SessionSnapshot | null,
  toolCallId?: string,
) {
  const pending = run.pendingOutputs ?? [];
  if (!run.streamingText) return pending;
  const output: PendingOutput = {
    id: `${run.runId ?? "pending"}:${run.streamingTurn ?? 0}`,
    text: run.streamingText,
    truncated: Boolean(run.streamingTruncated),
    afterMessage: run.streamStartMessage ?? 0,
    toolCallId,
  };
  return outputSaved(output, snapshot?.id === run.sessionId ? snapshot : null)
    ? pending
    : [...pending, output];
}
function retainReasoning(
  run: ActiveRunState,
  snapshot: SessionSnapshot | null,
  toolCallId?: string,
): readonly PendingOutput[] {
  const pending = run.pendingReasoning ?? [];
  if (!run.streamingReasoning) return pending;
  const output: PendingOutput = {
    id: `${run.runId ?? "pending"}:${run.streamingTurn ?? 0}:reasoning`,
    text: run.streamingReasoning,
    truncated: Boolean(run.reasoningTruncated),
    afterMessage: run.reasoningStartMessage ?? 0,
    toolCallId,
  };
  return reasoningSaved(output, snapshot?.id === run.sessionId ? snapshot : null)
    ? pending
    : [...pending, output];
}

/** Same-id preview updates replace in place; a new id appends within the bound. */
function upsertPreview(
  previews: readonly ToolPreviewEntry[] | undefined,
  entry: ToolPreviewEntry,
): readonly ToolPreviewEntry[] {
  const list = previews ?? [];
  const existing = list.findIndex((p) => p.previewId === entry.previewId);
  if (existing >= 0) {
    const next = [...list];
    next[existing] = entry;
    return next;
  }
  const bounded =
    list.length >= TOOL_PREVIEW_LIMIT
      ? list.slice(list.length - TOOL_PREVIEW_LIMIT + 1)
      : list;
  return [...bounded, entry];
}

export const initialWorkbenchState: WorkbenchState = {
  settings: null,
  isSettingsLoading: false,
  settingsError: null,
  sessions: [],
  isSessionsLoading: false,
  activeSessionId: null,
  activeSnapshot: null,
  snapshotCache: {},
  snapshotPersistedAt: null,
  isSnapshotLoading: false,
  activeRuns: {},
  isSettingsOpen: false,
  isUsageDashboardOpen: false,
  isNewSessionOpen: true,
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
  | { readonly type: "OPEN_USAGE_DASHBOARD"; readonly isOpen: boolean }
  | { readonly type: "OPEN_NEW_SESSION"; readonly isOpen: boolean }
  | { readonly type: "SET_MOBILE_TAB"; readonly tab: "task" | "inspector" }
  | { readonly type: "SET_MOBILE_SIDEBAR"; readonly isOpen: boolean }
  | { readonly type: "SET_ALERT_ERROR"; readonly error: string | null };
const active = (status: SessionStatus) =>
  status === "running" || status === "awaiting_approval";
/** No further events can arrive for a run that already reached a terminal status. */
const terminal = (status: SessionStatus) =>
  status === "completed" ||
  status === "cancelled" ||
  status === "failed" ||
  status === "interrupted";
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
    case "SELECT_SESSION": {
      const cache = { ...state.snapshotCache };
      if (state.activeSnapshot) {
        delete cache[state.activeSnapshot.id];
        cache[state.activeSnapshot.id] = { snapshot: state.activeSnapshot, persistedAt: state.snapshotPersistedAt };
      }
      const selected = cache[action.sessionId];
      for (const id of Object.keys(cache).slice(0, -8)) delete cache[id];
      return {
        ...state,
        snapshotCache: cache,
        activeSessionId: action.sessionId,
        snapshotPersistedAt: selected?.persistedAt ?? null,
        activeSnapshot: selected?.snapshot ?? null,
        isSnapshotLoading: !selected,
        isNewSessionOpen: false,
        mobileTab: "task",
        isMobileSidebarOpen: false,
      };
    }
    case "SET_ACTIVE_SNAPSHOT": {
      const snap = action.snapshot;
      if (!snap)
        return {
          ...state,
          activeSnapshot: null,
          snapshotPersistedAt: null,
          isSnapshotLoading: false,
        };
      const run = state.activeRuns[snap.id];
      // Read completion is independent of transcript freshness. Terminal local
      // events may never reach disk (for example, a pre-acceptance busy failure).
      const merged = mergeTranscript(
        state.activeSnapshot?.id === snap.id ? state.activeSnapshot : state.snapshotCache?.[snap.id]?.snapshot ?? null,
        snap,
        state.activeSnapshot?.id === snap.id ? state.snapshotPersistedAt : state.snapshotCache?.[snap.id]?.persistedAt ?? null,
      );
      const selectedSnapshot =
        run && active(run.status) ? { ...merged, status: run.status } : merged;
      // A disk read can race a newly started controller. Never terminate it from a stale snapshot.
      const runs = { ...state.activeRuns };
      if (run) {
        const pendingOutputs =
          run.pendingOutputs?.filter(
            (output) => !outputSaved(output, selectedSnapshot),
          ) ?? [];
        const pendingReasoning = (run.pendingReasoning ?? []).filter(
          (output) => !reasoningSaved(output, selectedSnapshot),
        );
        // A snapshot that already contains this turn's streamed text or reasoning
        // is the authority for it. Keeping `streamingText` or `streamingReasoning`
        // would render duplicate blocks — once as the saved message and once as the
        // live draft — until the run's terminal event clears the buffer. Only drop
        // them when the saved content actually covers what is on screen (prefix match).
        const liveSaved =
          run.streamingText.length > 0 &&
          outputSaved(
            {
              id: "live",
              text: run.streamingText,
              truncated: Boolean(run.streamingTruncated),
              afterMessage: run.streamStartMessage ?? 0,
            },
            selectedSnapshot,
          );
        const reasoningSavedLive =
          Boolean(run.streamingReasoning) &&
          reasoningSaved(
            {
              id: "live-reasoning",
              text: run.streamingReasoning,
              truncated: Boolean(run.reasoningTruncated),
              afterMessage:
                run.reasoningStartMessage ?? run.streamStartMessage ?? 0,
            },
            selectedSnapshot,
          );
        if (
          !active(run.status) &&
          !pendingOutputs.length &&
          !pendingReasoning.length &&
          (!run.streamingText || liveSaved) &&
          (!run.streamingReasoning || reasoningSavedLive)
        )
          delete runs[snap.id];
        else
          runs[snap.id] = {
            ...run,
            pendingOutputs,
            pendingReasoning,
            ...(liveSaved
              ? { streamingText: "", streamingTruncated: false }
              : {}),
            ...(reasoningSavedLive
              ? { streamingReasoning: "", reasoningTruncated: false }
              : {}),
          };
      }
      const cache = { ...state.snapshotCache };
      const persistedAt = cache[snap.id]?.persistedAt;
      delete cache[snap.id];
      cache[snap.id] = { snapshot: selectedSnapshot, persistedAt: persistedAt && persistedAt > snap.updatedAt ? persistedAt : snap.updatedAt };
      for (const id of Object.keys(cache).slice(0, -8)) delete cache[id];
      const next = { ...state, activeRuns: runs, snapshotCache: cache };
      return {
        ...next,
        snapshotPersistedAt:
          state.activeSessionId === snap.id
            ? state.snapshotPersistedAt &&
              state.snapshotPersistedAt > snap.updatedAt
              ? state.snapshotPersistedAt
              : snap.updatedAt
            : state.snapshotPersistedAt,
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
        pendingOutputs:
          state.activeRuns[action.sessionId]?.pendingOutputs ?? [],
        pendingReasoning:
          state.activeRuns[action.sessionId]?.pendingReasoning ?? [],
      });
    case "START_RUN_FAILED": {
      const runs = { ...state.activeRuns };
      const run = runs[action.sessionId];
      if (run?.pendingOutputs?.length || run?.pendingReasoning?.length)
        runs[action.sessionId] = { ...run, status: "failed" };
      else delete runs[action.sessionId];
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
      const trackedRunId = previous?.runId;
      const trackedStatus = previous?.status;
      // A different runId than the one this surface already tracks is normally a
      // stale event from an older controller. The one exception is a fresh
      // `run_started` arriving after the tracked run reached a terminal status:
      // another client may have started the next turn, and ignoring it would
      // wedge this surface on the old finished run forever. Everything else — a
      // late delta, a late approval, a late terminal event, or any event for a
      // run this surface still considers live — stays rejected.
      const supersedesTerminalRun =
        trackedRunId !== undefined &&
        trackedRunId !== runId &&
        event.type === "run_started" &&
        trackedStatus !== undefined &&
        terminal(trackedStatus);
      if (
        trackedRunId !== undefined &&
        trackedRunId !== runId &&
        !supersedesTerminalRun
      )
        return state;
      const run: ActiveRunState = supersedesTerminalRun
        ? {
            // Clean slate for the new turn: nothing is inherited from the old
            // run — no stream buffers, approvals, cancellation flag, retry
            // counter or error. Only unsaved display debts carry over so text
            // that is not on disk yet does not blink out of the transcript.
            sessionId: event.sessionId,
            status: "running",
            streamingText: "",
            pendingOutputs: previous?.pendingOutputs ?? [],
            pendingReasoning: previous?.pendingReasoning ?? [],
            runId,
          }
        : {
            sessionId: event.sessionId,
            status: "running",
            streamingText: "",
            ...previous,
            runId,
          };
      let next = run;
      // Live tool-argument metadata is display-only: it never becomes a call,
      // never executes, and never enters the stored transcript.
      if (event.type === "tool_call_preview")
        next = {
          ...run,
          toolPreviews: upsertPreview(run.toolPreviews, {
            previewId: event.previewId,
            name: event.name,
            argumentsChars: event.argumentsChars,
            ...(event.linesAdded !== undefined ? { linesAdded: event.linesAdded } : {}),
            ...(event.linesRemoved !== undefined ? { linesRemoved: event.linesRemoved } : {}),
          }),
        };
      if (event.type === "tool_preview_reset")
        next = { ...run, toolPreviews: [] };
      if (event.type === "tool_started") {
        // The validated call supersedes its own preview stream.
        const previews = run.toolPreviews ?? [];
        next = {
          ...run,
          toolPreviews: event.previewId
            ? previews.filter((preview) => preview.previewId !== event.previewId)
            : previews,
        };
      }
      if (event.type === "retry_reset")
        next = {
          ...next,
          toolPreviews: [],
          streamingText: "",
          streamingReasoning: "",
          streamingTruncated: false,
          reasoningTruncated: false,
        };
      if (event.type === "provider_retry")
        next = { ...run, providerRetry: event.attempt };
      if (event.type === "context_usage")
        next = { ...run, providerRetry: undefined };
      if (event.type === "run_started") {
        const messageCount =
          state.activeSnapshot?.id === event.sessionId
            ? state.activeSnapshot.messages.length
            : 0;
        next = {
          ...next,
          accepted: true,
          permission: event.permission,
          toolPreviews: [],
          streamStartMessage: messageCount,
          reasoningStartMessage: messageCount,
        };
      }
      if (event.type === "permission_changed") {
        const queue = (
          run.approvalQueue ??
          (run.pendingApproval ? [run.pendingApproval] : [])
        ).filter(
          (approval) =>
            event.permission === "workspace" || approval.childSessionId,
        );
        next = {
          ...run,
          permission: event.permission,
          approvalQueue: queue,
          pendingApproval: queue[0],
        };
      }
      if (event.type === "reasoning_delta") {
        const text = run.streamingReasoning ?? "";
        next = {
          ...run,
          reasoningStartMessage: text
            ? (run.reasoningStartMessage ?? 0)
            : state.activeSnapshot?.id === event.sessionId
              ? state.activeSnapshot.messages.length
              : 0,
          streamingReasoning: text + event.text.slice(0, Math.max(0, STREAMING_REASONING_LIMIT - text.length)),
          reasoningTruncated: Boolean(run.reasoningTruncated) || text.length + event.text.length > STREAMING_REASONING_LIMIT,
        };
      }
      if (event.type === "text_delta")
        next = {
          ...run,
          streamStartMessage: run.streamingText
            ? (run.streamStartMessage ?? 0)
            : state.activeSnapshot?.id === event.sessionId
              ? state.activeSnapshot.messages.length
              : 0,
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
          ...next,
          pendingOutputs: retainOutput(
            run,
            state.activeSnapshot,
            event.call.id,
          ),
          pendingReasoning: retainReasoning(run, state.activeSnapshot, event.call.id),
          streamingReasoning: "",
          reasoningTruncated: false,
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
      if (event.type === "approval_resolved") {
        // Another client (or a permission change) settled this approval. Drop
        // the card locally instead of re-sending an answer: the shared
        // controller already applied the decision, so answering again would
        // either double-execute or fail. Remaining queued approvals stay
        // untouched and advance to the head; the submit spinner is always
        // cleared because this surface may have had a reply in flight.
        const queued =
          run.approvalQueue ?? (run.pendingApproval ? [run.pendingApproval] : []);
        const remaining = queued.filter(
          (request) => request.id !== event.approvalId,
        );
        const resolvedInFlight = remaining.length !== queued.length;
        next = {
          ...run,
          approvalQueue: remaining,
          pendingApproval: remaining[0],
          isSubmittingApproval: false,
          status:
            remaining.length > 0
              ? "awaiting_approval"
              : resolvedInFlight && run.status === "awaiting_approval"
                ? // The controller resumed the run by itself; nothing is left
                  // to display as blocked, and no duplicate event is emitted.
                  "running"
                : run.status,
        };
      }
      if (event.type === "state_changed")
        next = {
          ...run,
          pendingApproval: run.pendingApproval,
          status: run.pendingApproval ? "awaiting_approval" : event.status,
          ...(["cancelled", "failed", "completed", "interrupted"].includes(event.status)
            ? { toolPreviews: [] } : {}),
        };
      if (event.type === "run_finished")
        next = {
          ...run,
          providerRetry: undefined,
          toolPreviews: [],
          pendingOutputs: retainOutput(run, state.activeSnapshot),
          pendingReasoning: retainReasoning(run, state.activeSnapshot),
          streamingReasoning: "",
          reasoningTruncated: false,
          status: event.status,
          streamingText: "",
          streamingTruncated: false,
          pendingApproval: undefined,
          approvalQueue: [],
          isCancelling: false,
          isSubmittingApproval: false,
        };
      if (event.type === "error")
        next = { ...run, error: event.error, toolPreviews: [] };
      if (event.type === "web_search") next = { ...next, webSearch: event.search };
      if (["run_started", "run_finished", "error", "retry_reset", "web_search_result", "tool_started", "text_delta"].includes(event.type) ||
        (event.type === "state_changed" && ["cancelled", "failed", "interrupted"].includes(event.status)))
        next = { ...next, webSearch: undefined };
      if (event.type === "text_delta" || event.type === "reasoning_delta")
        next = { ...next, unreportedOutputTokens: (run.unreportedOutputTokens ?? 0) + estimateTokens(event.text) };
      if (event.type === "run_started" || event.type === "run_finished" || event.type === "retry_reset" ||
        (event.type === "context_usage" && event.usage.basis !== "projected" && event.usage.completionTokens !== undefined))
        next = { ...next, unreportedOutputTokens: 0 };
      const result = putRun(state, next);
      if (
        event.type === "text_delta" ||
        event.type === "reasoning_delta" ||
        event.type === "retry_reset" ||
        event.type === "provider_retry" ||
        event.type === "web_search" ||
        event.type === "web_search_result" ||
        // High-frequency ephemeral previews never touch the stored transcript.
        event.type === "tool_call_preview" ||
        event.type === "tool_preview_reset"
      )
        return result; // transient text never copies the stored transcript
      const snapshot = state.activeSnapshot;
      // Plans are independent records: update by id and keep the others, while
      // `plan` remains the current-plan projection for older surfaces.
      const updatedPlans =
        snapshot?.id === event.sessionId && event.type === "plan_updated"
          ? recordPlan(snapshot, event.plan)
          : null;
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
                ...(updatedPlans
                  ? { plan: updatedPlans.plan, plans: updatedPlans.plans }
                  : {}),
                updatedAt: event.timestamp,
                events: appendSessionEvent(snapshot.events, event),
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
      return { ...state, isSettingsOpen: action.isOpen };
    case "OPEN_USAGE_DASHBOARD":
      return { ...state, isUsageDashboardOpen: action.isOpen };
    case "OPEN_NEW_SESSION":
      return action.isOpen
        ? {
            ...state,
            isNewSessionOpen: true,
            isSettingsOpen: false,
            isUsageDashboardOpen: false,
            mobileTab: "task",
            isMobileSidebarOpen: false,
          }
        : { ...state, isNewSessionOpen: false };
    case "SET_MOBILE_TAB":
      return { ...state, mobileTab: action.tab };
    case "SET_MOBILE_SIDEBAR":
      return { ...state, isMobileSidebarOpen: action.isOpen };
    case "SET_ALERT_ERROR":
      return { ...state, alertError: action.error };
  }
}
