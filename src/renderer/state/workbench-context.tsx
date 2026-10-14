import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  configureInputSchema,
  createSessionInputSchema,
  runInputSchema,
} from "../../shared/schemas";
import type {
  ConfigureInput,
  CreateSessionInput,
  Permission,
  SessionId,
} from "../shared-types";
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
  const refreshSession = useCallback(
    async (id: SessionId) => {
      const version = (reads.current.get(id) ?? 0) + 1;
      reads.current.set(id, version);
      try {
        const snapshot = await window.forge.getSession(id);
        if (reads.current.get(id) === version)
          dispatch({ type: "SET_ACTIVE_SNAPSHOT", snapshot });
      } catch (err) {
        if (
          reads.current.get(id) === version &&
          current.current.activeSessionId === id
        ) {
          dispatch({ type: "SET_SNAPSHOT_LOADING", isLoading: false });
          fail(err);
        }
      }
    },
    [dispatch, fail],
  );
  const selectSession = useCallback(
    async (sessionId: SessionId) => {
      dispatch({ type: "SELECT_SESSION", sessionId });
      await refreshSession(sessionId);
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
      if (first && !current.current.activeSessionId)
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
      dispatch({ type: "RUN_EVENT_RECEIVED", event });
      if (
        event.event.type === "tool_started" ||
        event.event.type === "tool_finished" ||
        event.event.type === "agent_update"
      ) {
        void refreshSession(event.event.sessionId);
        if (event.event.type === "agent_update") {
          void loadSessions();
          void refreshSession(event.event.childSessionId);
        } else void loadSessions();
        if (
          current.current.activeSessionId &&
          current.current.activeSessionId !== event.event.sessionId
        )
          void refreshSession(current.current.activeSessionId);
      }
      if (event.event.type === "run_finished") {
        starting.current.delete(event.event.sessionId);
        // One bounded follow-up read for asynchronous title metadata; no polling.
        const id = event.event.sessionId;
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
  }, [dispatch, fail, loadSettings, loadSessions, refreshSession]);
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
  const createSession = async (input: CreateSessionInput) => {
    try {
      const snapshot = await window.forge.createSession(
        createSessionInputSchema.parse(input),
      );
      dispatch({ type: "SELECT_SESSION", sessionId: snapshot.id });
      dispatch({ type: "SET_ACTIVE_SNAPSHOT", snapshot });
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
  ) => {
    const id = target ?? current.current.activeSessionId;
    if (!id || !window.forge) return false;
    const run = current.current.activeRuns[id];
    if (
      starting.current.has(id) ||
      run?.status === "running" ||
      run?.status === "awaiting_approval"
    )
      return false;
    try {
      const input = runInputSchema.parse({
        sessionId: id,
        mode,
        prompt,
        permission: permission ?? current.current.settings?.defaultPermission,
        model: model ?? current.current.settings?.model,
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
    cancelRun,
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
    openNewSession: (isOpen: boolean) =>
      dispatch({ type: "OPEN_NEW_SESSION", isOpen }),
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
