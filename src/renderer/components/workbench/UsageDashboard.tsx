import {
  ArrowLeft,
  ArrowsClockwise,
  Calendar,
  ChartBar,
  Cpu,
  Database,
  Lightning,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  UsageFilter,
  UsageRequest,
  UsageStatsDto,
} from "../../shared-types";
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

const formatCostUsd = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value >= 0.0001) return `$${value.toFixed(4)}`;
  return "<$0.0001";
};

const formatDuration = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(2)} s`;
};

const shortModelName = (model: string) => {
  if (!model) return "—";
  const withoutSource = model.includes(":")
    ? model.split(":").slice(1).join(":")
    : model;
  return withoutSource.split("/").pop() || withoutSource;
};

interface ModelRequestPerf {
  readonly model: string;
  readonly requestCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly avgSpeed?: number | undefined;
  readonly peakSpeed?: number | undefined;
  readonly avgDurationMs?: number | undefined;
  readonly totalCostUsd?: number | undefined;
  readonly pricedCount: number;
}

function computeModelPerformance(
  requests: readonly UsageRequest[],
): ReadonlyMap<string, ModelRequestPerf> {
  const byModel = new Map<
    string,
    {
      requestCount: number;
      succeededCount: number;
      failedCount: number;
      speedSum: number;
      speedCount: number;
      peakSpeed: number;
      durationSum: number;
      durationCount: number;
      costSum: number;
      pricedCount: number;
    }
  >();

  for (const r of requests) {
    const key = r.model;
    const rawEntry = byModel.get(key) ?? {
      requestCount: 0,
      succeededCount: 0,
      failedCount: 0,
      speedSum: 0,
      speedCount: 0,
      peakSpeed: 0,
      durationSum: 0,
      durationCount: 0,
      costSum: 0,
      pricedCount: 0,
    };
    rawEntry.requestCount += 1;
    if (r.outcome === "succeeded") rawEntry.succeededCount += 1;
    else if (r.outcome === "failed") rawEntry.failedCount += 1;

    if (
      typeof r.tokensPerSecond === "number" &&
      Number.isFinite(r.tokensPerSecond) &&
      r.tokensPerSecond > 0
    ) {
      rawEntry.speedSum += r.tokensPerSecond;
      rawEntry.speedCount += 1;
      if (r.tokensPerSecond > rawEntry.peakSpeed)
        rawEntry.peakSpeed = r.tokensPerSecond;
    }
    if (
      typeof r.durationMs === "number" &&
      Number.isFinite(r.durationMs) &&
      r.durationMs >= 0
    ) {
      rawEntry.durationSum += r.durationMs;
      rawEntry.durationCount += 1;
    }
    if (
      typeof r.estimatedCostUsd === "number" &&
      Number.isFinite(r.estimatedCostUsd)
    ) {
      rawEntry.costSum += r.estimatedCostUsd;
      rawEntry.pricedCount += 1;
    }
    byModel.set(key, rawEntry);
  }

  const result = new Map<string, ModelRequestPerf>();
  for (const [model, item] of byModel.entries()) {
    result.set(model, {
      model,
      requestCount: item.requestCount,
      succeededCount: item.succeededCount,
      failedCount: item.failedCount,
      avgSpeed:
        item.speedCount > 0 ? item.speedSum / item.speedCount : undefined,
      peakSpeed: item.speedCount > 0 ? item.peakSpeed : undefined,
      avgDurationMs:
        item.durationCount > 0
          ? item.durationSum / item.durationCount
          : undefined,
      totalCostUsd: item.pricedCount > 0 ? item.costSum : undefined,
      pricedCount: item.pricedCount,
    });
  }
  return result;
}

const aggregateCostExplanation = "历史 Token 汇总按当前公开基础单价估算；缺少逐请求明细，未还原上下文阶梯价，不代表实际账单";

export function UsageDashboard() {
  const { state, openUsageDashboard, selectSession } = useWorkbench();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageStatsDto | null>(null);
  const [activeTab, setActiveTab] = useState("usage-summary");
  const [dailyChartMode, setDailyChartMode] = useState<"tokens" | "cost">(
    "tokens",
  );
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

  const fetchStats = useCallback(async (refreshPrices = false) => {
    if (!window.forge?.getUsageStats) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const filter: UsageFilter = {
        days: daysFilter,
        workspace: workspaceFilter,
        ...(refreshPrices ? { refreshPrices: true } : {}),
      };
      const res = await window.forge.getUsageStats(filter);
      if (version === requestVersion.current) setData(res);
    } catch (err) {
      if (version === requestVersion.current) {
        setError(
          err instanceof Error ? err.message : "获取用量统计数据失败，请重试。",
        );
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
    return () => {
      requestVersion.current += 1;
    };
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

  const requests = data?.requests ?? [];
  const costSummary = useMemo(() => {
    const models = data?.models ?? [];
    const priced = models.filter(model => model.estimatedCostUsd !== undefined);
    return {
      totalCostUsd: priced.length ? priced.reduce((sum, model) => sum + (model.estimatedCostUsd ?? 0), 0) : undefined,
      hasAggregateEstimate: models.some(model => model.aggregateEstimatedCostUsd !== undefined),
      incomplete: models.some(model => model.costIncomplete),
    };
  }, [data]);

  // Request-derived analytics
  const requestAnalytics = useMemo(() => {
    const priced = requests.filter(
      (r) =>
        typeof r.estimatedCostUsd === "number" &&
        Number.isFinite(r.estimatedCostUsd),
    );
    const withSpeed = requests.filter(
      (r) =>
        typeof r.tokensPerSecond === "number" &&
        Number.isFinite(r.tokensPerSecond) &&
        r.tokensPerSecond > 0,
    );
    const avgSpeed =
      withSpeed.length > 0
        ? withSpeed.reduce((sum, r) => sum + (r.tokensPerSecond ?? 0), 0) /
          withSpeed.length
        : undefined;
    const peakSpeed =
      withSpeed.length > 0
        ? Math.max(...withSpeed.map((r) => r.tokensPerSecond ?? 0))
        : undefined;

    const withDuration = requests.filter(
      (r) =>
        typeof r.durationMs === "number" &&
        Number.isFinite(r.durationMs) &&
        r.durationMs >= 0,
    );
    const avgDurationMs =
      withDuration.length > 0
        ? withDuration.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) /
          withDuration.length
        : undefined;

    let succeeded = 0;
    let failed = 0;
    let started = 0;
    let unknown = 0;
    let retries = 0;

    // 24-hour distribution buckets
    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      total: 0,
      succeeded: 0,
      failed: 0,
      started: 0,
      tokens: 0,
    }));

    // Daily request cost & count map
    const dailyRequestMap = new Map<
      string,
      {
        costUsd: number;
        pricedCount: number;
        count: number;
        speedSum: number;
        speedCount: number;
      }
    >();

    for (const r of requests) {
      if (r.outcome === "succeeded") succeeded += 1;
      else if (r.outcome === "failed") failed += 1;
      else if (r.outcome === "started") started += 1;
      else unknown += 1;

      if (r.attempt > 1) retries += 1;

      const parsed = new Date(r.timestamp);
      if (Number.isFinite(parsed.getTime())) {
        const h = parsed.getHours();
        const bucket = hourly[h];
        if (bucket) {
          bucket.total += 1;
          if (r.outcome === "succeeded") bucket.succeeded += 1;
          else if (r.outcome === "failed") bucket.failed += 1;
          else if (r.outcome === "started") bucket.started += 1;
          bucket.tokens += r.usage?.totalTokens ?? 0;
        }
      }

      const dayKey = r.timestamp.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        const dEntry = dailyRequestMap.get(dayKey) ?? {
          costUsd: 0,
          pricedCount: 0,
          count: 0,
          speedSum: 0,
          speedCount: 0,
        };
        dEntry.count += 1;
        if (
          typeof r.estimatedCostUsd === "number" &&
          Number.isFinite(r.estimatedCostUsd)
        ) {
          dEntry.costUsd += r.estimatedCostUsd;
          dEntry.pricedCount += 1;
        }
        if (
          typeof r.tokensPerSecond === "number" &&
          Number.isFinite(r.tokensPerSecond) &&
          r.tokensPerSecond > 0
        ) {
          dEntry.speedSum += r.tokensPerSecond;
          dEntry.speedCount += 1;
        }
        dailyRequestMap.set(dayKey, dEntry);
      }
    }

    const terminal = succeeded + failed;
    const successRate = terminal > 0 ? succeeded / terminal : undefined;
    const maxHourlyCount = Math.max(...hourly.map((h) => h.total), 1);
    const peakHour = hourly.reduce(
      (best, cur) => (cur.total > best.total ? cur : best),
      hourly[0] ?? {
        hour: 0,
        total: 0,
        succeeded: 0,
        failed: 0,
        started: 0,
        tokens: 0,
      },
    );

    const modelPerf = computeModelPerformance(requests);
    const modelPerfList = Array.from(modelPerf.values()).sort(
      (a, b) =>
        (b.avgSpeed ?? 0) - (a.avgSpeed ?? 0) ||
        b.requestCount - a.requestCount,
    );
    const maxModelSpeed = Math.max(
      ...modelPerfList.map((m) => m.peakSpeed ?? m.avgSpeed ?? 0),
      1,
    );
    const maxModelDuration = Math.max(
      ...modelPerfList.map((m) => m.avgDurationMs ?? 0),
      1,
    );

    return {
      pricedCount: priced.length,
      avgSpeed,
      peakSpeed,
      avgDurationMs,
      succeeded,
      failed,
      started,
      unknown,
      retries,
      successRate,
      hourly,
      maxHourlyCount,
      peakHour,
      dailyRequestMap,
      modelPerf,
      modelPerfList,
      maxModelSpeed,
      maxModelDuration,
    };
  }, [requests]);

  if (!state.isUsageDashboardOpen) return null;

  const totalTokens = data?.totalTokens ?? 0;
  const totalPromptTokens = data?.totalPromptTokens ?? 0;
  const totalCompletionTokens = data?.totalCompletionTokens ?? 0;
  const totalCachedTokens = Math.min(
    data?.totalCachedTokens ?? 0,
    totalPromptTokens,
  );
  const totalUncachedTokens = Math.max(
    totalPromptTokens - totalCachedTokens,
    0,
  );

  const maxDailyTokens =
    data?.daily && data.daily.length > 0
      ? Math.max(...data.daily.map((d) => d.totalTokens), 1)
      : 1;

  const avgDailyTokens =
    data?.daily && data.daily.length > 0
      ? Math.round(
          data.daily.reduce((sum, d) => sum + d.totalTokens, 0) /
            data.daily.length,
        )
      : 0;

  const peakDay =
    data?.daily && data.daily.length > 0
      ? data.daily.reduce((best, cur) =>
          cur.totalTokens > best.totalTokens ? cur : best,
        )
      : undefined;

  const maxDailyCost =
    data?.daily && data.daily.length > 0
      ? Math.max(
          ...data.daily.map(
            (d) => d.estimatedCostUsd ?? requestAnalytics.dailyRequestMap.get(d.date)?.costUsd ?? 0,
          ),
          0.0001,
        )
      : 0.0001;

  // SVG Donut geometry
  const donutRadius = 56;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const compositionTotal =
    totalUncachedTokens + totalCachedTokens + totalCompletionTokens;
  const completionRatio =
    compositionTotal > 0 ? totalCompletionTokens / compositionTotal : 0;
  const cachedRatio =
    compositionTotal > 0 ? totalCachedTokens / compositionTotal : 0;
  const uncachedRatio =
    compositionTotal > 0 ? totalUncachedTokens / compositionTotal : 0;

  const completionLen = completionRatio * donutCircumference;
  const cachedLen = cachedRatio * donutCircumference;
  const uncachedLen = uncachedRatio * donutCircumference;

  const maxSessionTokens =
    data?.topSessions && data.topSessions.length > 0
      ? Math.max(...data.topSessions.map((s) => s.totalTokens), 1)
      : 1;

  return (
    <div
      className="usage-dashboard-overlay usage-page"
      // biome-ignore lint/a11y/useSemanticElements: preserves dialog role contract on full-screen overlay container
      role="dialog"
      aria-modal="true"
      aria-label="用量看板"
    >
      <div className="usage-dashboard-modal">
        {/* Top Full-Page Navigation Header */}
        <header className="usage-dashboard-header">
          <div className="usage-dashboard-title-area">
            <button
              type="button"
              className="usage-back-btn"
              onClick={() => openUsageDashboard(false)}
              title="返回工作台 (Esc)"
            >
              <ArrowLeft size={15} weight="bold" />
              <span>返回工作台</span>
            </button>
            <span className="usage-header-divider" aria-hidden="true" />
            <div className="usage-dashboard-icon-badge" aria-hidden="true">
              <ChartBar size={18} weight="bold" />
            </div>
            <div className="usage-dashboard-title-text">
              <h2>用量看板</h2>
            </div>
          </div>

          <Tabs
            tabs={usageTabs}
            activeId={activeTab}
            onChange={setActiveTab}
            ariaLabel="用量看板"
            className="usage-dashboard-tabs"
          />

          <div className="usage-dashboard-controls">
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
                onChange={(e) =>
                  setWorkspaceFilter(e.target.value || undefined)
                }
              >
                <option value="">全部工作区</option>
                {availableWorkspaces.map((ws) => (
                  <option key={ws} value={ws}>
                    {ws
                      .replace(/[\\/]+$/, "")
                      .split(/[\\/]/)
                      .pop() || ws}
                  </option>
                ))}
              </select>
            </div>

            <div className="usage-dashboard-actions">
              {data?.pricing && data.pricing.state !== "ready" && (
                <span
                  className="usage-pricing-status"
                  role="status"
                  title={data.pricing.state === "unavailable"
                    ? "公开价格目录加载失败；点击刷新立即重试，不代表所有模型都没有定价"
                    : `价格更新失败，继续使用 ${data.pricing.fetchedAt ?? "此前"} 获取的缓存；点击刷新重试`}
                >
                  {data.pricing.state === "unavailable" ? "价格加载失败" : "使用缓存价格"}
                </span>
              )}
              {/* Refresh */}
              <button
                type="button"
                className={`usage-dashboard-btn usage-dashboard-btn-icon ${loading ? "refreshing" : ""}`}
                onClick={() => void fetchStats(true)}
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
          </div>
        </header>

        {/* Scrollable Page Body */}
        <div className="usage-dashboard-body" aria-busy={loading}>
          <div className="usage-page-container">
            {error && (
              <div className="usage-empty-state usage-error-banner">
                <p>{error}</p>
                <button
                  type="button"
                  className="usage-dashboard-btn"
                  onClick={() => void fetchStats(true)}
                >
                  重试
                </button>
              </div>
            )}

            {loading && !data && (
              <output className="usage-empty-state">加载中…</output>
            )}

            {data && activeTab === "usage-requests" && (
              <div
                id="tabpanel-usage-requests"
                role="tabpanel"
                aria-labelledby="tab-btn-usage-requests"
              >
                <UsageRequests requests={data.requests ?? []} />
              </div>
            )}

            {data && activeTab === "usage-summary" && (
              <div
                id="tabpanel-usage-summary"
                role="tabpanel"
                aria-labelledby="tab-btn-usage-summary"
                className="usage-summary"
              >
                {/* 6-Card KPI Strip */}
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
                      <span>
                        出 {compactTokens(data.totalCompletionTokens)}
                      </span>
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
                      <span>
                        命中 {compactTokens(data.totalCachedTokens)} tokens
                      </span>
                    </div>
                  </div>

                  <div className="usage-kpi-card">
                    <div className="usage-kpi-label">
                      <span>预估总费用 (USD)</span>
                      <ChartBar size={14} />
                    </div>
                    <div className="usage-kpi-value">
                      {formatCostUsd(costSummary.totalCostUsd)}
                    </div>
                    <div className="usage-kpi-sub" title={costSummary.hasAggregateEstimate ? aggregateCostExplanation : undefined}>
                      {costSummary.totalCostUsd !== undefined ? (
                        <span>
                          {costSummary.incomplete ? "部分计价" : "已计价"}
                          {requests.length > 0 && ` ${requestAnalytics.pricedCount} / ${requests.length} 次请求`}
                          {costSummary.hasAggregateEstimate && " · 含历史汇总估算"}
                        </span>
                      ) : (
                        <span>{data.pricing?.state === "unavailable"
                          ? "价格目录加载失败，点击刷新重试"
                          : "缺少价格或用量，费用未知"}</span>
                      )}
                    </div>
                  </div>

                  <div className="usage-kpi-card">
                    <div className="usage-kpi-label">
                      <span>平均输出速度</span>
                      <Lightning size={14} />
                    </div>
                    <div className="usage-kpi-value">
                      {requestAnalytics.avgSpeed !== undefined
                        ? `${requestAnalytics.avgSpeed.toFixed(1)}`
                        : "—"}
                      {requestAnalytics.avgSpeed !== undefined && (
                        <span className="usage-kpi-unit">tok/s</span>
                      )}
                    </div>
                    <div className="usage-kpi-sub">
                      <span>
                        峰值{" "}
                        {requestAnalytics.peakSpeed !== undefined
                          ? `${requestAnalytics.peakSpeed.toFixed(1)} tok/s`
                          : "—"}
                      </span>
                      <span>·</span>
                      <span>
                        均耗时 {formatDuration(requestAnalytics.avgDurationMs)}
                      </span>
                    </div>
                  </div>

                  <div className="usage-kpi-card">
                    <div className="usage-kpi-label">
                      <span>会话与运行总数</span>
                      <Calendar size={14} />
                    </div>
                    <div className="usage-kpi-value">
                      {data.totalSessions}{" "}
                      <span className="usage-kpi-unit">会话</span>
                    </div>
                    <div className="usage-kpi-sub">
                      <span>累计运行 {data.totalRuns} 次任务</span>
                      {requests.length > 0 && (
                        <>
                          <span>·</span>
                          <span>{requests.length} 请求</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="usage-kpi-card">
                    <div className="usage-kpi-label">
                      <span>主力模型</span>
                      <Cpu size={14} />
                    </div>
                    <div
                      className="usage-kpi-value usage-kpi-model-value"
                      title={data.models[0]?.model || "暂无模型"}
                    >
                      {data.models[0]?.model
                        ? shortModelName(data.models[0].model)
                        : "—"}
                    </div>
                    <div className="usage-kpi-sub">
                      <span>共 {data.models.length} 个使用中的模型</span>
                    </div>
                  </div>
                </div>

                {/* Row 1: Daily Trend Chart & Token Structure Donut Chart */}
                <div className="usage-charts-primary-grid">
                  {/* Daily Trend Section */}
                  <div className="usage-dashboard-section">
                    <div className="usage-section-header">
                      <div className="usage-section-title-group">
                        <span className="usage-section-title">
                          <Calendar size={15} />
                          每日 Token 消耗趋势
                        </span>
                        {data.daily.length > 0 && (
                          <span className="usage-section-subtitle-meta">
                            日均 {compactTokens(avgDailyTokens)} · 峰值{" "}
                            {peakDay
                              ? `${peakDay.date.slice(5)} (${compactTokens(peakDay.totalTokens)})`
                              : "—"}
                          </span>
                        )}
                      </div>

                      <div className="usage-section-header-right">
                        {(requests.length > 0 || costSummary.totalCostUsd !== undefined) && (
                          <div className="usage-mode-switch">
                            <button
                              type="button"
                              className={`usage-mode-btn ${dailyChartMode === "tokens" ? "is-active" : ""}`}
                              aria-pressed={dailyChartMode === "tokens"}
                              onClick={() => setDailyChartMode("tokens")}
                            >
                              Token 构成
                            </button>
                            <button
                              type="button"
                              className={`usage-mode-btn ${dailyChartMode === "cost" ? "is-active" : ""}`}
                              aria-pressed={dailyChartMode === "cost"}
                              onClick={() => setDailyChartMode("cost")}
                            >
                              费用与请求
                            </button>
                          </div>
                        )}
                        {dailyChartMode === "tokens" ? (
                          <div className="usage-chart-legend">
                            <span
                              className="usage-legend-item"
                              title="模型生成输出 Tokens"
                            >
                              <span className="usage-legend-dot usage-legend-completion" />
                              <span>输出</span>
                            </span>
                            <span
                              className="usage-legend-item"
                              title="命中的 Prompt 缓存 Tokens"
                            >
                              <span className="usage-legend-dot usage-legend-cached" />
                              <span>缓存</span>
                            </span>
                            <span
                              className="usage-legend-item"
                              title="未命中缓存的普通输入 Tokens"
                            >
                              <span className="usage-legend-dot usage-legend-uncached" />
                              <span>输入</span>
                            </span>
                          </div>
                        ) : (
                          <div className="usage-chart-legend">
                            <span className="usage-legend-item">
                              <span className="usage-legend-dot usage-legend-cost" />
                              <span>预估费用 (USD)</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {data.daily.length === 0 ? (
                      <div className="usage-empty-state">
                        <p>当前时间段无每日消耗记录</p>
                      </div>
                    ) : (
                      <div className="usage-daily-chart-container">
                        <div className="usage-chart-yaxis" aria-hidden="true">
                          <span>
                            {dailyChartMode === "tokens"
                              ? compactTokens(maxDailyTokens)
                              : formatCostUsd(maxDailyCost)}
                          </span>
                          <span>
                            {dailyChartMode === "tokens"
                              ? compactTokens(Math.round(maxDailyTokens / 2))
                              : formatCostUsd(maxDailyCost / 2)}
                          </span>
                          <span>0</span>
                        </div>
                        <div
                          className="usage-daily-chart"
                          aria-label="每日消耗柱状图"
                        >
                          {data.daily.map((d) => {
                            const dayReq = requestAnalytics.dailyRequestMap.get(
                              d.date,
                            );
                            const dayCost = d.estimatedCostUsd ?? (dayReq?.pricedCount ? dayReq.costUsd : undefined);
                            const dayReqCount = dayReq?.count ?? d.runCount;

                            if (dailyChartMode === "cost") {
                              const costHeight = Math.max(
                                ((dayCost ?? 0) / maxDailyCost) * 100,
                                (dayCost ?? 0) > 0 ? 6 : 2,
                              );
                              const costTooltip =
                                `${d.date}：预估 ${formatCostUsd(dayCost)}${d.costIncomplete ? "（部分）" : ""}\n` +
                                `• 运行数：${d.runCount} 次；请求明细：${dayReq?.count ?? 0} 次\n` +
                                `• 总计 Tokens：${compactTokens(d.totalTokens)}` +
                                (d.aggregateEstimatedCostUsd !== undefined ? `\n• ${aggregateCostExplanation}` : "");
                              return (
                                <div key={d.date} className="usage-bar-col">
                                  <span className="usage-bar-top-val">
                                    {dayReqCount}次
                                  </span>
                                  <div
                                    className="usage-bar-stack"
                                    style={{ height: `${costHeight}%` }}
                                    title={costTooltip}
                                  >
                                    <div
                                      className="usage-bar-segment usage-bar-cost"
                                      style={{ height: "100%" }}
                                    />
                                  </div>
                                  <span className="usage-bar-date">
                                    {d.date.slice(5)}
                                  </span>
                                </div>
                              );
                            }

                            const heightPercent = Math.max(
                              (d.totalTokens / maxDailyTokens) * 100,
                              4,
                            );
                            const uncachedPrompt = Math.max(
                              d.promptTokens - d.cachedTokens,
                              0,
                            );
                            const cached = Math.min(
                              d.cachedTokens,
                              d.promptTokens,
                            );
                            const completion = d.completionTokens;
                            const dayTotal =
                              uncachedPrompt + cached + completion;

                            const completionPct =
                              dayTotal > 0 ? (completion / dayTotal) * 100 : 0;
                            const uncachedPct =
                              dayTotal > 0
                                ? (uncachedPrompt / dayTotal) * 100
                                : 0;
                            const cachedPct =
                              dayTotal > 0 ? (cached / dayTotal) * 100 : 0;

                            const tooltip =
                              `${d.date}：总计 ${compactTokens(d.totalTokens)} tokens（${d.runCount} 次运行）\n` +
                              `• 输出：${compactTokens(completion)}\n` +
                              `• 缓存读取：${compactTokens(cached)}\n` +
                              `• 未缓存输入：${compactTokens(uncachedPrompt)}`;

                            return (
                              <div key={d.date} className="usage-bar-col">
                                <span className="usage-bar-top-val">
                                  {compactTokens(d.totalTokens)}
                                </span>
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
                      </div>
                    )}
                  </div>

                  {/* Token Composition & Cache Efficiency Donut Card */}
                  <div className="usage-dashboard-section">
                    <div className="usage-section-header">
                      <span className="usage-section-title">
                        <Database size={15} />
                        Token 结构与缓存效率
                      </span>
                      <span className="usage-kpi-badge">
                        缓存率 {percent(data.averageCacheRate)}
                      </span>
                    </div>

                    {compositionTotal === 0 ? (
                      <div className="usage-empty-state">
                        <p>暂无 Token 构成数据</p>
                      </div>
                    ) : (
                      <div className="usage-donut-layout">
                        <div className="usage-donut-visual">
                          <svg
                            viewBox="0 0 140 140"
                            className="usage-donut-svg"
                            role="img"
                            aria-label={`Token 构成：输出 ${percent(completionRatio)}，缓存命中 ${percent(cachedRatio)}，未缓存输入 ${percent(uncachedRatio)}`}
                          >
                            <circle
                              cx="70"
                              cy="70"
                              r={donutRadius}
                              fill="none"
                              stroke="var(--surface-soft)"
                              strokeWidth="14"
                            />
                            {uncachedLen > 0 && (
                              <circle
                                cx="70"
                                cy="70"
                                r={donutRadius}
                                fill="none"
                                stroke="var(--chart-uncached)"
                                strokeWidth="14"
                                strokeDasharray={`${uncachedLen} ${donutCircumference}`}
                                strokeDashoffset={0}
                                transform="rotate(-90 70 70)"
                              />
                            )}
                            {cachedLen > 0 && (
                              <circle
                                cx="70"
                                cy="70"
                                r={donutRadius}
                                fill="none"
                                stroke="var(--chart-cached)"
                                strokeWidth="14"
                                strokeDasharray={`${cachedLen} ${donutCircumference}`}
                                strokeDashoffset={-uncachedLen}
                                transform="rotate(-90 70 70)"
                              />
                            )}
                            {completionLen > 0 && (
                              <circle
                                cx="70"
                                cy="70"
                                r={donutRadius}
                                fill="none"
                                stroke="var(--chart-completion)"
                                strokeWidth="14"
                                strokeDasharray={`${completionLen} ${donutCircumference}`}
                                strokeDashoffset={-(uncachedLen + cachedLen)}
                                transform="rotate(-90 70 70)"
                              />
                            )}
                          </svg>
                          <div className="usage-donut-center">
                            <span className="usage-donut-total">
                              {compactTokens(totalTokens)}
                            </span>
                            <span className="usage-donut-caption">
                              总 Tokens
                            </span>
                          </div>
                        </div>

                        <div className="usage-donut-breakdown">
                          <div className="usage-donut-row">
                            <div className="usage-donut-row-label">
                              <span className="usage-legend-dot usage-legend-cached" />
                              <span>缓存命中输入</span>
                            </div>
                            <div className="usage-donut-row-metrics">
                              <strong>
                                {compactTokens(totalCachedTokens)}
                              </strong>
                              <span>{percent(cachedRatio)}</span>
                            </div>
                          </div>

                          <div className="usage-donut-row">
                            <div className="usage-donut-row-label">
                              <span className="usage-legend-dot usage-legend-uncached" />
                              <span>未缓存新增输入</span>
                            </div>
                            <div className="usage-donut-row-metrics">
                              <strong>
                                {compactTokens(totalUncachedTokens)}
                              </strong>
                              <span>{percent(uncachedRatio)}</span>
                            </div>
                          </div>

                          <div className="usage-donut-row">
                            <div className="usage-donut-row-label">
                              <span className="usage-legend-dot usage-legend-completion" />
                              <span>模型生成输出</span>
                            </div>
                            <div className="usage-donut-row-metrics">
                              <strong>
                                {compactTokens(totalCompletionTokens)}
                              </strong>
                              <span>{percent(completionRatio)}</span>
                            </div>
                          </div>

                          <div className="usage-donut-summary-bar">
                            <span>
                              读写比{" "}
                              <strong>
                                {totalCompletionTokens > 0
                                  ? `${(totalPromptTokens / totalCompletionTokens).toFixed(1)} : 1`
                                  : "—"}
                              </strong>
                            </span>
                            <span>
                              输入缓存覆盖{" "}
                              <strong>{percent(data.averageCacheRate)}</strong>
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 2: Model Breakdown & Speed/Latency + Hourly Activity */}
                <div className="usage-charts-split">
                  {/* Model Breakdown with Segmented Bars & Cache Efficiency */}
                  <div className="usage-dashboard-section">
                    <div className="usage-section-header">
                      <span className="usage-section-title">
                        <Cpu size={15} />
                        模型消耗分布
                      </span>
                      <span className="usage-kpi-badge">
                        {data.models.length} 个模型
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
                          const modelCacheRate =
                            m.promptTokens > 0
                              ? Math.min(1, m.cachedTokens / m.promptTokens)
                              : 0;
                          const mUncached = Math.max(
                            m.promptTokens - m.cachedTokens,
                            0,
                          );
                          const mCached = Math.min(
                            m.cachedTokens,
                            m.promptTokens,
                          );
                          const mComp = m.completionTokens;
                          const mTotal = Math.max(
                            mUncached + mCached + mComp,
                            1,
                          );
                          const aggregateCostLabel = m.aggregateEstimatedCostUsd === undefined
                            ? ""
                            : ((m.pricedRequestCount ?? 0) > 0 ? "（含历史估算）" : "（汇总估算）");
                          const pricedCostTitle = [
                            "按当前公开价格估算（USD）",
                            (m.requestCount ?? 0) > 0 && `已计价 ${m.pricedRequestCount ?? 0} / ${m.requestCount} 次请求`,
                            m.aggregateEstimatedCostUsd !== undefined &&
                              `其中历史汇总 ${formatCostUsd(m.aggregateEstimatedCostUsd)}：${aggregateCostExplanation}`,
                            m.costIncomplete && "不含缺少价格或用量的记录",
                          ].filter(Boolean).join("；");

                          return (
                            <div key={m.model} className="usage-model-item">
                              <div className="usage-model-info">
                                <span
                                  className="usage-model-name"
                                  title={m.model}
                                >
                                  {m.model}
                                </span>
                                <span className="usage-model-tokens">
                                  {compactTokens(m.totalTokens)} (
                                  {share.toFixed(1)}%)
                                </span>
                              </div>
                              <div
                                className="usage-model-bar-track"
                                title={`输入 ${compactTokens(m.promptTokens)}（缓存 ${compactTokens(mCached)}）· 输出 ${compactTokens(mComp)}`}
                              >
                                <div
                                  className="usage-model-bar-fill"
                                  style={{ width: `${Math.max(share, 2)}%` }}
                                >
                                  <span
                                    className="usage-model-seg usage-bar-cached"
                                    style={{
                                      width: `${(mCached / mTotal) * 100}%`,
                                    }}
                                  />
                                  <span
                                    className="usage-model-seg usage-bar-uncached"
                                    style={{
                                      width: `${(mUncached / mTotal) * 100}%`,
                                    }}
                                  />
                                  <span
                                    className="usage-model-seg usage-bar-completion"
                                    style={{
                                      width: `${(mComp / mTotal) * 100}%`,
                                    }}
                                  />
                                </div>
                              </div>
                              <div className="usage-model-meta-row">
                                <span>缓存命中 {percent(modelCacheRate)}</span>
                                <span>·</span>
                                <span>
                                  入 {compactTokens(m.promptTokens)} / 出{" "}
                                  {compactTokens(m.completionTokens)}
                                </span>
                                <span>·</span>
                                <span>{m.runCount} 次运行</span>
                                {(m.requestCount ?? 0) > 0 && (
                                  <span>· {m.requestCount} 次请求</span>
                                )}
                                <span>·</span>
                                <span
                                  className="usage-model-cost-tag"
                                  title={m.estimatedCostUsd === undefined
                                    ? (data.pricing?.state === "unavailable"
                                      ? "公开价格目录加载失败，点击刷新重试"
                                      : "未匹配到公开价格或缺少用量，费用未知，不代表免费")
                                    : pricedCostTitle}
                                >
                                  {m.estimatedCostUsd === undefined
                                    ? (data.pricing?.state === "unavailable" ? "价格未加载" : "费用未知")
                                    : `预估 ${formatCostUsd(m.estimatedCostUsd)}${aggregateCostLabel}${m.costIncomplete ? "（部分）" : ""}`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Model Throughput (tok/s) & Latency Comparison */}
                  <div className="usage-dashboard-section">
                    <div className="usage-section-header">
                      <span className="usage-section-title">
                        <Lightning size={15} />
                        模型速度与耗时对比
                      </span>
                      <span className="usage-kpi-badge">
                        {requestAnalytics.modelPerfList.length} 个模型
                      </span>
                    </div>

                    {requestAnalytics.modelPerfList.length === 0 ? (
                      <div className="usage-empty-state">
                        <p>暂无请求级速度与耗时记录</p>
                      </div>
                    ) : (
                      <div className="usage-speed-list">
                        {requestAnalytics.modelPerfList.map((perf) => {
                          const avgSpd = perf.avgSpeed ?? 0;
                          const peakSpd = perf.peakSpeed ?? 0;
                          const avgWidth =
                            avgSpd > 0
                              ? Math.max(
                                  (avgSpd / requestAnalytics.maxModelSpeed) *
                                    100,
                                  4,
                                )
                              : 0;
                          const peakWidth =
                            peakSpd > 0
                              ? Math.max(
                                  (peakSpd / requestAnalytics.maxModelSpeed) *
                                    100,
                                  4,
                                )
                              : 0;
                          const durWidth =
                            perf.avgDurationMs !== undefined &&
                            perf.avgDurationMs > 0
                              ? Math.max(
                                  (perf.avgDurationMs /
                                    requestAnalytics.maxModelDuration) *
                                    100,
                                  4,
                                )
                              : 0;

                          return (
                            <div key={perf.model} className="usage-speed-item">
                              <div className="usage-speed-header">
                                <span
                                  className="usage-model-name"
                                  title={perf.model}
                                >
                                  {shortModelName(perf.model)}
                                </span>
                                <div className="usage-speed-badges">
                                  <span className="usage-mono">
                                    均值{" "}
                                    <strong>
                                      {perf.avgSpeed !== undefined
                                        ? `${perf.avgSpeed.toFixed(1)} tok/s`
                                        : "—"}
                                    </strong>
                                  </span>
                                  <span className="usage-mono usage-muted-inline">
                                    耗时 {formatDuration(perf.avgDurationMs)}
                                  </span>
                                  {perf.totalCostUsd !== undefined && (
                                    <span className="usage-mono usage-cost-pill">
                                      {formatCostUsd(perf.totalCostUsd)}
                                      {perf.pricedCount < perf.requestCount ? "（部分）" : ""}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="usage-dual-bars">
                                <div className="usage-bar-metric-row">
                                  <span className="usage-bar-metric-label">
                                    速度
                                  </span>
                                  <div className="usage-speed-bar-track">
                                    {peakWidth > avgWidth && (
                                      <div
                                        className="usage-speed-bar-peak"
                                        style={{ width: `${peakWidth}%` }}
                                        title={`峰值速度 ${peakSpd.toFixed(1)} tok/s`}
                                      />
                                    )}
                                    <div
                                      className="usage-speed-bar-avg"
                                      style={{ width: `${avgWidth}%` }}
                                      title={`平均速度 ${avgSpd.toFixed(1)} tok/s`}
                                    />
                                  </div>
                                </div>

                                <div className="usage-bar-metric-row">
                                  <span className="usage-bar-metric-label">
                                    耗时
                                  </span>
                                  <div className="usage-speed-bar-track">
                                    <div
                                      className="usage-latency-bar-fill"
                                      style={{ width: `${durWidth}%` }}
                                      title={`平均耗时 ${formatDuration(perf.avgDurationMs)}`}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 3: 24-Hour Request Activity & Status Distribution */}
                {requests.length > 0 && (
                  <div className="usage-dashboard-section">
                    <div className="usage-section-header">
                      <div className="usage-section-title-group">
                        <span className="usage-section-title">
                          <ChartBar size={15} />
                          请求活跃时段与状态分布 (24h)
                        </span>
                        <span className="usage-section-subtitle-meta">
                          高峰时段{" "}
                          {requestAnalytics.peakHour.total > 0
                            ? `${String(requestAnalytics.peakHour.hour).padStart(2, "0")}:00 (${requestAnalytics.peakHour.total} 次)`
                            : "—"}
                          {requestAnalytics.successRate !== undefined &&
                            ` · 成功率 ${percent(requestAnalytics.successRate)}`}
                          {requestAnalytics.retries > 0 &&
                            ` · 重试 ${requestAnalytics.retries} 次`}
                        </span>
                      </div>

                      <div className="usage-chart-legend">
                        <span className="usage-legend-item">
                          <span className="usage-legend-dot usage-legend-cached" />
                          <span>成功 ({requestAnalytics.succeeded})</span>
                        </span>
                        <span className="usage-legend-item">
                          <span className="usage-legend-dot usage-legend-failed" />
                          <span>失败 ({requestAnalytics.failed})</span>
                        </span>
                        {requestAnalytics.started > 0 && (
                          <span className="usage-legend-item">
                            <span className="usage-legend-dot usage-legend-uncached" />
                            <span>进行中 ({requestAnalytics.started})</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      className="usage-hourly-chart"
                      aria-label="24小时请求活跃分布"
                    >
                      {requestAnalytics.hourly.map((slot) => {
                        const heightPct =
                          slot.total > 0
                            ? Math.max(
                                (slot.total / requestAnalytics.maxHourlyCount) *
                                  100,
                                8,
                              )
                            : 0;
                        const sucPct =
                          slot.total > 0
                            ? (slot.succeeded / slot.total) * 100
                            : 0;
                        const failPct =
                          slot.total > 0 ? (slot.failed / slot.total) * 100 : 0;
                        const startPct =
                          slot.total > 0
                            ? (slot.started / slot.total) * 100
                            : 0;

                        return (
                          <div
                            key={slot.hour}
                            className="usage-hourly-col"
                            title={`${String(slot.hour).padStart(2, "0")}:00 - ${String(slot.hour).padStart(2, "0")}:59\n请求 ${slot.total} 次（成功 ${slot.succeeded} / 失败 ${slot.failed}）\n消耗 ${compactTokens(slot.tokens)} tokens`}
                          >
                            <div className="usage-hourly-bar-area">
                              {slot.total > 0 && (
                                <div
                                  className="usage-hourly-stack"
                                  style={{ height: `${heightPct}%` }}
                                >
                                  {failPct > 0 && (
                                    <div
                                      className="usage-bar-segment usage-bar-failed"
                                      style={{ height: `${failPct}%` }}
                                    />
                                  )}
                                  {startPct > 0 && (
                                    <div
                                      className="usage-bar-segment usage-bar-uncached"
                                      style={{ height: `${startPct}%` }}
                                    />
                                  )}
                                  {sucPct > 0 && (
                                    <div
                                      className="usage-bar-segment usage-bar-cached"
                                      style={{ height: `${sucPct}%` }}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                            <span className="usage-hourly-label">
                              {slot.hour % 3 === 0
                                ? `${String(slot.hour).padStart(2, "0")}时`
                                : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Top Sessions Table */}
                <div className="usage-dashboard-section">
                  <div className="usage-section-header">
                    <span className="usage-section-title">
                      <Lightning size={15} />
                      消耗排名前列的会话
                    </span>
                    <span className="usage-kpi-badge">
                      Top {data.topSessions.length}
                    </span>
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
                            const tokenShare =
                              maxSessionTokens > 0
                                ? Math.max(
                                    (session.totalTokens / maxSessionTokens) *
                                      100,
                                    3,
                                  )
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
                                  {session.workspace
                                    .replace(/[\\/]+$/, "")
                                    .split(/[\\/]/)
                                    .pop()}
                                </td>
                                <td className="usage-mono">{session.model}</td>
                                <td className="usage-mono">
                                  {compactTokens(session.promptTokens)} /{" "}
                                  {compactTokens(session.completionTokens)}
                                </td>
                                <td className="usage-mono">
                                  {percent(cacheRate)}
                                </td>
                                <td className="usage-mono usage-table-strong-cell">
                                  <div className="usage-inline-bar-cell">
                                    <span>
                                      {compactTokens(session.totalTokens)}
                                    </span>
                                    <span
                                      className="usage-inline-mini-track"
                                      aria-hidden="true"
                                    >
                                      <span
                                        className="usage-inline-mini-fill"
                                        style={{ width: `${tokenShare}%` }}
                                      />
                                    </span>
                                  </div>
                                </td>
                                <td className="usage-mono usage-table-muted-cell">
                                  {session.updatedAt
                                    .slice(0, 16)
                                    .replace("T", " ")}
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
                              <td className="usage-mono usage-table-strong-cell">
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
    </div>
  );
}
