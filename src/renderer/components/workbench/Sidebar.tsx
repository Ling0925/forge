import {
  CaretRight,
  FolderOpen,
  Gear,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { IconButton } from "../primitives/IconButton";
import { Input } from "../primitives/Input";

function formatTimestamp(iso: string) {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

const statusLabels: Record<string, string> = {
  running: "执行中",
  awaiting_approval: "待审批",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "中断",
  idle: "空闲",
};

function statusLabel(status: string) {
  return statusLabels[status] ?? "空闲";
}

export function Sidebar() {
  const {
    state,
    selectSession,
    openNewSession,
    openSettings,
    setMobileSidebar,
  } = useWorkbench();

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const filtered = state.sessions.filter(
    (session) =>
      (showArchived || !session.archived) &&
      `${session.title} ${session.workspace} ${session.model}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const activeWorkspace =
    state.activeSnapshot?.workspace ??
    state.sessions[0]?.workspace ??
    "未配置工作区";

  return (
    <aside
      className={`workbench-sidebar ${state.isMobileSidebarOpen ? "is-open" : ""}`}
      aria-label="会话与导航"
    >
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-title">Forge</span>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={14} weight="bold" />}
            onClick={() => {
              openNewSession(true);
              setMobileSidebar(false);
            }}
            title="新建任务 (Ctrl+N / Cmd+N)"
            aria-label="新建任务"
          >
            新建任务
          </Button>
        </div>

        <div
          className="sidebar-workspace-box wb-workspace-context"
          title={activeWorkspace}
        >
          <FolderOpen
            size={14}
            weight="regular"
            aria-hidden="true"
            className="wb-workspace-icon"
          />
          <span className="sidebar-workspace-path">{activeWorkspace}</span>
        </div>
      </div>

      <div className="sidebar-search wb-stack">
        <Input
          aria-label="搜索会话"
          placeholder="搜索任务 / 工作区 / 模型"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          显示已归档
        </label>
      </div>
      <div className="sidebar-sessions-list">
        {state.isSessionsLoading && state.sessions.length === 0 ? (
          <p className="wb-muted sidebar-empty">正在加载会话...</p>
        ) : state.sessions.length === 0 ? (
          <p className="wb-muted sidebar-empty">暂无历史任务</p>
        ) : (
          filtered.map((session) => {
            const isActive = session.id === state.activeSessionId;
            const run = state.activeRuns[session.id];
            const hasPendingApproval = Boolean(run?.pendingApproval);
            const currentStatus = run?.status ?? session.status;
            const label = hasPendingApproval
              ? "待批准"
              : `状态：${statusLabel(currentStatus)}`;
            const metadata = `${session.model} · ${formatTimestamp(session.updatedAt)} · ${statusLabel(currentStatus)}${hasPendingApproval ? " · 待批准" : ""}`;

            return (
              // One quiet row per session: strong title + tiny accessible
              // status mark. Full model/time/status metadata stays reachable
              // via the row tooltip and the disclosure below (never dropped).
              <div
                key={session.id}
                className={`session-item ${isActive ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  className="session-item-main"
                  onClick={() => {
                    void selectSession(session.id);
                    setMobileSidebar(false);
                  }}
                  aria-current={isActive ? "true" : undefined}
                  title={`${session.archived ? "归档 · " : ""}${session.title} · ${metadata}`}
                >
                  <span className="session-item-title">
                    {session.archived ? "归档 · " : ""}
                    {session.title}
                  </span>
                  <span
                    className={`wb-status-dot${hasPendingApproval ? " is-pending" : ""}`}
                    data-status={
                      hasPendingApproval ? "awaiting_approval" : currentStatus
                    }
                    role="img"
                    aria-label={label}
                  />
                </button>
                <details className="session-item-meta wb-disclosure">
                  <summary
                    aria-label={`${session.title} 详细信息`}
                    title={`${session.title} 详细信息`}
                  >
                    {/* Quiet caret icon instead of the repeated visible word
                        详情; the accessible name above is unchanged. */}
                    <CaretRight size={12} weight="bold" aria-hidden="true" />
                  </summary>
                  <div className="wb-disclosure-body">
                    <span>{session.model}</span>
                    <span>{formatTimestamp(session.updatedAt)}</span>
                    <span>
                      {statusLabel(currentStatus)}
                      {hasPendingApproval ? " · 待批准" : ""}
                    </span>
                  </div>
                </details>
              </div>
            );
          })
        )}
      </div>

      <div className="sidebar-footer">
        <IconButton
          icon={<Gear size={16} weight="regular" />}
          size="sm"
          label="系统设置 (Ctrl+, / Cmd+,)"
          onClick={() => openSettings(true)}
        />

        <div className="wb-row sidebar-footer-status">
          {!state.settings?.isConfigured && (
            <span className="wb-status-warning" title="尚未配置 API 端点或模型">
              <WarningCircle size={12} weight="bold" />
              未配置
            </span>
          )}
          <span
            className={`wb-status-dot${state.settings?.isConfigured ? "" : " is-pending"}`}
            data-status={
              state.settings?.isConfigured ? "ready" : "awaiting_approval"
            }
            role="img"
            aria-label={
              state.settings?.isConfigured
                ? "本地工作台 · 已配置"
                : "本地工作台 · 尚未配置 API 端点或模型"
            }
          />
        </div>
      </div>
    </aside>
  );
}
