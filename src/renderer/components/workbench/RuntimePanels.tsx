import {
  ArrowSquareOut,
  ArrowsInLineVertical,
  ChartBar,
  Cpu,
  FileText,
  ListChecks,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OperationScope } from "../../state/operation-scope";
import { sessionUsage } from "../../state/session-usage";
import { useWorkbench } from "../../state/workbench-context";
import type { SessionSnapshot, TaskPlan } from "../../../shared/schemas";
import { sessionPlans } from "../../../shared/plans";
import { Button } from "../primitives/Button";
import { StatusBadge } from "../primitives/StatusBadge";
import {
  type MemoryExcerptBlock,
  type MemoryPlanSummary,
  type ParsedContextMemory,
  parseContextMemory,
} from "./context-memory-parser";
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

function resolveDisplayPlans(snapshot: Pick<SessionSnapshot, "plan" | "plans">) {
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
  return { plans, currentPlan, currentProgress, historical, percent };
}

export function PlanProgressPanel({
  snapshot,
}: {
  readonly snapshot: Pick<SessionSnapshot, "plan" | "plans">;
}) {
  const { currentPlan, currentProgress, percent } = resolveDisplayPlans(snapshot);
  const inProgressCount = currentPlan
    ? currentPlan.steps.filter((step) => step.status === "in_progress").length
    : 0;
  const pendingCount = currentPlan
    ? currentPlan.steps.filter((step) => step.status === "pending").length
    : 0;

  return (
    <section className="wb-stack inspector-section inspector-plan-section inspector-plan-progress-panel">
      <div className="inspector-card-header">
        <div className="inspector-title-row">
          <ListChecks size={14} weight="bold" className="inspector-title-icon" />
          <h3>计划进度</h3>
        </div>
        {currentProgress && (
          <span className="inspector-plan-badge">
            {currentProgress.completed}/{currentProgress.total} · {currentProgress.label}
          </span>
        )}
      </div>
      {currentPlan && currentProgress ? (
        <div className="inspector-plan-body wb-stack">
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
          {currentProgress.total > 0 && (
            <div className="inspector-plan-stats-row">
              <span className="inspector-plan-stat-pill is-completed">
                已完成 {currentProgress.completed}
              </span>
              <span className="inspector-plan-stat-pill is-active">
                进行中 {inProgressCount}
              </span>
              <span className="inspector-plan-stat-pill is-pending">
                待处理 {pendingCount}
              </span>
            </div>
          )}
          <PlanSteps plan={currentPlan} />
        </div>
      ) : (
        <p className="wb-muted">
          尚无已保存计划。使用 Plan 模式请求只读规划。
        </p>
      )}
    </section>
  );
}

