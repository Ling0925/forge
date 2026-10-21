import { Fragment, useMemo, useState } from "react";
import type { UsageRequest } from "../../shared-types";
import { useWorkbench } from "../../state/workbench-context";

const pageSize = 50;

const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { hour12: false })
    : value;
};
const tokens = (value: number | undefined) =>
  value === undefined ? "—" : value.toLocaleString();
const duration = (value: number | undefined) => {
  if (value === undefined) return "—";
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
};
const tokenSpeed = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} tok/s`;
};
const costUsd = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value >= 0.0001) return `$${value.toFixed(4)}`;
  return "<$0.0001";
};
const reasoningEffort = (value: UsageRequest["reasoningEffort"]) =>
  value === "default" ? "模型默认" : value === "max" ? "MAX" : value ?? "—";
const outcome = (request: UsageRequest) => {
  if (request.outcome === "started") return "请求中";
  if (request.outcome === "succeeded") return "成功";
  if (request.outcome === "failed") {
    return request.errorCode === "cancelled" ? "已取消" : "失败";
  }
  return "未知";
};

export function UsageRequests({
  requests,
}: {
  readonly requests: readonly UsageRequest[];
}) {
  const { state, openUsageDashboard, selectSession } = useWorkbench();
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(requests.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = requests.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  const summary = useMemo(() => {
    let succeeded = 0;
    let failed = 0;
    let started = 0;
    let unknown = 0;
    let costSum = 0;
    let pricedCount = 0;
    let speedSum = 0;
    let speedCount = 0;
    let peakSpeed = 0;
    let durationSum = 0;
    let durationCount = 0;

    for (const r of requests) {
      if (r.outcome === "succeeded") succeeded += 1;
      else if (r.outcome === "failed") failed += 1;
      else if (r.outcome === "started") started += 1;
      else unknown += 1;

      if (
        typeof r.estimatedCostUsd === "number" &&
        Number.isFinite(r.estimatedCostUsd)
      ) {
        costSum += r.estimatedCostUsd;
        pricedCount += 1;
      }
      if (
        typeof r.tokensPerSecond === "number" &&
        Number.isFinite(r.tokensPerSecond) &&
        r.tokensPerSecond > 0
      ) {
        speedSum += r.tokensPerSecond;
        speedCount += 1;
        if (r.tokensPerSecond > peakSpeed) peakSpeed = r.tokensPerSecond;
      }
      if (
        typeof r.durationMs === "number" &&
        Number.isFinite(r.durationMs) &&
        r.durationMs >= 0
      ) {
        durationSum += r.durationMs;
        durationCount += 1;
      }
    }

    // Recent 36 requests in chronological order for impulse chart
    const recentSlice = [...requests.slice(0, 36)].reverse();
    const maxRecentDuration = Math.max(
      ...recentSlice.map((r) => r.durationMs ?? 0),
      1,
    );
    const maxRecentSpeed = Math.max(
      ...recentSlice.map((r) => r.tokensPerSecond ?? 0),
      1,
    );

    return {
      succeeded,
      failed,
      started,
      unknown,
      totalCost: pricedCount > 0 ? costSum : undefined,
      pricedCount,
      avgSpeed: speedCount > 0 ? speedSum / speedCount : undefined,
      peakSpeed: speedCount > 0 ? peakSpeed : undefined,
      avgDuration: durationCount > 0 ? durationSum / durationCount : undefined,
      recentSlice,
      maxRecentDuration,
      maxRecentSpeed,
    };
  }, [requests]);

  if (requests.length === 0) {
    return <div className="usage-empty-state">暂无请求记录</div>;
  }

  const totalCount = requests.length;
  const sucPct = (summary.succeeded / totalCount) * 100;
  const failPct = (summary.failed / totalCount) * 100;
  const startPct = (summary.started / totalCount) * 100;

  return (
    <div className="usage-requests-layout">
      {/* Request Analytics Strip */}
      <div className="usage-requests-analytics" aria-label="请求记录概览图表">
        <div className="usage-req-stat-card">
          <div className="usage-req-stat-head">
            <span>请求状态分布</span>
            <strong>{requests.length} 次</strong>
          </div>
          <div className="usage-req-status-bar" aria-hidden="true">
            {sucPct > 0 && (
              <span
                className="usage-bar-cached"
                style={{ width: `${sucPct}%` }}
              />
            )}
            {failPct > 0 && (
              <span
                className="usage-bar-failed"
                style={{ width: `${failPct}%` }}
              />
            )}
            {startPct > 0 && (
              <span
                className="usage-bar-uncached"
                style={{ width: `${startPct}%` }}
              />
            )}
          </div>
          <div className="usage-req-stat-sub">
            <span>成功 {summary.succeeded}</span>
            <span>·</span>
            <span>失败 {summary.failed}</span>
            {summary.started > 0 && (
              <>
                <span>·</span>
                <span>进行中 {summary.started}</span>
              </>
            )}
          </div>
        </div>

        <div className="usage-req-stat-card">
          <div className="usage-req-stat-head">
            <span>吞吐速度与响应耗时</span>
            <strong>
              {summary.avgSpeed !== undefined
                ? `${summary.avgSpeed.toFixed(1)} tok/s`
                : "—"}
            </strong>
          </div>
          <div className="usage-req-stat-sub">
            <span>
              峰值{" "}
              {summary.peakSpeed !== undefined
                ? `${summary.peakSpeed.toFixed(1)} tok/s`
                : "—"}
            </span>
            <span>·</span>
            <span>平均耗时 {duration(summary.avgDuration)}</span>
          </div>
          <div className="usage-req-stat-sub">
            <span>预估累计费用 {costUsd(summary.totalCost)}</span>
            {summary.pricedCount > 0 && (
              <>
                <span>·</span>
                <span>已计价 {summary.pricedCount} 条</span>
              </>
            )}
          </div>
        </div>

        <div className="usage-req-stat-card usage-req-spark-card">
          <div className="usage-req-stat-head">
            <span>近期单次请求耗时与状态序列</span>
            <span className="usage-mono">
              最近 {summary.recentSlice.length} 次
            </span>
          </div>
          <div className="usage-req-impulse-chart" aria-hidden="true">
            {summary.recentSlice.map((req) => {
              const dur = req.durationMs ?? 0;
              const spd = req.tokensPerSecond ?? 0;
              const hPct =
                dur > 0
                  ? Math.max((dur / summary.maxRecentDuration) * 100, 14)
                  : spd > 0
                    ? Math.max((spd / summary.maxRecentSpeed) * 100, 14)
                    : 18;
              return (
                <span
                  key={req.id}
                  className={`usage-req-impulse-bar is-${req.outcome}`}
                  style={{ height: `${hPct}%` }}
                  title={`${req.model} · ${outcome(req)} · 耗时 ${duration(req.durationMs)} · 速度 ${tokenSpeed(req.tokensPerSecond)}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Request Table Section */}
      <section className="usage-dashboard-section usage-requests">
        <div className="usage-section-header">
          <div className="usage-section-title-group">
            <span className="usage-section-title">请求明细记录</span>
            <span className="usage-kpi-badge">{requests.length} 条</span>
          </div>
          {pageCount > 1 && (
            <nav className="usage-request-pagination" aria-label="请求记录分页">
              <button
                type="button"
                className="usage-dashboard-btn"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <span>
                {currentPage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="usage-dashboard-btn"
                disabled={currentPage + 1 === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </nav>
          )}
        </div>
        <div className="usage-table-wrapper" aria-label="请求记录表格">
          <table className="usage-table usage-request-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>来源 / 模型</th>
                <th>思考等级</th>
                <th>凭据</th>
                <th>状态</th>
                <th>输入 / 输出</th>
                <th>总 Tokens</th>
                <th>耗时</th>
                <th>Token 速度</th>
                <th>预估费用 (USD)</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((request) => {
                const source = state.settings?.providerSources?.find(
                  (item) => item.id === request.sourceId,
                );
                const credential = source?.credentials?.find(
                  (item) => item.id === request.credentialId,
                );
                const group = state.settings?.routeGroups?.find(
                  (item) => item.id === request.groupId,
                );
                const isExpanded = expanded === request.id;
                const detailId = `usage-request-${request.id}`;
                return (
                  <Fragment key={request.id}>
                    <tr className="usage-request-row">
                      <td className="usage-mono">
                        <time
                          dateTime={request.timestamp}
                          title={request.timestamp}
                        >
                          {formatTime(request.timestamp)}
                        </time>
                      </td>
                      <td>
                        <span title={request.sourceId}>
                          {source?.label || request.sourceId}
                        </span>
                        <span className="usage-request-secondary usage-mono">
                          {request.model}
                        </span>
                      </td>
                      <td
                        className="usage-mono usage-request-reasoning"
                        title={request.reasoningEffort === undefined
                          ? "此请求未记录思考等级"
                          : "请求时配置的思考等级；供应商可能映射或忽略此设置"}
                      >
                        {reasoningEffort(request.reasoningEffort)}
                      </td>
                      <td title={request.credentialId}>
                        {credential?.label ||
                          request.credentialId ||
                          "默认凭据"}
                      </td>
                      <td>
                        <span
                          className={`usage-request-status is-${request.outcome}`}
                        >
                          {outcome(request)}
                        </span>
                        {request.errorCode && (
                          <span className="usage-request-secondary usage-mono">
                            {request.errorCode}
                          </span>
                        )}
                      </td>
                      <td className="usage-mono usage-request-tokens">
                        <span>
                          {tokens(request.usage?.promptTokens)} /{" "}
                          {tokens(request.usage?.completionTokens)}
                        </span>
                        <span className="usage-request-secondary usage-request-cache">
                          缓存 {tokens(request.usage?.cachedPromptTokens)}
                        </span>
                      </td>
                      <td className="usage-mono">
                        {tokens(request.usage?.totalTokens)}
                      </td>
                      <td className="usage-mono">
                        {duration(request.durationMs)}
                      </td>
                      <td className="usage-mono">
                        {tokenSpeed(request.tokensPerSecond)}
                      </td>
                      <td className="usage-mono">
                        {costUsd(request.estimatedCostUsd)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="usage-dashboard-btn"
                          aria-expanded={isExpanded}
                          aria-controls={detailId}
                          onClick={() =>
                            setExpanded(isExpanded ? null : request.id)
                          }
                        >
                          {isExpanded ? "收起" : "详情"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr id={detailId} className="usage-request-detail-row">
                        <td colSpan={11}>
                          <dl className="usage-request-details">
                            <div>
                              <dt>会话</dt>
                              <dd>
                                <button
                                  type="button"
                                  className="usage-session-link"
                                  onClick={() => {
                                    openUsageDashboard(false);
                                    void selectSession(request.sessionId);
                                  }}
                                >
                                  {request.sessionTitle || "未命名会话"}
                                </button>
                              </dd>
                            </div>
                            <div>
                              <dt>工作区</dt>
                              <dd>{request.workspace}</dd>
                            </div>
                            <div>
                              <dt>来源 ID</dt>
                              <dd>{request.sourceId}</dd>
                            </div>
                            <div>
                              <dt>凭据 ID</dt>
                              <dd>{request.credentialId ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>路由组</dt>
                              <dd>
                                {group
                                  ? `${group.label} (${group.id})`
                                  : (request.groupId ?? "—")}
                              </dd>
                            </div>
                            <div>
                              <dt>协议</dt>
                              <dd>{request.apiMode}</dd>
                            </div>
                            <div>
                              <dt>思考等级</dt>
                              <dd>{reasoningEffort(request.reasoningEffort)}</dd>
                            </div>
                            <div>
                              <dt>选择原因</dt>
                              <dd>{request.reason}</dd>
                            </div>
                            <div>
                              <dt>尝试序号</dt>
                              <dd>{request.attempt}</dd>
                            </div>
                            <div>
                              <dt>轮次 / 步骤</dt>
                              <dd>
                                {request.turn ?? "—"} / {request.step ?? "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>开始时间</dt>
                              <dd>
                                {request.startedAt
                                  ? formatTime(request.startedAt)
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>结束时间</dt>
                              <dd>
                                {request.finishedAt
                                  ? formatTime(request.finishedAt)
                                  : "—"}
                              </dd>
                            </div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
