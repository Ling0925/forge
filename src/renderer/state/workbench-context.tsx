import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  configureInputSchema,
  createSessionInputSchema,
  runInputSchema,
  type RunInput,
} from "../../shared/schemas";
import type {
  ConfigureInput,
  CreateSessionInput,
  Permission,
  SessionId,
} from "../shared-types";
import { shouldRefreshTranscript } from "./refresh-events";
import { RunInputQueue } from "./run-input-queue";
import type { ImageAttachment } from "../../shared/images";
import {
  type WorkbenchAction,
  initialWorkbenchState,
  workbenchReducer,
} from "./workbench-reducer";

function useController() {
  const [state, rawDispatch] = useReducer(
    workbenchReducer,
    initialWorkbenchState,
  );
  const current = useRef(state);
  useLayoutEffect(() => {
    current.current = state;
  }, [state]);
  const alive = useRef(true);
  const starting = useRef(new Set<string>());
  const answering = useRef(new Set<string>());
  const [restoredQueue] = useState(() => {
    try {
      const raw = sessionStorage.getItem("forge-pending-inputs");
      return raw && raw.length <= 20 * 1024 * 1024 ? RunInputQueue.restore(JSON.parse(raw)) : new RunInputQueue();
    } catch { return new RunInputQueue(); }
  });
  const inputQueue = useRef(restoredQueue);
  const queuedStarts = useRef(new Map<SessionId, RunInput>());
  const terminalSessions = useRef(new Set<SessionId>());
  const [, setQueueVersion] = useState(0);
  const updateQueue = useCallback((requirePersistence = false) => {
    try { sessionStorage.setItem("forge-pending-inputs", JSON.stringify(inputQueue.current.snapshot())); }
    catch (error) {
      if (requirePersistence) throw new Error("浏览器存储空间不足，无法保存待发图片；草稿已保留，请减少图片或在本轮结束后发送。");
      if (!(error instanceof DOMException)) throw error;
    }
    if (alive.current) setQueueVersion(version => version + 1);
  }, []);
  const launchQueued = useRef<(id: SessionId) => Promise<void>>(async () => {});
  const dispatch = useCallback((action: WorkbenchAction) => {
    if (alive.current) rawDispatch(action);
  }, []);
  const fail = useCallback(
    (err: unknown) =>
      dispatch({
        type: "SET_ALERT_ERROR",
        error:
          err instanceof Error ? err.message : "操作失败，请检查设置后重试",
      }),
    [dispatch],
  );
  const reads = useRef(new Map<string, number>());
  const pendingReads = useRef(new Map<string, Promise<void>>());
  const refreshSession = useCallback(
    async (id: SessionId, invalidate = true) => {
      const pending = pendingReads.current.get(id);
      if (pending && !invalidate) return pending;
      const version = (reads.current.get(id) ?? 0) + 1;
      reads.current.set(id, version);
      if (pending) return pending;
      const read = async () => {
        let observed: number | undefined;
        do {
          observed = reads.current.get(id);
          try {
            const snapshot = await window.forge.getSession(id);
            dispatch({ type: "SET_ACTIVE_SNAPSHOT", snapshot });
          } catch (err) {
            if (current.current.activeSessionId === id) {
              dispatch({ type: "SET_SNAPSHOT_LOADING", isLoading: false });
              fail(err);
            }
            break;
          }
        } while (alive.current && reads.current.get(id) !== observed);
      };
      const task = read().finally(() => {
        pendingReads.current.delete(id);
      });
      pendingReads.current.set(id, task);
      return task;
    },
    [dispatch, fail],
  );
  const selectSession = useCallback(
    async (sessionId: SessionId) => {
      dispatch({ type: "SELECT_SESSION", sessionId });
      await refreshSession(sessionId, false);
    },
    [dispatch, refreshSession],
  );
  const sessionListGeneration = useRef(0);
  const loadSessions = useCallback(async () => {
    const generation = ++sessionListGeneration.current;
    try {
      const sessions = await window.forge.listSessions();
      if (generation !== sessionListGeneration.current) return;
      dispatch({ type: "SET_SESSIONS", sessions });
      const first = sessions[0];
      if (first && !current.current.activeSessionId && !current.current.isNewSessionOpen)
        await selectSession(first.id);
    } catch (err) {
      fail(err);
    }
  }, [dispatch, fail, selectSession]);
  const loadSettings = useCallback(async () => {
    try {
      const settings = await window.forge.getSettings();
      dispatch({ type: "SET_SETTINGS", settings });
      if (!settings.isConfigured)
        dispatch({ type: "OPEN_SETTINGS", isOpen: true });
      return settings;
    } catch (err) {
      fail(err);
      return null;
    }
  }, [dispatch, fail]);
  useEffect(() => {
    alive.current = true;
    if (!window.forge) {
      fail(new Error("桌面 IPC 不可用。请从 Forge 桌面程序打开工作台。"));
      return;
    }
    const titleRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
    const off = window.forge.onEvent((event) => {
      const id = event.event.sessionId;
      if (event.event.type === "run_started") {
        terminalSessions.current.delete(id);
        const queued = queuedStarts.current.get(id);
        if (queued) {
          inputQueue.current.consume(queued);
          queuedStarts.current.delete(id);
          updateQueue();
        }
      }
      dispatch({ type: "RUN_EVENT_RECEIVED", event });
      if (shouldRefreshTranscript(event.event.type)) {
        // Refresh on run_started/approval_requested too: the accepted user turn
        // is persisted before run_started, so without this the message the user
        // just sent would not appear until the first tool or finish.
        void refreshSession(event.event.sessionId);
        if (event.event.type === "agent_update") {
          void loadSessions();
          void refreshSession(event.event.childSessionId);
        } else if (event.event.type === "run_started") void loadSessions();
      }
      if (event.event.type === "run_finished") {
        terminalSessions.current.add(id);
        queuedStarts.current.delete(id);
        if (event.event.status !== "completed") inputQueue.current.pause(id);
        updateQueue();
        if (event.event.status === "completed") setTimeout(() => { if (alive.current) void launchQueued.current(id); }, 0);
        starting.current.delete(event.event.sessionId);
        // One bounded follow-up read for asynchronous title metadata; no polling.
        clearTimeout(titleRefreshes.get(id));
        titleRefreshes.set(id, setTimeout(() => {
          titleRefreshes.delete(id);
          void loadSessions();
          if (current.current.activeSessionId === id) void refreshSession(id);
        }, 2500));
        void refreshSession(event.event.sessionId);
        void loadSessions();
      }
    });
    void loadSettings();
    void loadSessions();
    return () => {
      alive.current = false;
      off();
      for (const timer of titleRefreshes.values()) clearTimeout(timer);
    };
  }, [dispatch, fail, loadSettings, loadSessions, refreshSession, updateQueue]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        state.settings?.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : (state.settings?.theme ?? "dark");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state.settings?.theme]);
  const updateSettings = async (input: ConfigureInput) => {
    try {
      const settings = await window.forge.updateSettings(
        configureInputSchema.parse(input),
      );
      dispatch({ type: "SET_SETTINGS", settings });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };
  const createSession = async (input: CreateSessionInput, select = true) => {
    try {
      const snapshot = await window.forge.createSession(
        createSessionInputSchema.parse(input),
      );
      if (select) {
        dispatch({ type: "SELECT_SESSION", sessionId: snapshot.id });
        dispatch({ type: "SET_ACTIVE_SNAPSHOT", snapshot });
      }
      await loadSessions();
      return snapshot;
    } catch (err) {
      fail(err);
      return null;
    }
  };
  const startRun = async (
    prompt: string,
    permission?: Permission,
    model?: string,
    target?: SessionId,
    mode: "build" | "plan" = "build",
    providerSourceId?: string,
    images?: readonly ImageAttachment[],
  ) => {
    const id = target ?? current.current.activeSessionId;
    if (!id || !window.forge) return false;
    const run = current.current.activeRuns[id];
    if (
      starting.current.has(id) ||
      (!terminalSessions.current.has(id) && (run?.status === "running" ||
      run?.status === "awaiting_approval"))
    )
      return false;
    try {
      const input = runInputSchema.parse({
        sessionId: id,
        mode,
        prompt,
        ...(images?.length ? { images } : {}),
        permission: permission ?? current.current.settings?.defaultPermission,
        ...(model ? { model } : {}),
        ...(providerSourceId ? { providerSourceId } : {}),
      });
      starting.current.add(id);
      dispatch({ type: "START_RUN_INITIATED", sessionId: id });
      const runHandle = await window.forge.startRun(input);
      dispatch({ type: "START_RUN_RESOLVED", runHandle });
      return true;
    } catch (err) {
      starting.current.delete(id);
      fail(err);
      dispatch({ type: "START_RUN_FAILED", sessionId: id });
      await refreshSession(id);
      return false;
    }
  };
  const runQueued = async (id: SessionId) => {
    if (queuedStarts.current.has(id) || starting.current.has(id)) return;
    const run = current.current.activeRuns[id];
    if (!terminalSessions.current.has(id) && (run?.status === "running" || run?.status === "awaiting_approval")) return;
    const input = inputQueue.current.peek(id);
    if (!input) return;
    queuedStarts.current.set(id, input);
    const started = await startRun(input.prompt, input.permission, input.model, id, input.mode, input.providerSourceId, input.images);
    if (!started) {
      queuedStarts.current.delete(id);
      inputQueue.current.pause(id);
      updateQueue();
    }
  };
  const queueInput = (input: RunInput): boolean => {
    let queued: RunInput | undefined;
    try {
      queued = inputQueue.current.add(input);
      updateQueue(true);
      return true;
    } catch (error) {
      if (queued) inputQueue.current.remove(queued);
      fail(error); return false;
    }
  };
  launchQueued.current = runQueued;
  const sendSteering = async (prompt: string, id: SessionId, images?: readonly ImageAttachment[]): Promise<boolean> => {
    const run = current.current.activeRuns[id];
    if (!run?.runId) return false;
    try { await window.forge.steerRun(run.runId, prompt, images); await refreshSession(id); return true; }
    catch (error) { fail(error); return false; }
  };
  const cancelRun = async (target?: SessionId) => {
    const id = target ?? current.current.activeSessionId;
    const run = id ? current.current.activeRuns[id] : undefined;
    if (!id || !run?.runId || run.isCancelling) return;
    dispatch({ type: "SET_RUN_CANCELLING", sessionId: id, isCancelling: true });
    try {
      await window.forge.cancelRun(run.runId);
    } catch (err) {
      fail(err);
      dispatch({
        type: "SET_RUN_CANCELLING",
        sessionId: id,
        isCancelling: false,
      });
    }
  };
  const setRunPermission = async (permission: Permission) => {
    const id = current.current.activeSessionId;
    const run = id ? current.current.activeRuns[id] : undefined;
    if (!run?.runId) return false;
    try {
      await window.forge.setRunPermission(run.runId, permission);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };
  const answerApproval = async (
    id: SessionId,
    approvalId: string,
    approved: boolean,
  ) => {
    const run = current.current.activeRuns[id];
    if (
      !run?.runId ||
      run.pendingApproval?.id !== approvalId ||
      answering.current.has(approvalId)
    )
      return;
    answering.current.add(approvalId);
    dispatch({
      type: "SET_APPROVAL_SUBMITTING",
      sessionId: id,
      isSubmitting: true,
    });
    try {
      await window.forge.answerApproval(run.runId, approvalId, approved);
      dispatch({ type: "APPROVAL_ANSWERED", sessionId: id, approvalId });
    } catch (err) {
      fail(err);
      dispatch({
        type: "SET_APPROVAL_SUBMITTING",
        sessionId: id,
        isSubmitting: false,
      });
    } finally {
      answering.current.delete(approvalId);
    }
  };
  return {
    state,
    dispatch,
    loadSettings,
    loadSessions,
    selectSession,
    createSession,
    startRun,
    sendSteering,
    queueInput,
    pendingInputs: state.activeSessionId ? inputQueue.current.items(state.activeSessionId) : [],
    inputQueuePaused: state.activeSessionId ? inputQueue.current.isPaused(state.activeSessionId) : false,
    resumeInputs: () => {
      const id = current.current.activeSessionId;
      if (id) { inputQueue.current.resume(id); updateQueue(); void runQueued(id); }
    },
    clearInputs: () => {
      const id = current.current.activeSessionId;
      if (id && !queuedStarts.current.has(id)) { inputQueue.current.clear(id); updateQueue(); }
    },
    cancelRun,
    setRunPermission,
    answerApproval,
    updateSettings,
    chooseWorkspace: async () => {
      try {
        return await window.forge.chooseWorkspace();
      } catch (err) {
        fail(err);
        return null;
      }
    },
    refreshActiveSession: async () => {
      if (current.current.activeSessionId)
        await refreshSession(current.current.activeSessionId);
    },
    openSettings: (isOpen: boolean) =>
      dispatch({ type: "OPEN_SETTINGS", isOpen }),
    openNewSession: (isOpen: boolean) => {
      dispatch({ type: "OPEN_NEW_SESSION", isOpen });
      if (isOpen) requestAnimationFrame(() => document.getElementById("new-prompt")?.focus());
    },
    setMobileTab: (tab: "task" | "inspector") =>
      dispatch({ type: "SET_MOBILE_TAB", tab }),
    setMobileSidebar: (isOpen: boolean) =>
      dispatch({ type: "SET_MOBILE_SIDEBAR", isOpen }),
    clearAlert: () => dispatch({ type: "SET_ALERT_ERROR", error: null }),
  };
}
const Context = createContext<ReturnType<typeof useController> | null>(null);
export function WorkbenchProvider({
  children,
}: { readonly children: ReactNode }) {
  const value = useController();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkbench() {
  const value = useContext(Context);
  if (!value) throw new Error("WorkbenchProvider required");
  return value;
}
