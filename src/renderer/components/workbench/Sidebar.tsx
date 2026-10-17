import {
  Archive,
  CaretRight,
  Folder,
  FolderOpen,
  Gear,
  MagnifyingGlass,
  Plus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { SessionSummary } from "../../shared-types";
import { useWorkbench } from "../../state/workbench-context";
import { IconButton } from "../primitives/IconButton";
import { SessionListItem } from "./SessionListItem";

/** Folder label for a workspace path; the full path stays available as a tooltip. */
function workspaceName(workspace: string) {
  const trimmed = workspace.replace(/[\\/]+$/, "");
  const leaf = trimmed.split(/[\\/]/).pop();
  return leaf && leaf.length > 0 ? leaf : workspace;
}

interface SessionGroup {
  readonly workspace: string;
  readonly sessions: readonly SessionSummary[];
}

export function Sidebar() {
  const { state, openNewSession, openSettings, setMobileSidebar } =
    useWorkbench();

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const filtered = state.sessions.filter(
    (session) =>
      (showArchived || !session.archived) &&
      `${session.title} ${session.workspace}`.toLowerCase().includes(needle),
  );
  // Sessions arrive newest-first, so first-seen insertion order already lists the
  // folders by most recent activity; the order inside a folder is preserved too.
  const groups: readonly SessionGroup[] = (() => {
    const byWorkspace = new Map<string, SessionSummary[]>();
    for (const session of filtered) {
      const existing = byWorkspace.get(session.workspace);
      if (existing) existing.push(session);
      else byWorkspace.set(session.workspace, [session]);
    }
    return [...byWorkspace].map(([workspace, sessions]) => ({
      workspace,
      sessions,
    }));
  })();
  const activeWorkspace =
    state.activeSnapshot?.workspace ??
    state.sessions[0]?.workspace ??
    "未配置工作区";
  const toggleFolder = (workspace: string) =>
    setCollapsedFolders((previous) => ({
      ...previous,
      [workspace]: !previous[workspace],
    }));

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
          <div className="sidebar-brand-actions">
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
            <button
              type="button"
              className="wb-icon-btn sidebar-mobile-close"
              onClick={() => setMobileSidebar(false)}
              aria-label="关闭侧边栏"
              title="关闭侧边栏"
            >
              <X size={15} weight="bold" />
            </button>
          </div>
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
        ) : groups.length === 0 ? (
          <p className="wb-muted sidebar-empty">没有匹配的任务</p>
        ) : (
          groups.map((group) => {
            // A live search must reveal its matches, so collapse state is held
            // back while filtering and restored once the query is cleared.
            const isCollapsed =
              !searching && Boolean(collapsedFolders[group.workspace]);
            const bodyId = `sidebar-folder-${encodeURIComponent(group.workspace)}`;
            return (
              <section className="session-folder" key={group.workspace}>
                <button
                  type="button"
                  className={`session-folder-header${isCollapsed ? " is-collapsed" : ""}`}
                  onClick={() => toggleFolder(group.workspace)}
                  aria-expanded={!isCollapsed}
                  aria-controls={bodyId}
                  title={group.workspace}
                >
                  <CaretRight
                    size={11}
                    weight="bold"
                    className="session-folder-caret"
                    aria-hidden="true"
                  />
                  {isCollapsed ? (
                    <Folder
                      size={13}
                      weight="regular"
                      className="session-folder-icon"
                      aria-hidden="true"
                    />
                  ) : (
                    <FolderOpen
                      size={13}
                      weight="regular"
                      className="session-folder-icon"
                      aria-hidden="true"
                    />
                  )}
                  <span className="session-folder-name">
                    {workspaceName(group.workspace)}
                  </span>
                  <span className="session-folder-count">
                    {group.sessions.length}
                  </span>
                </button>
                <div
                  className="session-folder-body"
                  id={bodyId}
                  hidden={isCollapsed}
                >
                  {group.sessions.map((session) => (
                    <SessionListItem key={session.id} session={session} />
                  ))}
                </div>
              </section>
            );
          })
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
