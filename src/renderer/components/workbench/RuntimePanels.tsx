import { useEffect, useRef, useState } from "react";
import { OperationScope } from "../../state/operation-scope";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Markdown } from "./Markdown";

export function RuntimePanels() {
  const { state, selectSession, refreshActiveSession } = useWorkbench();
  const snapshot = state.activeSnapshot;
  const scope = useRef(new OperationScope());
  const cancelScope = useRef(new OperationScope());
  useEffect(() => {
    scope.current = new OperationScope();
    cancelScope.current = new OperationScope();
    return () => {
      scope.current.close();
      cancelScope.current.close();
    };
  }, []);
  const [diagnostics, setDiagnostics] = useState<Awaited<
    ReturnType<Window["forge"]["getDiagnostics"]>
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [controlMessage, setControlMessage] = useState("");
  const cancelOwned = async (id: NonNullable<typeof state.activeSessionId>) => {
    const valid = cancelScope.current.begin();
    setCancelling(true);
    setError("");
    try {
      const cancelled = await window.forge.cancelSession(id);
      if (!valid()) return;
      setControlMessage(
        cancelled ? "已取消本进程拥有的操作" : "本进程没有可取消的操作",
      );
      await refreshActiveSession();
    } catch (err) {
      if (valid()) setError(err instanceof Error ? err.message : "取消失败");
    } finally {
      if (valid()) setCancelling(false);
    }
  };
  useEffect(() => {
    let alive = true;
    setDiagnostics(null);
    if (snapshot)
      void window.forge
        .getDiagnostics(snapshot.id)
        .then((value) => {
          if (alive) setDiagnostics(value);
        })
        .catch((err) => {
          if (alive)
            setError(err instanceof Error ? err.message : "上下文统计读取失败");
        });
    return () => {
      alive = false;
    };
  }, [snapshot]);
  if (!snapshot) return null;
  const parentId = snapshot.parentSessionId;
  const children = state.sessions.filter(
    (session) => session.parentSessionId === snapshot.id,
  );
  const updates = snapshot.events.filter(
    (event) => event.type === "agent_update",
  );
  const run = state.activeRuns[snapshot.id];
  const running =
    run?.status === "running" ||
    run?.status === "awaiting_approval" ||
    snapshot.status === "running" ||
    snapshot.status === "awaiting_approval";
  return (
    <>
      {/* Active children stay visible by default: this is live delegation
          state, not raw metadata. */}
      <section className="wb-stack">
        <h3>子代理</h3>
        {parentId && (
          <Button size="sm" onClick={() => void selectSession(parentId)}>
            打开父任务
          </Button>
        )}
        {children.length ? (
          [...children]
            .sort(
              (a, b) =>
                Number(
                  b.status === "running" || b.status === "awaiting_approval",
                ) -
                Number(
                  a.status === "running" || a.status === "awaiting_approval",
                ),
            )
            .map((child) => (
              <article
                key={child.id}
                className="agent-card child-session-card wb-child-row"
              >
                <Button
                  size="sm"
                  className="child-title-button"
                  title={child.title}
                  aria-label={`打开子任务：${child.title}`}
                  onClick={() => void selectSession(child.id)}
                >
                  <span className="child-title-clamp">{child.title}</span>
                </Button>
                {(child.status === "running" ||
                  child.status === "awaiting_approval") && (
                  <Button
                    size="sm"
                    disabled={cancelling}
                    onClick={() => void cancelOwned(child.id)}
                  >
                    取消子任务（本进程）
                  </Button>
                )}
                <p className="message-body">
                  {child.model} · {child.status}
                </p>
                {updates
                  .filter((update) => update.childSessionId === child.id)
                  .slice(-1)
                  .map((update) => (
                    <details
                      key={update.childSessionId}
                      className="wb-disclosure"
                    >
                      <summary>查看子任务最新报告</summary>
                      <div className="wb-disclosure-body">
                        <Markdown source={update.summary} />
                      </div>
                    </details>
                  ))}
              </article>
            ))
        ) : (
          <p className="wb-muted">没有已保存的子任务</p>
        )}
        {parentId &&
          (snapshot.status === "running" ||
            snapshot.status === "awaiting_approval") && (
            <Button
              disabled={cancelling}
              onClick={() => void cancelOwned(snapshot.id)}
            >
              取消此子任务（本进程）
            </Button>
          )}
        {snapshot.agentTask && (
          <details className="wb-disclosure">
            <summary>查看子任务指令</summary>
            <div className="wb-disclosure-body">
              <Markdown source={snapshot.agentTask} />
            </div>
          </details>
        )}
        {snapshot.ownership && <p>负责范围：{snapshot.ownership}</p>}
      </section>
      <section className="wb-stack">
        <h3>上下文</h3>
        {/* Raw context statistics collapse into one quiet disclosure; the
            compaction controls below stay directly reachable. */}
        {diagnostics && (
          <details className="wb-disclosure">
            <summary>上下文统计</summary>
            <div className="wb-disclosure-body">
              <dl className="wb-details">
                <dt>原始记录</dt>
                <dd>
                  {diagnostics.transcriptChars.toLocaleString()} 字符 ·{" "}
                  {diagnostics.messageCount} 条消息
                </dd>
                <dt>投影上下文</dt>
                <dd>{diagnostics.projectedChars.toLocaleString()} 字符</dd>
                <dt>摘要类型</dt>
                <dd>
                  {diagnostics.summaryFallback
                    ? "摘录回退（非语义摘要）"
                    : "语义摘要 / 未压缩"}
                </dd>
              </dl>
            </div>
          </details>
        )}
        {snapshot.contextSummary && (
          <details className="wb-disclosure">
            <summary>
              已保存摘要 · 边界 {snapshot.contextSummary.boundary}
              {snapshot.contextSummary.fallback ? " · 摘录回退" : ""}
            </summary>
            <div className="wb-disclosure-body">
              <Markdown source={snapshot.contextSummary.content} />
            </div>
          </details>
        )}
        <Button
          size="sm"
          disabled={busy || running}
          onClick={async () => {
            const valid = scope.current.begin();
            setBusy(true);
            setError("");
            try {
              await window.forge.compactSession(snapshot.id);
              if (valid()) await refreshActiveSession();
            } catch (err) {
              if (valid())
                setError(err instanceof Error ? err.message : "压缩失败");
            } finally {
              if (valid()) setBusy(false);
            }
          }}
        >
          压缩上下文（保留原始记录）
        </Button>
        {busy && (
          <Button
            variant="danger"
            disabled={cancelling}
            onClick={() => void cancelOwned(snapshot.id)}
          >
            {cancelling ? "等待取消确认…" : "取消上下文压缩"}
          </Button>
        )}
        {controlMessage && <output>{controlMessage}</output>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
      <section className="wb-stack">
        <h3>计划</h3>
        {snapshot.plan ? (
          <>
            {/* Plan progress stays visible (live status); only the long-form
                explanation collapses. */}
            <ol className="wb-plan-progress">
              {snapshot.plan.steps.map((step, position) => (
                <li key={`${step.step}:${position}`}>
                  <span className={`plan-status plan-${step.status}`}>
                    {step.status === "completed"
                      ? "✓"
                      : step.status === "in_progress"
                        ? "●"
                        : "○"}
                  </span>{" "}
                  {step.step}
                </li>
              ))}
            </ol>
            <details className="wb-disclosure">
              <summary>查看计划说明（{snapshot.plan.steps.length} 项）</summary>
              <div className="wb-disclosure-body">
                <Markdown source={snapshot.plan.explanation} />
              </div>
            </details>
          </>
        ) : (
          <p className="wb-muted">
            尚无已保存计划。使用 Plan 模式请求只读规划。
          </p>
        )}
      </section>
    </>
  );
}
