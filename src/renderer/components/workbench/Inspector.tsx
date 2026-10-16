import { CaretRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../../state/workbench-context";
import { ApprovalPanel } from "../primitives/ApprovalPanel";
import { Button } from "../primitives/Button";
import { DiffViewer } from "../primitives/DiffViewer";
import { StatusBadge } from "../primitives/StatusBadge";
import { Tabs } from "../primitives/Tabs";
import { CheckpointPanel, ProjectResources } from "./CatalogPanels";
import { ChangeSessionNavigation } from "./ChangeSessionNavigation";
import { RuntimePanels } from "./RuntimePanels";
import { permissionLabels } from "./Settings";

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
  const [section, setSection] = useState("inspector-changes");
  const { state, answerApproval, selectSession, refreshActiveSession } =
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
        <span>执行详情</span>
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
                  <p className="wb-muted">
                    这条审批已在主消息流的内联卡片中显示，可直接在对话里批准或拒绝。
                  </p>
                  <div className="wb-row">
                    <span>
                      {request.toolName}
                      {request.childSessionId
                        ? ` · 子代理 ${request.childSessionId}`
                        : ""}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => scrollToInlineApproval(request.id)}
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
        <Tabs
          className="inspector-tabs"
          ariaLabel="检查详情分类"
          activeId={section}
          onChange={setSection}
          keepMounted
          tabs={[
            {
              id: "inspector-changes",
              label: "变更 / 检查点",
              content: (
                <div className="wb-stack">
                  {snapshot && (
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
                  )}
                  <CheckpointPanel
                    key={`changes-checkpoints:${state.activeSessionId ?? "none"}`}
                  />
                  <section className="wb-stack">
                    <h3>文件变更</h3>
                    {snapshot?.changes.length ? (
                      snapshot.changes.map((change, i) => (
                        <details
                          key={`${change.path}-${i}`}
                          className="wb-disclosure"
                        >
                          <summary>
                            {change.path} · {change.kind}
                          </summary>
                          <DiffViewer change={change} isSuggested={false} />
                        </details>
                      ))
                    ) : (
                      <p className="wb-muted">本会话尚无直接文件变更</p>
                    )}
                  </section>
                </div>
              ),
            },
            {
              id: "inspector-runtime",
              label: "概览 / 运行",
              content: (
                <div className="wb-stack">
                  <StatusBadge
                    status={run?.status ?? snapshot?.status ?? "idle"}
                  />
                  {storedActive && (
                    <p className="wb-muted">
                      这是已保存的运行状态；本窗口没有对应的根运行句柄，不代表操作属于其他进程。子任务可请求取消，由主机确认本进程是否拥有操作。可刷新记录查看最新状态。
                    </p>
                  )}
                  <RuntimePanels key={state.activeSessionId ?? "none"} />
                  {/* Repeated raw run metadata collapses into one quiet
                      disclosure; nothing is dropped, only deferred. */}
                  <details className="wb-disclosure">
                    <summary>上次运行元数据</summary>
                    <div className="wb-disclosure-body wb-stack">
                      <dl className="wb-details">
                        <dt>模型</dt>
                        <dd>
                          {started?.type === "run_started"
                            ? started.model
                            : (snapshot?.model ??
                              state.settings?.model ??
                              "未配置")}
                        </dd>
                        <dt>权限</dt>
                        <dd>
                          {
                            permissionLabels[
                              started?.type === "run_started"
                                ? started.permission
                                : (state.settings?.defaultPermission ??
                                  "workspace")
                            ]
                          }
                        </dd>
                        <dt>工作区</dt>
                        <dd>{snapshot?.workspace ?? "未选择"}</dd>
                      </dl>
                      {usage && (
                        <section>
                          <h3>上次运行用量</h3>
                          <p>
                            输入 {usage.promptTokens} · 输出{" "}
                            {usage.completionTokens} · 总计 {usage.totalTokens}
                          </p>
                          {usage.cachedPromptTokens !== undefined && (
                            <p>缓存输入 {usage.cachedPromptTokens}</p>
                          )}
                        </section>
                      )}
                      {finished?.type === "run_finished" && (
                        <p className="wb-muted">
                          {finished.turns} 轮 · {finished.toolCalls} 次工具调用
                        </p>
                      )}
                    </div>
                  </details>
                  <Button size="sm" onClick={() => void refreshActiveSession()}>
                    刷新保存的记录
                  </Button>
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
      </div>
    </aside>
  );
}
