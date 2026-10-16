import {
  Archive,
  FolderOpen,
  Gear,
  MagnifyingGlass,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useWorkbench } from "../../state/workbench-context";
import { IconButton } from "../primitives/IconButton";
import { SessionListItem } from "./SessionListItem";

export function Sidebar() {
  const { state, openNewSession, openSettings, setMobileSidebar } =
    useWorkbench();

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
        <div className="sidebar-brand-row">
          <div className="sidebar-logo">
            <span className="sidebar-title">Forge</span>
            <span className="sidebar-badge">Agent</span>
          </div>
          <button
            type="button"
            className="sidebar-new-btn"
            onClick={() => {
              openNewSession(true);
              setMobileSidebar(false);
            }}
            title="新建会话 (Ctrl+N / Cmd+N)"
            aria-label="新建会话"
          >
            <Plus size={15} weight="bold" />
            <span>新任务</span>
          </button>
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

      <div className="sidebar-search">
        <div className="sidebar-search-input-wrap">
          <MagnifyingGlass size={13} className="sidebar-search-icon" />
          <input
            className="sidebar-search-input"
            aria-label="搜索会话"
            placeholder="搜索任务 / 工作区..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`sidebar-archive-toggle ${showArchived ? "is-active" : ""}`}
          onClick={() => setShowArchived(!showArchived)}
          title={showArchived ? "隐藏归档会话" : "显示归档会话"}
          aria-pressed={showArchived}
        >
          <Archive size={13} weight={showArchived ? "fill" : "regular"} />
        </button>
      </div>

      <div className="sidebar-sessions-list">
        {state.isSessionsLoading && state.sessions.length === 0 ? (
          <p className="wb-muted sidebar-empty">正在加载会话...</p>
        ) : state.sessions.length === 0 ? (
          <p className="wb-muted sidebar-empty">暂无历史任务</p>
        ) : (
          filtered.map((session) => (
            <SessionListItem key={session.id} session={session} />
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <IconButton
          icon={<Gear size={15} weight="regular" />}
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
