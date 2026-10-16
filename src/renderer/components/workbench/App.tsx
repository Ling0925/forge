import { Gear, Info } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useGlobalModalShortcuts } from "../../state/modal-shortcuts";
import { WorkbenchProvider, useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { ErrorState } from "../primitives/ErrorState";
import { IconButton } from "../primitives/IconButton";
import { CommandPalette } from "./CommandPalette";
import { Composer } from "./Composer";
import { Inspector } from "./Inspector";
import { SessionActions } from "./SessionActions";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { Transcript } from "./Transcript";
import { Welcome } from "./Welcome";
import "./workbench.css";
import "./app.css";
import "./new-session.css";
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
  // Global new/settings shortcuts never stack over an open native dialog
  // (settings, new task, palette, or a local MCP / restore / rename panel).
  useGlobalModalShortcuts({
    onNewSession: openNewSession,
    onSettings: openSettings,
    onEscape: () => setMobileSidebar(false),
  });
  const isNew = state.isNewSessionOpen || !state.activeSessionId;
  const pending = Object.values(state.activeRuns).filter(
    (r) => r.pendingApproval,
  ).length;
  const backgroundPending = Object.values(state.activeRuns).filter(
    (r) => r.pendingApproval && r.sessionId !== state.activeSessionId,
  ).length;
  // Wide-screen inspector is on-demand (closed by default for a clean reading
  // surface) via the `.inspector-collapsed` shell class; the Inspector itself
  // stays mounted so tab/scroll/field state survives every toggle.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [focusToken, setFocusToken] = useState(0);
  const previousBackgroundPending = useRef(0);
  // Stable anchor for focus restoration when the inspector's inner close
  // button (which lives inside the pane being hidden) is used.
  const detailsToggleRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // Current-session approvals are already surfaced inline in the Transcript.
    // Only auto-expand the inspector when a background task requires approval,
    // avoiding unnecessary layout disruption for active reading.
    if (backgroundPending > 0 && previousBackgroundPending.current === 0) {
      setInspectorCollapsed(false);
    }
    previousBackgroundPending.current = backgroundPending;
  }, [backgroundPending]);
  const revealInspector = () => {
    setInspectorCollapsed(false);
    setMobileTab("inspector");
    setFocusToken((token) => token + 1);
  };
  return (
    <div
      className={`workbench wb-app mobile-${state.mobileTab}${inspectorCollapsed ? " inspector-collapsed" : ""}`}
    >
      <nav className="wb-mobile-nav" aria-label="工作台导航">
        <Button onClick={() => setMobileSidebar(!state.isMobileSidebarOpen)}>
          会话
        </Button>
        <Button
          onClick={() => setMobileTab("task")}
          aria-pressed={state.mobileTab === "task"}
        >
          任务
        </Button>
        <Button
          onClick={revealInspector}
          aria-pressed={state.mobileTab === "inspector"}
        >
          详情{pending ? ` · 待批准 ${pending}` : ""}
        </Button>
        <Button onClick={() => openSettings(true)}>设置</Button>
      </nav>
      <Sidebar />
      <main className={`workbench-main${isNew ? " wb-new-session" : ""}`}>
        <header className="workbench-task-header">
          <CommandPalette />
          <div className="wb-header-title">
            <h1
              title={isNew ? "新会话" : state.activeSnapshot?.title}
              aria-label={
                isNew
                  ? "新会话"
                  : (state.activeSnapshot?.title ?? "Forge 工作台")
              }
            >
              {isNew
                ? "新会话"
                : (state.activeSnapshot?.title ?? "Forge 工作台")}
            </h1>
          </div>
          <div className="wb-header-actions">
            {pending > 0 && (
              <button
                type="button"
                className="wb-approval-pill"
                onClick={revealInspector}
                aria-label={`待批准 ${pending} 项，打开执行详情`}
                title={`待批准 ${pending} 项`}
              >
                待批准 {pending}
              </button>
            )}
            <button
              type="button"
              ref={detailsToggleRef}
              className={`wb-icon-btn wb-details-toggle${inspectorCollapsed ? "" : " is-active"}`}
              aria-expanded={!inspectorCollapsed}
              aria-label={inspectorCollapsed ? "展开详情" : "收起详情"}
              title="执行详情"
              onClick={() => {
                if (inspectorCollapsed) revealInspector();
                else setInspectorCollapsed(true);
              }}
            >
              <Info size={16} weight="regular" />
            </button>
            {!isNew && <SessionActions key={state.activeSessionId ?? "none"} />}
            <IconButton
              icon={<Gear size={16} weight="regular" />}
              size="sm"
              label="设置"
              onClick={() => openSettings(true)}
            />
          </div>
        </header>
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
        {!isNew && <Transcript />}
        {isNew && <Welcome />}
        <Composer isNew={isNew} />
      </main>
      <Inspector
        focusToken={focusToken}
        onRequestCollapse={() => {
          // Explicit inner close only: the focused button is inside the pane
          // being hidden, so hand focus back to the stable header toggle.
          // Background approval auto-open still never changes focus (typing
          // safety); the header toggle click is already focused naturally.
          setInspectorCollapsed(true);
          detailsToggleRef.current?.focus();
        }}
      />
      <Settings />
    </div>
  );
}
export function App() {
  return (
    <WorkbenchProvider>
      <Workbench />
    </WorkbenchProvider>
  );
}
