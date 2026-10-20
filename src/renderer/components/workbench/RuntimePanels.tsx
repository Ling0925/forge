import {
  ArrowSquareOut,
  ArrowsInLineVertical,
  CheckCircle,
  Cpu,
  FileText,
  GitFork,
  ListChecks,
  Sparkle,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { OperationScope } from "../../state/operation-scope";
import { useWorkbench } from "../../state/workbench-context";
import type { SessionSnapshot, TaskPlan } from "../../../shared/schemas";
import { sessionPlans } from "../../../shared/plans";
import { Button } from "../primitives/Button";
import { StatusBadge } from "../primitives/StatusBadge";
import { Markdown } from "./Markdown";

function planProgress(plan: TaskPlan) {
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  const total = plan.steps.length;
  const label =
    total > 0 && completed === total
      ? "已完成"
      : plan.steps.some((step) => step.status === "in_progress")
        ? "进行中"
        : "待处理";
  return { completed, total, label };
}

function PlanSteps({ plan }: { readonly plan: TaskPlan }) {
  return (
    <ol className="wb-plan-progress">
      {plan.steps.map((step, position) => (
        <li
          key={`${step.step}:${position}`}
          className={`plan-step-item plan-step-${step.status}`}
        >
          <span className={`plan-status plan-${step.status}`}>
            {step.status === "completed"
              ? "✓"
              : step.status === "in_progress"
                ? "●"
                : "○"}
          </span>{" "}
          <span className="plan-step-text">{step.step}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Plans are independent records: the current one stays expanded, while earlier
 * plans remain reachable as compact disclosures with their own numbering.
 */
export function PlanSection({
  snapshot,
}: {
  readonly snapshot: Pick<SessionSnapshot, "plan" | "plans">;
}) {
  const plans = sessionPlans(snapshot);
  const currentId = snapshot.plan ? (snapshot.plan.id ?? "legacy") : null;
  const current = currentId ? (plans.find((plan) => plan.id === currentId) ?? null) : null;
  const historical = currentId
    ? plans.filter((plan) => plan.id !== currentId)
    : plans.slice(0, -1);
  const currentPlan =
    current ?? (currentId === null && plans.length ? (plans.at(-1) ?? null) : null);
  const currentProgress = currentPlan ? planProgress(currentPlan) : null;
  const percent =
    currentProgress && currentProgress.total > 0
      ? Math.round((currentProgress.completed / currentProgress.total) * 100)
      : 0;

  return (
    <section className="wb-stack inspector-section inspector-plan-section">
      <div className="inspector-card-header">
        <div className="inspector-title-row">
          <ListChecks size={14} weight="bold" className="inspector-title-icon" />
          <h3>计划</h3>
        </div>
        {currentProgress && (
          <span className="inspector-plan-badge">
            {currentProgress.completed}/{currentProgress.total} · {currentProgress.label}
          </span>
        )}
      </div>
      {currentPlan && currentProgress ? (
        <div className="inspector-plan-body wb-stack">
          {/* Plan progress stays visible (live status); only the long-form
              explanation collapses. */}
          <div className="wb-plan-current-title">
            <div className="wb-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>{currentPlan.title ?? "原有计划"}</strong>
              <span className="wb-muted" style={{ fontSize: "11px" }}>
                {percent}%
              </span>
            </div>
            <div className="inspector-plan-progress-track">
              <div
                className="inspector-plan-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <PlanSteps plan={currentPlan} />
          <details className="wb-disclosure inspector-disclosure-card">
            <summary>
              查看计划说明（{currentPlan.steps.length} 项）
            </summary>
            <div className="wb-disclosure-body">
              <Markdown source={currentPlan.explanation} />
            </div>
          </details>
        </div>
      ) : (
        <p className="wb-muted">
          尚无已保存计划。使用 Plan 模式请求只读规划。
        </p>
      )}
      {historical.length > 0 && (
        <div className="wb-stack">
          <p className="wb-muted">历史计划 {historical.length}</p>
          {historical.map((plan) => {
            const index = plans.indexOf(plan) + 1;
            const progress = planProgress(plan);
            return (
              <details
                key={`${plan.id}:${index}`}
                className="wb-disclosure inspector-disclosure-card"
              >
                <summary>
                  计划 {index} · {plan.title ?? "原有计划"} ·{" "}
                  {progress.completed}/{progress.total} {progress.label}
                </summary>
                <div className="wb-disclosure-body">
                  <PlanSteps plan={plan} />
                  <Markdown source={plan.explanation} />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

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
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const sessionId = snapshot?.id;
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
    setDiagnosticsError("");
    if (sessionId && diagnosticsOpen)
      void window.forge
        .getDiagnostics(sessionId)
        .then((value) => {
          if (alive) setDiagnostics(value);
        })
        .catch((err) => {
          if (alive)
            setDiagnosticsError(
              err instanceof Error ? err.message : "上下文统计读取失败",
            );
        });
    return () => {
      alive = false;
    };
  }, [sessionId, diagnosticsOpen]);
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
      <PlanSection snapshot={snapshot} />
      {/* Active children stay visible by default: this is live delegation
          state, not raw metadata. */}
      <section className="wb-stack inspector-section">
        <div className="inspector-card-header">
          <h3>
            子任务 <span className="wb-muted">{children.length}</span>
          </h3>
          {parentId && (
            <Button size="sm" variant="ghost" onClick={() => void selectSession(parentId)}>
              打开父任务
            </Button>
          )}
        </div>
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
                <div className="child-card-header">
                  <Button
                    size="sm"
                    className="child-title-button"
                    title={child.title}
                    aria-label={`打开子任务：${child.title}`}
                    onClick={() => void selectSession(child.id)}
                  >
                    <ArrowSquareOut size={13} weight="bold" />
                    <span className="child-title-clamp">{child.title}</span>
                  </Button>
                  {(child.status === "running" ||
                    child.status === "awaiting_approval") && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={cancelling}
                      onClick={() => void cancelOwned(child.id)}
                    >
                      {cancelling ? "正在取消…" : "取消任务"}
                    </Button>
                  )}
                </div>
                <div className="inspector-child-meta">
                  <StatusBadge status={child.status} />
                  <span title={child.model}>
                    <Cpu size={12} weight="bold" style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                    {child.model}
                  </span>
                </div>
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
        {snapshot.ownership && <p className="inspector-ownership-tag">负责范围：{snapshot.ownership}</p>}
        {snapshot.agentWorktree && (
          <p className="inspector-ownership-tag">
            工作树：<code>{snapshot.agentWorktree.worktree}</code>
          </p>
        )}
      </section>
      <section className="wb-stack inspector-section">
        <h3>上下文</h3>
        {/* Raw context statistics collapse into one quiet disclosure; the
            compaction controls below stay directly reachable. */}
        <details
          className="wb-disclosure inspector-disclosure-card"
          onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
        >
          <summary>上下文统计</summary>
          <div className="wb-disclosure-body">
            {diagnosticsError ? (
              <p role="alert" className="form-error">
                {diagnosticsError}
              </p>
            ) : !diagnostics ? (
              <p className="wb-muted">正在读取…</p>
            ) : (
              <div className="context-diagnostics-view">
                <dl className="wb-details inspector-details-grid">
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
            )}
          </div>
        </details>
        {snapshot.contextSummary && (
          <details className="wb-disclosure inspector-disclosure-card">
            <summary>
              已保存摘要 · 边界 {snapshot.contextSummary.boundary}
              {snapshot.contextSummary.fallback ? " · 摘录回退" : ""}
            </summary>
            <div className="wb-disclosure-body">
              <Markdown source={snapshot.contextSummary.content} />
            </div>
          </details>
        )}
        <div className="context-compaction-row">
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
            <ArrowsInLineVertical size={13} weight="bold" />
            <span>{busy ? "正在压缩…" : "压缩上下文"}</span>
          </Button>
          <p className="wb-muted context-compaction-hint">
            {running
              ? "运行结束后可压缩，原始记录保留。"
              : "保留原始记录，仅压缩模型使用的上下文。"}
          </p>
        </div>
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
    </>
  );
}
