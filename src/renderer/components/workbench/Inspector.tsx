import {
  ArrowsCounterClockwise,
  CaretRight,
  ChartBar,
  Cpu,
  FileCode,
  Folder,
  ShieldCheck,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../../state/workbench-context";
import { ApprovalPanel } from "../primitives/ApprovalPanel";
import { Button } from "../primitives/Button";
import { DiffViewer, diffStats } from "../primitives/DiffViewer";
import { StatusBadge } from "../primitives/StatusBadge";
import { Tabs } from "../primitives/Tabs";
import { CheckpointPanel, ProjectResources } from "./CatalogPanels";
import { ChangeSessionNavigation } from "./ChangeSessionNavigation";
import { RuntimePanels } from "./RuntimePanels";
import { permissionLabels } from "./Settings";
import "./inspector.css";

// The Transcript renders the selected session's live request inline; the
// Inspector owns every other request (background, child, other session).
function scrollToInlineApproval(approvalId: string) {
  const target = document.querySelector(`[data-approval-id="${approvalId}"]`);
  if (target instanceof HTMLElement)
    target.scrollIntoView({ block: "center", behavior: "auto" });
}

export function Inspector({
  onRequestCollapse,
  focusToken,
}: {
  readonly onRequestCollapse?: (() => void) | undefined;
  readonly focusToken?: number | undefined;
}) {
  const [section, setSection] = useState("inspector-runtime");
  const { state, answerApproval, selectSession, refreshActiveSession, setMobileTab } =
    useWorkbench();
  const paneRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusToken && focusToken > 0) paneRef.current?.focus();
  }, [focusToken]);
  // Never show another session's provenance while selection/read is in flight.
  const snapshot =
    state.activeSnapshot?.id === state.activeSessionId
      ? state.activeSnapshot
      : null;
  const run = state.activeSessionId
    ? state.activeRuns[state.activeSessionId]
    : undefined;
  const finished = snapshot?.events
    .filter((e) => e.type === "run_finished")
    .at(-1);
  const started = snapshot?.events
    .filter((e) => e.type === "run_started")
    .at(-1);
  const usage = finished?.type === "run_finished" ? finished.usage : undefined;
  const storedActive =
    !run &&
    (snapshot?.status === "running" ||
      snapshot?.status === "awaiting_approval");
  const pendingApprovals = Object.values(state.activeRuns).filter(
    (r) => r.pendingApproval,
  );
  // Exactly one request can be the selected session's live head; the
  // Transcript already renders it in the reading flow, so the drawer only
  // annotates and links it instead of duplicating the buttons. `run` is
  // keyed by the active session, so its pending request is that exact head.
  const inlineApprovalId = run?.pendingApproval?.id;
  const inlineCovered = pendingApprovals.filter(
    (r) => r.pendingApproval?.id === inlineApprovalId,
  );
  const drawerApprovals = pendingApprovals.filter(
    (r) => r.pendingApproval?.id !== inlineApprovalId,
  );
  return (
    <aside
      ref={paneRef}
      tabIndex={-1}
      className="workbench-inspector wb-inspector"
      aria-label="执行详情"
    >
      <div className="inspector-header wb-inspector-head">
        <div className="inspector-title-row">
          <SlidersHorizontal size={15} weight="bold" className="inspector-title-icon" />
          <span>执行详情</span>
        </div>
        {snapshot && <StatusBadge status={run?.status ?? snapshot.status} />}
        {onRequestCollapse && (
          <button
            type="button"
            className="wb-icon-btn wb-inspector-close"
            aria-label="收起详情"
            title="收起详情"
            onClick={onRequestCollapse}
          >
            <CaretRight size={14} weight="bold" />
          </button>
        )}
      </div>
      <div className="inspector-scroll wb-stack">
        {pendingApprovals.length > 0 && (
          // Approvals are never hidden behind a disclosure or a collapsed
          // pane: this summary (and the header pill in App) always shows the
          // pending count before any per-request detail. The selected
          // session's live request is decided in the Transcript, so the drawer
          // links to it instead of duplicating its buttons; every other
          // request (background / child) still gets a full panel here.
          <section className="wb-approvals-summary wb-stack">
            <h3 className="wb-approvals-title">
              待批准（{pendingApprovals.length}）
            </h3>
            {inlineCovered.map((r) => {
              const request = r.pendingApproval;
              if (!request) return null;
              return (
                <section
                  key={request.id}
                  className="wb-approval-row wb-approval-row-inline wb-stack"
                >
                  <p className="wb-muted">在对话中批准或拒绝本次操作。</p>
                  <div className="wb-row">
                    <span>
                      {request.toolName}
                      {request.childSessionId
                        ? ` · 子代理 ${request.childSessionId}`
                        : ""}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => {
                        setMobileTab("task");
                        requestAnimationFrame(() => scrollToInlineApproval(request.id));
                      }}
                    >
                      定位到消息流
                    </Button>
                  </div>
                </section>
              );
            })}
            {drawerApprovals.map((r) => {
              const request = r.pendingApproval;
              if (!request) return null;
              return (
                <section key={request.id} className="wb-approval-row wb-stack">
                  {r.sessionId !== state.activeSessionId && (
                    <Button onClick={() => void selectSession(r.sessionId)}>
                      后台任务待批准 · 打开会话
                    </Button>
                  )}
                  {request.childSessionId && (
                    <p className="wb-muted">
                      子代理审批 · {request.childSessionId}
                    </p>
                  )}
                  <ApprovalPanel
                    toolName={request.toolName}
                    description={request.description}
                    command={
                      request.command
                        ? JSON.stringify(request.command)
                        : request.description
                    }
                    isSubmitting={Boolean(
                      r.isSubmittingApproval || r.isCancelling,
                    )}
                    riskNotice="命令不是 OS 沙箱；批准仅对本次请求有效。"
                    onApprove={() =>
                      void answerApproval(r.sessionId, request.id, true)
                    }
                    onReject={() =>
                      void answerApproval(r.sessionId, request.id, false)
                    }
                  />
                </section>
              );
            })}
          </section>
        )}
        {!snapshot ? (
          <p className="wb-muted inspector-empty">
            {state.isSnapshotLoading
              ? "正在读取执行记录…"
              : "选择一个会话，查看执行详情"}
          </p>
        ) : (
          <Tabs
            className="inspector-tabs"
            ariaLabel="检查详情分类"
            activeId={section}
            onChange={setSection}
            keepMounted
            tabs={[
              {
                id: "inspector-runtime",
                label: "运行",
                content: (
                  <div className="inspector-sections">
                    <section className="inspector-overview inspector-card">
                      <div className="inspector-card-header">
                        <span className="inspector-card-title">会话概览</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="inspector-refresh-mini"
                          title="刷新记录"
                          aria-label="刷新记录"
                          onClick={() => void refreshActiveSession()}
                        >
                          <ArrowsCounterClockwise size={12} weight="bold" />
                          <span>刷新</span>
                        </Button>
                      </div>
                      <dl className="wb-details">
                        <dt>
                          <Cpu size={13} className="dt-icon" />
                          <span>模型</span>
                        </dt>
                        <dd className="wb-val-mono" title={started?.type === "run_started" ? started.model : snapshot.model}>
                          <code>
                            {started?.type === "run_started"
                              ? started.model
                              : snapshot.model}
                          </code>
                        </dd>
                        <dt>
                          <ShieldCheck size={13} className="dt-icon" />
                          <span>权限</span>
                        </dt>
                        <dd>
                          <span className="inspector-permission-pill">
                            {
                              permissionLabels[
                                run?.permission ??
                                  (started?.type === "run_started"
                                    ? started.permission
                                    : (state.settings?.defaultPermission ??
                                      "workspace"))
                              ].split(" · ")[0]
                            }
                          </span>
                        </dd>
                        <dt>
                          <Folder size={13} className="dt-icon" />
                          <span>工作区</span>
                        </dt>
                        <dd className="wb-val-mono" title={snapshot.workspace}>
                          <code>{snapshot.workspace}</code>
                        </dd>
                      </dl>
                      {storedActive && (
                        <p className="wb-muted inspector-stored-notice">
                          已保存的状态，本窗口没有运行句柄。刷新可查看最新记录；取消操作由主机确认。
                        </p>
                      )}
                    </section>
                    <RuntimePanels key={state.activeSessionId ?? "none"} />
                    <details className="wb-disclosure inspector-disclosure-card inspector-usage-card">
                      <summary>
                        <span className="inspector-disclosure-head">
                          <ChartBar size={14} weight="bold" />
                          <span>上次运行用量</span>
                        </span>
                        {usage && (
                          <span className="inspector-token-pill">
                            {usage.totalTokens.toLocaleString()} tokens
                          </span>
                        )}
                      </summary>
                      <div className="wb-disclosure-body">
                        {usage ? (
                          <div className="inspector-usage-content">
                            <dl className="wb-details inspector-usage-dl">
                              <dt>输入 / 输出</dt>
                              <dd>
                                {usage.promptTokens.toLocaleString()} /{" "}
                                {usage.completionTokens.toLocaleString()}
                              </dd>
                              <dt>总计</dt>
                              <dd className="usage-total-highlight">
                                {usage.totalTokens.toLocaleString()}
                              </dd>
                              {usage.cachedPromptTokens !== undefined && (
                                <>
                                  <dt>缓存输入</dt>
                                  <dd>
                                    {usage.cachedPromptTokens.toLocaleString()}
                                  </dd>
                                </>
                              )}
                            </dl>
                          </div>
                        ) : (
                          <p className="wb-muted">尚无已结算的运行用量</p>
                        )}
                        {finished?.type === "run_finished" && (
                          <div className="inspector-usage-footer">
                            <span className="usage-footer-tag">{finished.turns} 轮</span>
                            <span className="usage-footer-tag">{finished.toolCalls} 次工具调用</span>
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                ),
              },
              {
                id: "inspector-changes",
                label: "变更",
                content: (
                  <div className="wb-stack">
                    {(snapshot.parentSessionId ||
                      state.sessions.some(
                        (session) => session.parentSessionId === snapshot.id,
                      )) && (
                      <details className="wb-disclosure">
                        <summary>关联任务的变更</summary>
                        <div className="wb-disclosure-body">
                          <ChangeSessionNavigation
                            key={`changes-navigation:${snapshot.id}`}
                            sessionId={snapshot.id}
                            parentSessionId={snapshot.parentSessionId}
                            sessions={state.sessions}
                            onOpenChanges={(id) => {
                              setSection("inspector-changes");
                              void selectSession(id);
                            }}
                          />
                        </div>
                      </details>
                    )}
                    <section className="wb-stack inspector-changes-section">
                      <div className="inspector-section-header">
                        <h3>
                          文件变更{" "}
                          <span className="wb-muted">
                            {snapshot.changes.length}
                          </span>
                        </h3>
                      </div>
                      {snapshot?.changes.length ? (
                        <div className="inspector-files-list">
                          {snapshot.changes.map((change, i) => {
                            const stats = diffStats(change);
                            return (
                              <details
                                key={`${change.path}-${i}`}
                                className="wb-disclosure inspector-file-card"
                              >
                                <summary className="inspector-file-summary">
                                  <div className="inspector-file-info">
                                    <FileCode size={14} className="inspector-file-icon" />
                                    <span className="inspector-file-path" title={change.path}>
                                      {change.path}
                                    </span>
                                  </div>
                                  <div className="inspector-file-badges">
                                    {stats && (
                                      <span className="diff-stats-pill">
                                        {stats.added > 0 && <span className="diff-stats-add">+{stats.added}</span>}
                                        {stats.removed > 0 && <span className="diff-stats-del">-{stats.removed}</span>}
                                      </span>
                                    )}
                                    <span className={`inspector-file-kind kind-${change.kind}`}>
                                      {change.kind}
                                    </span>
                                  </div>
                                </summary>
                                <div className="inspector-diff-container">
                                  <DiffViewer change={change} isSuggested={false} />
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="inspector-empty-card">
                          <p className="wb-muted">本会话尚无直接文件变更</p>
                        </div>
                      )}
                    </section>
                    <details className="wb-disclosure">
                      <summary>文件检查点与恢复</summary>
                      <div className="wb-disclosure-body">
                        <CheckpointPanel
                          key={`changes-checkpoints:${state.activeSessionId ?? "none"}`}
                        />
                      </div>
                    </details>
                  </div>
                ),
              },
              {
                id: "inspector-resources",
                label: "资源",
                content: (
                  <ProjectResources key={state.activeSessionId ?? "none"} />
                ),
              },
            ]}
          />
        )}
      </div>
    </aside>
  );
}
