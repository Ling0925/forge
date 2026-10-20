import {
  ArrowsClockwise,
  Calendar,
  ChartBar,
  Cpu,
  Database,
  Lightning,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UsageFilter, UsageStatsDto } from "../../shared-types";
import { compactTokens } from "../../state/session-usage";
import { useWorkbench } from "../../state/workbench-context";
import { Tabs } from "../primitives/Tabs";
import { UsageRequests } from "./UsageRequests";
import "./usage-dashboard.css";

const usageTabs = [
  { id: "usage-summary", label: "用量统计" },
  { id: "usage-requests", label: "请求记录" },
];

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function UsageDashboard() {
  const { state, openUsageDashboard, selectSession } = useWorkbench();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageStatsDto | null>(null);
  const [activeTab, setActiveTab] = useState("usage-summary");
  const requestVersion = useRef(0);
  const routeGroups = state.settings?.routeGroups ?? [];

  const [daysFilter, setDaysFilter] = useState<number | undefined>(undefined);
  const [workspaceFilter, setWorkspaceFilter] = useState<string | undefined>(
    undefined,
  );

  // Extract unique workspaces from existing session summaries
  const availableWorkspaces = useMemo(() => {
    const set = new Set<string>();
    for (const s of state.sessions) {
      if (s.workspace) set.add(s.workspace);
    }
    return Array.from(set);
  }, [state.sessions]);

  const fetchStats = useCallback(async () => {
    if (!window.forge?.getUsageStats) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const filter: UsageFilter = {
        days: daysFilter,
        workspace: workspaceFilter,
      };
      const res = await window.forge.getUsageStats(filter);
      if (version === requestVersion.current) setData(res);
    } catch (err) {
      if (version === requestVersion.current) {
        setError(err instanceof Error ? err.message : "获取用量统计数据失败，请重试。");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [daysFilter, workspaceFilter]);

  // Fetch when dashboard is opened or filters change
  useEffect(() => {
    if (state.isUsageDashboardOpen) {
      setData(null);
      void fetchStats();
    }
    return () => { requestVersion.current += 1; };
  }, [state.isUsageDashboardOpen, fetchStats]);

  // Handle escape key
  useEffect(() => {
    if (!state.isUsageDashboardOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        openUsageDashboard(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.isUsageDashboardOpen, openUsageDashboard]);

  if (!state.isUsageDashboardOpen) return null;

  const maxDailyTokens =
    data?.daily && data.daily.length > 0
      ? Math.max(...data.daily.map((d) => d.totalTokens), 1)
      : 1;

  const totalTokens = data?.totalTokens ?? 0;

  return (
    <div
      className="usage-dashboard-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="用量看板"
      onClick={(e) => {
        if (e.target === e.currentTarget) openUsageDashboard(false);
      }}
    >
      <div className="usage-dashboard-modal">
        {/* Header */}
        <header className="usage-dashboard-header">
          <div className="usage-dashboard-title-area">
            <div className="usage-dashboard-icon-badge">
              <ChartBar size={20} weight="bold" />
            </div>
            <div className="usage-dashboard-title-text">
              <h2>用量看板</h2>
            </div>
          </div>

          <div className="usage-dashboard-filters">
            {/* Days Filter */}
            <select
              className="usage-filter-select"
              aria-label="时间周期筛选"
              value={daysFilter ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setDaysFilter(val ? Number.parseInt(val, 10) : undefined);
              }}
            >
              <option value="">全部时间</option>
              <option value="1">今天 (24小时内)</option>
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
            </select>

            {/* Workspace Filter */}
            <select
              className="usage-filter-select"
              aria-label="工作区筛选"
              value={workspaceFilter ?? ""}
              onChange={(e) => setWorkspaceFilter(e.target.value || undefined)}
            >
              <option value="">全部工作区</option>
              {availableWorkspaces.map((ws) => (
                <option key={ws} value={ws}>
                  {ws.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || ws}
                </option>
              ))}
            </select>
          </div>

          <div className="usage-dashboard-actions">
            {/* Refresh */}
            <button
              type="button"
              className={`usage-dashboard-btn usage-dashboard-btn-icon ${loading ? "refreshing" : ""}`}
              onClick={fetchStats}
              title="刷新统计数据"
              aria-label="刷新统计数据"
              disabled={loading}
            >
              <ArrowsClockwise size={15} />
            </button>

            {/* Close */}
            <button
              type="button"
              className="usage-dashboard-btn usage-dashboard-btn-icon"
              onClick={() => openUsageDashboard(false)}
              title="关闭看板 (Esc)"
              aria-label="关闭看板"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <Tabs tabs={usageTabs} activeId={activeTab} onChange={setActiveTab}
          ariaLabel="用量看板" className="usage-dashboard-tabs" />

        {/* Body */}
        <div className="usage-dashboard-body" aria-busy={loading}>
          {error && (
            <div className="usage-empty-state" style={{ color: "#ef4444" }}>
              <p>{error}</p>
              <button
                type="button"
                className="usage-dashboard-btn"
                onClick={fetchStats}
              >
                重试
              </button>
            </div>
          )}

          {loading && !data && <div className="usage-empty-state" role="status">加载中…</div>}
          {data && activeTab === "usage-requests" && (
            <div id="tabpanel-usage-requests" role="tabpanel" aria-labelledby="tab-btn-usage-requests">
              <UsageRequests requests={data.requests ?? []} />
            </div>
          )}
          {data && activeTab === "usage-summary" && (
            <div id="tabpanel-usage-summary" role="tabpanel" aria-labelledby="tab-btn-usage-summary" className="usage-summary">
              {/* KPI Cards */}
              <div className="usage-kpi-grid">
                <div className="usage-kpi-card">
                  <div className="usage-kpi-label">
                    <span>总消耗 Tokens</span>
                    <Lightning size={14} />
                  </div>
                  <div className="usage-kpi-value">
                    {compactTokens(data.totalTokens)}
                  </div>
                  <div className="usage-kpi-sub">
                    <span>入 {compactTokens(data.totalPromptTokens)}</span>
                    <span>·</span>
                    <span>出 {compactTokens(data.totalCompletionTokens)}</span>
                  </div>
                </div>

                <div className="usage-kpi-card">
                  <div className="usage-kpi-label">
                    <span>平均缓存命中率</span>
                    <Database size={14} />
                  </div>
                  <div className="usage-kpi-value">
                    {percent(data.averageCacheRate)}
                  </div>
                  <div className="usage-kpi-sub">
                    <span>命中 {compactTokens(data.totalCachedTokens)} tokens</span>
                  </div>
                </div>

                <div className="usage-kpi-card">
                  <div className="usage-kpi-label">
                    <span>会话与运行总数</span>
                    <Calendar size={14} />
                  </div>
                  <div className="usage-kpi-value">
                    {data.totalSessions} <span style={{ fontSize: 13, fontWeight: "normal" }}>会话</span>
                  </div>
                  <div className="usage-kpi-sub">
                    <span>累计运行 {data.totalRuns} 次任务</span>
                  </div>
                </div>

                <div className="usage-kpi-card">
                  <div className="usage-kpi-label">
                    <span>主力模型</span>
                    <Cpu size={14} />
                  </div>
                  <div
                    className="usage-kpi-value"
                    style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={data.models[0]?.model || "暂无模型"}
                  >
                    {data.models[0]?.model ? data.models[0].model.split("/").pop() : "—"}
                  </div>
                  <div className="usage-kpi-sub">
                    <span>共 {data.models.length} 个使用中的模型</span>
                  </div>
                </div>
              </div>

              {/* Charts Split: Daily Trend & Model Breakdown */}
              <div className="usage-charts-split">
                {/* Daily Trend */}
                <div className="usage-dashboard-section">
                  <div className="usage-section-header">
                    <span className="usage-section-title">
                      <Calendar size={15} />
                      每日 Token 消耗趋势
                    </span>
                    <div className="usage-chart-legend">
                      <span className="usage-legend-item" title="模型生成输出 Tokens">
                        <span className="usage-legend-dot usage-legend-completion" />
                        <span>输出</span>
                      </span>
                      <span className="usage-legend-item" title="命中的 Prompt 缓存 Tokens">
                        <span className="usage-legend-dot usage-legend-cached" />
                        <span>缓存</span>
                      </span>
                      <span className="usage-legend-item" title="未命中缓存的普通输入 Tokens">
                        <span className="usage-legend-dot usage-legend-uncached" />
                        <span>输入</span>
                      </span>
                    </div>
                  </div>

                  {data.daily.length === 0 ? (
                    <div className="usage-empty-state">
                      <p>当前时间段无每日消耗记录</p>
                    </div>
                  ) : (
                    <div className="usage-daily-chart" tabIndex={0} aria-label="每日消耗柱状图">
                      {data.daily.map((d) => {
                        const heightPercent = Math.max(
                          (d.totalTokens / maxDailyTokens) * 100,
                          4,
                        );
                        const uncachedPrompt = Math.max(d.promptTokens - d.cachedTokens, 0);
                        const cached = Math.min(d.cachedTokens, d.promptTokens);
                        const completion = d.completionTokens;
                        const dayTotal = uncachedPrompt + cached + completion;

                        const completionPct = dayTotal > 0 ? (completion / dayTotal) * 100 : 0;
                        const uncachedPct = dayTotal > 0 ? (uncachedPrompt / dayTotal) * 100 : 0;
                        const cachedPct = dayTotal > 0 ? (cached / dayTotal) * 100 : 0;

                        const tooltip = `${d.date}：总计 ${compactTokens(d.totalTokens)} tokens\n` +
                          `• 输出：${compactTokens(completion)}\n` +
                          `• 缓存读取：${compactTokens(cached)}\n` +
                          `• 未缓存输入：${compactTokens(uncachedPrompt)}`;

                        return (
                          <div key={d.date} className="usage-bar-col">
                            <div
                              className="usage-bar-stack"
                              style={{ height: `${heightPercent}%` }}
                              title={tooltip}
                            >
                              {completionPct > 0 && (
                                <div
                                  className="usage-bar-segment usage-bar-completion"
                                  style={{ height: `${completionPct}%` }}
                                />
                              )}
                              {uncachedPct > 0 && (
                                <div
                                  className="usage-bar-segment usage-bar-uncached"
                                  style={{ height: `${uncachedPct}%` }}
                                />
                              )}
                              {cachedPct > 0 && (
                                <div
                                  className="usage-bar-segment usage-bar-cached"
                                  style={{ height: `${cachedPct}%` }}
                                />
                              )}
                            </div>
                            <span className="usage-bar-date">
                              {d.date.slice(5)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Model Breakdown */}
                <div className="usage-dashboard-section">
                  <div className="usage-section-header">
                    <span className="usage-section-title">
                      <Cpu size={15} />
                      模型消耗分布
                    </span>
                  </div>

                  {data.models.length === 0 ? (
                    <div className="usage-empty-state">
                      <p>暂无模型使用记录</p>
                    </div>
                  ) : (
                    <div className="usage-models-list">
                      {data.models.map((m) => {
                        const share =
                          totalTokens > 0
                            ? (m.totalTokens / totalTokens) * 100
                            : 0;
                        return (
                          <div key={m.model} className="usage-model-item">
                            <div className="usage-model-info">
                              <span className="usage-model-name" title={m.model}>
                                {m.model}
                              </span>
                              <span className="usage-model-tokens">
                                {compactTokens(m.totalTokens)} ({share.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="usage-model-bar-track">
                              <div
                                className="usage-model-bar-fill"
                                style={{ width: `${Math.max(share, 2)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Top Sessions Table */}
              <div className="usage-dashboard-section">
                <div className="usage-section-header">
                  <span className="usage-section-title">
                    <Lightning size={15} />
                    消耗排名前列的会话
                  </span>
                  <span className="usage-kpi-badge">Top {data.topSessions.length}</span>
                </div>

                {data.topSessions.length === 0 ? (
                  <div className="usage-empty-state">
                    <p>所选条件下暂无会话数据</p>
                  </div>
                ) : (
                  <div className="usage-table-wrapper">
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>会话标题</th>
                          <th>工作区</th>
                          <th>模型</th>
                          <th>输入 / 输出</th>
                          <th>缓存命中</th>
                          <th>总 Tokens</th>
                          <th>更新时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topSessions.map((session) => {
                          const cacheRate =
                            session.promptTokens > 0
                              ? session.cachedTokens / session.promptTokens
                              : 0;
                          return (
                            <tr key={session.sessionId}>
                              <td>
                                <button
                                  type="button"
                                  className="usage-session-link"
                                  title={`打开会话：${session.title}`}
                                  onClick={() => {
                                    openUsageDashboard(false);
                                    void selectSession(session.sessionId);
                                  }}
                                >
                                  {session.title || "未命名会话"}
                                </button>
                              </td>
                              <td
                                className="usage-mono"
                                title={session.workspace}
                              >
                                {session.workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}
                              </td>
                              <td className="usage-mono">{session.model}</td>
                              <td className="usage-mono">
                                {compactTokens(session.promptTokens)} / {compactTokens(session.completionTokens)}
                              </td>
                              <td className="usage-mono">
                                {percent(cacheRate)}
                              </td>
                              <td className="usage-mono" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                                {compactTokens(session.totalTokens)}
                              </td>
                              <td className="usage-mono" style={{ color: "var(--text-secondary)" }}>
                                {session.updatedAt.slice(0, 16).replace("T", " ")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Actual provider attempts by route, source and credential */}
              {data.routes && data.routes.length > 0 && (
                <div className="usage-dashboard-section">
                  <div className="usage-section-header">
                    <span className="usage-section-title">
                      <ArrowsClockwise size={15} />
                      来源调用统计
                    </span>
                    <span className="usage-kpi-badge">
                      {data.routes.length} 条
                    </span>
                  </div>

                  <div className="usage-table-wrapper">
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>路由组</th>
                          <th>来源</th>
                          <th>凭据</th>
                          <th>模型</th>
                          <th>协议</th>
                          <th>尝试 / 成功 / 失败</th>
                          <th>输入 / 输出</th>
                          <th>总 Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.routes.map((route) => (
                          <tr
                            key={`${route.groupId ?? ""}|${route.sourceId}|${route.credentialId ?? ""}|${route.model}|${route.apiMode}`}
                          >
                            <td className="usage-mono">
                              {route.groupId
                                ? (routeGroups.find(
                                    (group) => group.id === route.groupId,
                                  )?.label ?? route.groupId)
                                : "—"}
                            </td>
                            <td className="usage-mono">{route.sourceId}</td>
                            <td className="usage-mono">
                              {route.credentialId ?? "—"}
                            </td>
                            <td className="usage-mono">{route.model}</td>
                            <td className="usage-mono">{route.apiMode}</td>
                            <td className="usage-mono">
                              {route.attempts} / {route.succeeded} /{" "}
                              {route.failed}
                              {route.unknownUsage > 0
                                ? ` · 未计 ${route.unknownUsage}`
                                : ""}
                            </td>
                            <td className="usage-mono">
                              {compactTokens(route.promptTokens)} /{" "}
                              {compactTokens(route.completionTokens)}
                            </td>
                            <td
                              className="usage-mono"
                              style={{
                                fontWeight: 600,
                                color: "var(--text-primary)",
                              }}
                            >
                              {compactTokens(route.totalTokens)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
