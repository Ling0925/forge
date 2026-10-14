import { useState } from "react";
import type { SessionId, SessionSummary } from "../../shared-types";
import { Button } from "../primitives/Button";
import { StatusBadge } from "../primitives/StatusBadge";

const pageSize = 5;

export function ChangeSessionNavigation({
  sessionId,
  parentSessionId,
  sessions,
  onOpenChanges,
}: {
  readonly sessionId: SessionId;
  readonly parentSessionId?: SessionId | undefined;
  readonly sessions: readonly SessionSummary[];
  readonly onOpenChanges: (id: SessionId) => void;
}) {
  const [page, setPage] = useState(0);
  const children = sessions.filter(
    (session) => session.parentSessionId === sessionId,
  );
  const lastPage = Math.max(0, Math.ceil(children.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = children.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  return (
    <section className="wb-stack" aria-label="关联会话的变更导航">
      <h3>本会话变更与检查点</h3>
      <p className="wb-muted">
        当前会话：<code>{sessionId}</code>
      </p>
      {parentSessionId && (
        <div className="wb-stack">
          <p className="wb-muted">
            父任务：<code>{parentSessionId}</code>
          </p>
          <Button size="sm" onClick={() => onOpenChanges(parentSessionId)}>
            返回父任务的变更 / 检查点
          </Button>
        </div>
      )}
      {children.length > 0 && (
        <>
          <h4>子任务会话（{children.length}）</h4>
          <p className="wb-muted">
            委派子任务的文件变更与检查点保存在各自会话中，不合并到父任务。以下仅为已保存会话导航，不表示每个子任务都有文件变更；打开后查看其真实记录。
          </p>
          {visible.map((child) => (
            <article
              key={child.id}
              className="agent-card wb-stack child-session-card wb-child-row"
            >
              <strong
                className="child-title-clamp"
                title={child.title}
                aria-label={child.title}
              >
                {child.title}
              </strong>
              <details>
                <summary>查看完整子任务标题</summary>
                <p className="message-body">{child.title}</p>
              </details>
              <StatusBadge status={child.status} />
              {/* Repeated raw identifiers collapse into one quiet disclosure;
                  nothing is dropped, only deferred. */}
              <details className="wb-disclosure">
                <summary>会话元数据</summary>
                <div className="wb-disclosure-body">
                  <p className="message-body">
                    模型：<code>{child.model}</code>
                  </p>
                  <p className="message-body wb-muted">
                    子会话：<code>{child.id}</code>
                    {child.archived ? " · 已归档" : ""}
                  </p>
                </div>
              </details>
              <Button size="sm" onClick={() => onOpenChanges(child.id)}>
                打开此子任务的变更 / 检查点
              </Button>
            </article>
          ))}
          {lastPage > 0 && (
            <div className="wb-row">
              <Button
                size="sm"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页子任务
              </Button>
              <span className="wb-muted" aria-live="polite">
                {currentPage + 1} / {lastPage + 1}
              </span>
              <Button
                size="sm"
                disabled={currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页子任务
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
