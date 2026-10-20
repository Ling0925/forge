import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useGlobalModalShortcuts } from "../../state/modal-shortcuts";
import { WorkbenchProvider, useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { ErrorState } from "../primitives/ErrorState";
import { Composer } from "./Composer";
import { Inspector } from "./Inspector";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { Transcript } from "./Transcript";
import { UsageDashboard } from "./UsageDashboard";
import { Welcome } from "./Welcome";
import { WorkbenchHeader } from "./WorkbenchHeader";
import "./workbench.css";
import "./app.css";
import "./workbench-header.css";
import "./new-session.css";
import "./inspector.css";
import "../../styles/motion.css";

function Workbench() {
  const {
    state,
    openNewSession,
    openSettings,
    setMobileTab,
    setMobileSidebar,
    clearAlert,
    loadSettings,
    loadSessions,
    refreshActiveSession,
  } = useWorkbench();
  useGlobalModalShortcuts({
    onNewSession: (open) => {
      if (!state.isSettingsOpen) openNewSession(open);
    },
    onSettings: openSettings,
    onEscape: () => setMobileSidebar(false),
  });
  const isNew = state.isNewSessionOpen || !state.activeSessionId;
  const pending = Object.values(state.activeRuns).filter(
    (run) => run.pendingApproval,
  ).length;
  const backgroundPending = Object.values(state.activeRuns).filter(
    (run) => run.pendingApproval && run.sessionId !== state.activeSessionId,
  ).length;
  const isWideScreen = () => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(min-width: 1001px)").matches;
  };
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => !isWideScreen(),
  );
  const [focusToken, setFocusToken] = useState(0);
  const previousBackgroundPending = useRef(0);
  const detailsToggleRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (backgroundPending > 0 && previousBackgroundPending.current === 0) {
      setInspectorCollapsed(false);
    }
    previousBackgroundPending.current = backgroundPending;
  }, [backgroundPending]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(min-width: 1001px)");
    const update = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setInspectorCollapsed(false);
      } else {
        setInspectorCollapsed(true);
        setMobileTab("task");
      }
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [setMobileTab]);
  const revealInspector = () => {
    setInspectorCollapsed(false);
    setMobileTab("inspector");
    setFocusToken((token) => token + 1);
  };
  const closeInspector = () => {
    setInspectorCollapsed(true);
    setMobileTab("task");
  };
  return (
    <>
      <div
        hidden={state.isSettingsOpen}
        inert={state.isSettingsOpen}
        style={state.isSettingsOpen ? { display: "none" } : undefined}
        className={`workbench wb-app mobile-${state.mobileTab}${inspectorCollapsed ? " inspector-collapsed" : ""}${state.isMobileSidebarOpen ? " sidebar-open" : ""}`}
      >
        <button
          type="button"
          tabIndex={-1}
          className={`wb-sidebar-backdrop${state.isMobileSidebarOpen ? " is-open" : ""}`}
          onClick={() => setMobileSidebar(false)}
          aria-hidden="true"
        />
        <Sidebar />
        <div className="workbench-content">
          <WorkbenchHeader
            isNew={isNew}
            pending={pending}
            inspector={{
              collapsed: inspectorCollapsed,
              toggleRef: detailsToggleRef,
              reveal: revealInspector,
              close: closeInspector,
            }}
          />
          <div className="workbench-panes">
            <main className={`workbench-main${isNew ? " wb-new-session" : ""}`}>
              {state.alertError && (
                <ErrorState
                  title="操作未完成"
                  error={state.alertError}
                  actions={
                    <>
                      <Button
                        onClick={() => {
                          clearAlert();
                          void loadSettings();
                          void loadSessions();
                          void refreshActiveSession();
                        }}
                      >
                        刷新 / 重试
                      </Button>
                      <Button onClick={clearAlert}>关闭提示</Button>
                    </>
                  }
                />
              )}
              {isNew ? <Welcome /> : <Transcript />}
              <Composer isNew={isNew} />
            </main>
            <Inspector
              focusToken={focusToken}
              onRequestCollapse={() => {
                flushSync(() => {
                  closeInspector();
                });
                detailsToggleRef.current?.focus();
              }}
            />
          </div>
        </div>
      </div>
      <Settings />
      <UsageDashboard />
    </>
  );
}

export function App() {
  return (
    <WorkbenchProvider>
      <Workbench />
    </WorkbenchProvider>
  );
}
