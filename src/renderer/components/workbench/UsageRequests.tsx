import { Fragment, useState } from "react";
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

  if (requests.length === 0) {
    return <div className="usage-empty-state">暂无请求记录</div>;
  }

  return (
    <section className="usage-dashboard-section usage-requests">
      <div className="usage-section-header">
        <span className="usage-kpi-badge">{requests.length} 条</span>
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
            <span>{currentPage + 1} / {pageCount}</span>
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
      <div className="usage-table-wrapper" tabIndex={0} aria-label="请求记录表格">
        <table className="usage-table usage-request-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>来源 / 模型</th>
              <th>凭据</th>
              <th>状态</th>
              <th>输入 / 输出</th>
              <th>缓存</th>
              <th>总 Tokens</th>
              <th>耗时</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(request => {
              const source = state.settings?.providerSources?.find(
                item => item.id === request.sourceId,
              );
              const credential = source?.credentials?.find(
                item => item.id === request.credentialId,
              );
              const group = state.settings?.routeGroups?.find(
                item => item.id === request.groupId,
              );
              const isExpanded = expanded === request.id;
              const detailId = `usage-request-${request.id}`;
              return (
                <Fragment key={request.id}>
                  <tr className="usage-request-row">
                    <td className="usage-mono">
                      <time dateTime={request.timestamp} title={request.timestamp}>
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
                    <td title={request.credentialId}>
                      {credential?.label || request.credentialId || "默认凭据"}
                    </td>
                    <td>
                      <span className={`usage-request-status is-${request.outcome}`}>
                        {outcome(request)}
                      </span>
                      {request.errorCode && (
                        <span className="usage-request-secondary usage-mono">
                          {request.errorCode}
                        </span>
                      )}
                    </td>
                    <td className="usage-mono">
                      {tokens(request.usage?.promptTokens)} / {tokens(request.usage?.completionTokens)}
                    </td>
                    <td className="usage-mono">{tokens(request.usage?.cachedPromptTokens)}</td>
                    <td className="usage-mono">{tokens(request.usage?.totalTokens)}</td>
                    <td className="usage-mono">{duration(request.durationMs)}</td>
                    <td>
                      <button
                        type="button"
                        className="usage-dashboard-btn"
                        aria-expanded={isExpanded}
                        aria-controls={detailId}
                        onClick={() => setExpanded(isExpanded ? null : request.id)}
                      >
                        {isExpanded ? "收起" : "详情"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr id={detailId} className="usage-request-detail-row">
                      <td colSpan={9}>
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
                          <div><dt>工作区</dt><dd>{request.workspace}</dd></div>
                          <div><dt>来源 ID</dt><dd>{request.sourceId}</dd></div>
                          <div><dt>凭据 ID</dt><dd>{request.credentialId ?? "—"}</dd></div>
                          <div>
                            <dt>路由组</dt>
                            <dd>{group ? `${group.label} (${group.id})` : request.groupId ?? "—"}</dd>
                          </div>
                          <div><dt>协议</dt><dd>{request.apiMode}</dd></div>
                          <div><dt>选择原因</dt><dd>{request.reason}</dd></div>
                          <div><dt>尝试序号</dt><dd>{request.attempt}</dd></div>
                          <div>
                            <dt>轮次 / 步骤</dt>
                            <dd>{request.turn ?? "—"} / {request.step ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>开始时间</dt>
                            <dd>{request.startedAt ? formatTime(request.startedAt) : "—"}</dd>
                          </div>
                          <div>
                            <dt>结束时间</dt>
                            <dd>{request.finishedAt ? formatTime(request.finishedAt) : "—"}</dd>
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
  );
}