export function PlanDocumentPanel({
  snapshot,
}: {
  readonly snapshot: Pick<SessionSnapshot, "plan" | "plans">;
}) {
  const { plans, currentPlan, currentProgress, historical } =
    resolveDisplayPlans(snapshot);

  return (
    <section className="wb-stack inspector-section inspector-plan-section inspector-plan-doc-panel">
      <div className="inspector-card-header">
        <div className="inspector-title-row">
          <FileText size={14} weight="bold" className="inspector-title-icon" />
          <h3>Plan 规划</h3>
        </div>
        {currentProgress && (
          <span className="inspector-plan-badge">
            {currentProgress.completed}/{currentProgress.total} · {currentProgress.label}
          </span>
        )}
      </div>
      {currentPlan && currentProgress ? (
        <div className="inspector-plan-body wb-stack">
          <div className="wb-plan-current-title">
            <div className="wb-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>{currentPlan.title ?? "原有计划"}</strong>
              <span className="wb-muted" style={{ fontSize: "11px" }}>
                共 {currentPlan.steps.length} 步
              </span>
            </div>
          </div>
          {currentPlan.explanation ? (
            <div className="wb-disclosure-body inspector-plan-doc-body">
              <Markdown source={currentPlan.explanation} />
            </div>
          ) : (
            <p className="wb-muted">当前计划未附带详细说明文档。</p>
          )}
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

/**
 * Plans are independent records: the current one stays expanded, while earlier
 * plans remain reachable as compact disclosures with their own numbering.
 */
export function PlanSection({
  snapshot,
}: {
  readonly snapshot: Pick<SessionSnapshot, "plan" | "plans">;
}) {
  return (
    <div className="wb-stack">
      <PlanProgressPanel snapshot={snapshot} />
      <PlanDocumentPanel snapshot={snapshot} />
    </div>
  );
}

export function SubAgentsPanel() {
  const { state, selectSession, refreshActiveSession } = useWorkbench();
  const snapshot = state.activeSnapshot;
  const cancelScope = useRef(new OperationScope());
  useEffect(() => {
    cancelScope.current = new OperationScope();
    return () => {
      cancelScope.current.close();
    };
  }, []);
  const [error, setError] = useState("");
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

  if (!snapshot) return null;
  const parentId = snapshot.parentSessionId;
  const children = state.sessions.filter(
    (session) => session.parentSessionId === snapshot.id,
  );
  const updates = snapshot.events.filter(
    (event) => event.type === "agent_update",
  );

  return (
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
      {controlMessage && <output>{controlMessage}</output>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

function MemoryExcerptCard({
  label,
  excerpt,
}: {
  readonly label?: string | undefined;
  readonly excerpt: MemoryExcerptBlock;
}) {
  return (
    <div className="inspector-memory-block">
      {(label || excerpt.ref || excerpt.roleLabel || excerpt.truncated) && (
        <div className="inspector-memory-block-head">
          {label && <span className="inspector-memory-block-title">{label}</span>}
          {excerpt.roleLabel && (
            <span className="inspector-memory-role-pill">{excerpt.roleLabel}</span>
          )}
          {excerpt.ref && (
            <span className="inspector-memory-ref-pill">{excerpt.ref}</span>
          )}
          {excerpt.truncated && (
            <span className="inspector-memory-trunc-pill">已截断</span>
          )}
        </div>
      )}
      <div className="inspector-memory-block-body">
        <Markdown source={excerpt.text} />
      </div>
    </div>
  );
}

function MemoryPlanBlock({ plan }: { readonly plan: MemoryPlanSummary }) {
  return (
    <div className="inspector-memory-block">
      <div className="inspector-memory-block-head">
        <span className="inspector-memory-block-title">
          关联计划{plan.title ? ` · ${plan.title}` : ""}
        </span>
      </div>
      {plan.explanation && (
        <div className="inspector-memory-block-body">
          <Markdown source={plan.explanation} />
        </div>
      )}
      {plan.steps.length > 0 && (
        <ul className="inspector-memory-list">
          {plan.steps.map((s, idx) => (
            <li key={`${idx}:${s.step}`} className="inspector-memory-list-item">
              <span className="inspector-memory-item-text">{s.step}</span>
              <span className="inspector-memory-ref-pill">
                {s.status === "completed"
                  ? "已完成"
                  : s.status === "in_progress"
                    ? "进行中"
                    : "待执行"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ContextMemoryView({
  parsed,
}: {
  readonly parsed: ParsedContextMemory;
}) {
  if (parsed.kind === "working_state") {
    return (
      <div className="inspector-memory-view wb-stack">
        {parsed.archiveRange && (
          <div className="inspector-memory-meta-row">
            <span className="inspector-memory-meta-pill">
              工作状态摘要
            </span>
            <span className="inspector-memory-ref-pill">
              归档记录 {parsed.archiveRange}
            </span>
          </div>
        )}
        {parsed.goal && (
          <div className="inspector-memory-block">
            <div className="inspector-memory-block-head">
              <span className="inspector-memory-block-title">任务目标</span>
            </div>
            <div className="inspector-memory-block-body">
              <Markdown source={parsed.goal} />
            </div>
          </div>
        )}
        {parsed.sections.map((section) => (
          <div key={section.key} className="inspector-memory-block">
            <div className="inspector-memory-block-head">
              <span className="inspector-memory-block-title">
                {section.label}
              </span>
              <span className="inspector-memory-count">
                {section.items.length}
              </span>
            </div>
            <ul className="inspector-memory-list">
              {section.items.map((item, idx) => (
                <li
                  key={`${section.key}:${idx}`}
                  className="inspector-memory-list-item"
                >
                  <span className="inspector-memory-item-text">
                    {item.text}
                  </span>
                  {item.refs.length > 0 && (
                    <span className="inspector-memory-refs">
                      {item.refs.map((ref) => (
                        <span key={ref} className="inspector-memory-ref-pill">
                          {ref}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  if (parsed.kind === "run_checkpoint") {
    return (
      <div className="inspector-memory-view wb-stack">
        <div className="inspector-memory-meta-row">
          <span className="inspector-memory-meta-pill">
            运行检查点 · {parsed.statusLabel}
          </span>
          {parsed.archiveRange && (
            <span className="inspector-memory-ref-pill">
              记录 {parsed.archiveRange}
            </span>
          )}
          {parsed.endedAt && (
            <span className="inspector-memory-time">{parsed.endedAt}</span>
          )}
          {parsed.effectsMayBeUncertain && (
            <span className="inspector-memory-trunc-pill">副作用待确认</span>
          )}
        </div>
        {parsed.initialRequest && (
          <MemoryExcerptCard label="初始请求" excerpt={parsed.initialRequest} />
        )}
        {parsed.latestRequest && (
          <MemoryExcerptCard label="最近请求" excerpt={parsed.latestRequest} />
        )}
        {parsed.latestAssistantReport && (
          <MemoryExcerptCard
            label="最近助手回复"
            excerpt={parsed.latestAssistantReport}
          />
        )}
        {parsed.plan && <MemoryPlanBlock plan={parsed.plan} />}
        {parsed.toolObservations.length > 0 && (
          <div className="inspector-memory-block">
            <div className="inspector-memory-block-head">
              <span className="inspector-memory-block-title">最近工具观察</span>
              <span className="inspector-memory-count">
                {parsed.toolObservations.length}
              </span>
            </div>
            <div className="wb-stack">
              {parsed.toolObservations.map((obs, idx) => (
                <MemoryExcerptCard
                  key={`${obs.ref ?? idx}:${idx}`}
                  excerpt={obs}
                />
              ))}
            </div>
          </div>
        )}
        {parsed.priorMemory && (
          <details className="wb-disclosure inspector-memory-subdisclosure">
            <summary>前序历史记忆摘录</summary>
            <div className="wb-disclosure-body">
              <ContextMemoryView parsed={parsed.priorMemory} />
            </div>
          </details>
        )}
      </div>
    );
  }

  if (parsed.kind === "fallback_state") {
    return (
      <div className="inspector-memory-view wb-stack">
        <div className="inspector-memory-meta-row">
          <span className="inspector-memory-meta-pill">摘录回退记忆</span>
          {parsed.archiveRange && (
            <span className="inspector-memory-ref-pill">
              归档 {parsed.archiveRange}
            </span>
          )}
          {parsed.unsummarizedRanges && (
            <span className="inspector-memory-trunc-pill">
              未摘要区间 {parsed.unsummarizedRanges}
            </span>
          )}
        </div>
        {parsed.plan && <MemoryPlanBlock plan={parsed.plan} />}
        {parsed.excerpts.length > 0 && (
          <div className="inspector-memory-block">
            <div className="inspector-memory-block-head">
              <span className="inspector-memory-block-title">最近记录摘录</span>
              <span className="inspector-memory-count">
                {parsed.excerpts.length}
              </span>
            </div>
            <div className="wb-stack">
              {parsed.excerpts.map((item, idx) => (
                <MemoryExcerptCard
                  key={`${item.ref ?? idx}:${idx}`}
                  excerpt={item}
                />
              ))}
            </div>
          </div>
        )}
        {parsed.previousState && (
          <details className="wb-disclosure inspector-memory-subdisclosure">
            <summary>前序记忆状态</summary>
            <div className="wb-disclosure-body">
              <ContextMemoryView parsed={parsed.previousState} />
            </div>
          </details>
        )}
      </div>
    );
  }

  if (parsed.kind === "structured_json") {
    return (
      <div className="inspector-memory-view wb-stack">
        {parsed.archiveRange && (
          <div className="inspector-memory-meta-row">
            <span className="inspector-memory-ref-pill">
              归档 {parsed.archiveRange}
            </span>
          </div>
        )}
        <dl className="wb-details inspector-details-grid">
          {parsed.entries.map((entry) => (
            <div key={entry.key} className="inspector-memory-kv-row">
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="inspector-memory-view">
      <Markdown source={parsed.text} />
    </div>
  );
}

export function ContextManagementPanel() {
  const { state, refreshActiveSession } = useWorkbench();
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

  const parsedMemory = useMemo(
    () =>
      snapshot?.contextSummary
        ? parseContextMemory(snapshot.contextSummary.content)
        : null,
    [snapshot?.contextSummary],
  );

  if (!snapshot) return null;
  const run = state.activeRuns[snapshot.id];
  const running =
    run?.status === "running" ||
    run?.status === "awaiting_approval" ||
    snapshot.status === "running" ||
    snapshot.status === "awaiting_approval";
  const usageStats = sessionUsage(snapshot.events);
  const finished = snapshot.events
    .filter((e) => e.type === "run_finished")
    .at(-1);
  const totalTokens =
    usageStats.total?.totalTokens ??
    (finished?.type === "run_finished" ? finished.usage?.totalTokens : undefined);

  return (
    <section className="wb-stack inspector-section">
      <h3>上下文与记忆</h3>
      {/* Single unified token total & context statistics disclosure */}
      <details
        className="wb-disclosure inspector-disclosure-card inspector-usage-card"
        onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="inspector-disclosure-head">
            <ChartBar size={14} weight="bold" />
            <span>上下文统计</span>
          </span>
          {totalTokens !== undefined && (
            <span className="inspector-token-pill">
              总计 {totalTokens.toLocaleString()} tokens
            </span>
          )}
        </summary>
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
                <dt>累计 Tokens</dt>
                <dd className="usage-total-highlight">
                  {totalTokens !== undefined
                    ? `${totalTokens.toLocaleString()} tokens`
                    : "尚无已结算用量"}
                </dd>
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
              {finished?.type === "run_finished" && (
                <div className="inspector-usage-footer">
                  <span className="usage-footer-tag">
                    {finished.steps ?? finished.turns} 步
                  </span>
                  <span className="usage-footer-tag">
                    {finished.toolCalls} 次工具调用
                  </span>
                  {Boolean(finished.retries) && (
                    <span className="usage-footer-tag">
                      {finished.retries} 次请求重试
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </details>
      {snapshot.contextSummary && parsedMemory && (
        <details className="wb-disclosure inspector-disclosure-card inspector-memory-card">
          <summary>
            <span className="inspector-disclosure-head">
              <span>
                已保存摘要 · 边界 {snapshot.contextSummary.boundary}
                {snapshot.contextSummary.fallback ? " · 摘录回退" : ""}
              </span>
            </span>
          </summary>
          <div className="wb-disclosure-body">
            <ContextMemoryView parsed={parsedMemory} />
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
  );
}

export function RuntimePanels() {
  const { state } = useWorkbench();
  const snapshot = state.activeSnapshot;
  if (!snapshot) return null;
  return (
    <>
      <PlanSection snapshot={snapshot} />
      <SubAgentsPanel />
      <ContextManagementPanel />
    </>
  );
}
