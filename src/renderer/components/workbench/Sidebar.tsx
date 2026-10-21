import {
  Archive,
  CaretRight,
  ChartBar,
  Folder,
  FolderOpen,
  Gear,
  MagnifyingGlass,
  Plus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import { isPrimarySession } from "../../../shared/sessions";
import type { SessionSummary } from "../../shared-types";
import { useWorkbench } from "../../state/workbench-context";
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

const DEFAULT_VISIBLE_COUNT = 10;
const PAGE_SIZE = 10;

export function Sidebar() {
  const {
    state,
    openNewSession,
    setMobileSidebar,
    openSettings,
    openUsageDashboard,
  } = useWorkbench();

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [visibleLimits, setVisibleLimits] = useState<
    Readonly<Record<string, number>>
  >({});
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const sessions = state.sessions.filter(isPrimarySession);
  const filtered = sessions.filter(
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
  const toggleFolder = (workspace: string) =>
    setCollapsedFolders((previous) => ({
      ...previous,
      [workspace]: !previous[workspace],
    }));

  const handleSeeMore = (workspace: string, currentEffectiveLimit: number) => {
    setVisibleLimits((previous) => ({
      ...previous,
      [workspace]: currentEffectiveLimit + PAGE_SIZE,
    }));
  };

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
        {state.isSessionsLoading && sessions.length === 0 ? (
          <p className="wb-muted sidebar-empty">正在加载会话...</p>
        ) : sessions.length === 0 ? (
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
            const configuredLimit =
              visibleLimits[group.workspace] ?? DEFAULT_VISIBLE_COUNT;
            const activeIndex = group.sessions.findIndex(
              (s) => s.id === state.activeSessionId,
            );
            const effectiveLimit =
              activeIndex >= configuredLimit
                ? Math.ceil((activeIndex + 1) / PAGE_SIZE) * PAGE_SIZE
                : configuredLimit;
            const visibleSessions = group.sessions.slice(0, effectiveLimit);
            const hasMore = visibleSessions.length < group.sessions.length;
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
                  className={`session-folder-collapse${isCollapsed ? " is-collapsed" : ""}`}
                  id={bodyId}
                  aria-hidden={isCollapsed}
                >
                  <div className="session-folder-body">
                    {visibleSessions.map((session) => (
                      <SessionListItem key={session.id} session={session} />
                    ))}
                    {hasMore && (
                      <button
                        type="button"
                        className="session-folder-more"
                        onClick={() =>
                          handleSeeMore(group.workspace, effectiveLimit)
                        }
                        aria-label={`查看更多会话（当前已显示 ${visibleSessions.length}/${group.sessions.length}）`}
                      >
                        <span>See more</span>
                      </button>
                    )}
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-actions">
          <button
            type="button"
            className="sidebar-settings-btn"
            onClick={() => {
              setMobileSidebar(false);
              openUsageDashboard(true);
            }}
            title="用量看板"
            aria-label="用量看板"
          >
            <ChartBar size={15} />
            <span>用量</span>
          </button>
          <button
            type="button"
            className="sidebar-settings-btn"
            onClick={() => {
              setMobileSidebar(false);
              openSettings(true);
            }}
            title="设置"
            aria-label="设置"
          >
            <Gear size={15} />
            <span>设置</span>
          </button>
        </div>
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
