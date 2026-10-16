import { Fragment, memo, useLayoutEffect, useRef, useState } from "react";
import { commandActivity, toolActivity } from "../../../shared/tool-activity";
import type {
  ApprovalRequest,
  SessionId,
  SessionSnapshot,
} from "../../shared-types";
import { reduceTimeline } from "../../state/timeline";
import { TranscriptScrollState } from "../../state/transcript-scroll";
import { useWorkbench } from "../../state/workbench-context";
import { ApprovalPanel } from "../primitives/ApprovalPanel";
import { Button } from "../primitives/Button";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { ToolDisclosure } from "../primitives/ToolDisclosure";
import { Markdown } from "./Markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { Reasoning } from "./Reasoning";
import { foldedTool, transcriptStages, type TranscriptStage } from "../../state/transcript-stages";
import "./transcript.css";
export { phaseMarkers, foldedTool } from "../../state/transcript-stages";

function StageHeader({ stage }: { readonly stage: TranscriptStage }) {
  return (
    <h3 className="transcript-stage-header">
      <span className="transcript-stage-author">Forge</span>
      {stage.title && <span className="transcript-stage-title">{stage.title}</span>}
    </h3>
  );
}

export const StoredTranscript = memo(function StoredTranscript({
  snapshot,
}: { readonly snapshot: SessionSnapshot }) {
  const timeline = reduceTimeline(snapshot);
  const { phases, headers } = transcriptStages(timeline);
  const historicalErrors = timeline.filter(
    (item) => item.kind === "error" && item.historical,
  );
  return (
    <>
      {historicalErrors.length > 0 && (
        <details className="message message-internal">
          <summary>历史异常记录 · {historicalErrors.length}</summary>
          {historicalErrors.map(
            (item) =>
              item.kind === "error" && (
                <p key={item.id}>
                  {new Date(item.timestamp).toLocaleString()} · {item.message}
                </p>
              ),
          )}
        </details>
      )}
      {timeline.map((item, index) => {
        if (item.kind === "error" && item.historical) return null;
        if (item.kind === "message" && item.origin === "agent_reconciliation")
          return (
            <details className="message message-internal" key={item.id}>
              <summary>子代理汇总 · 内部记录</summary>
              <p className="wb-muted">运行时追加的子任务汇总，不是人工输入。</p>
              <pre className="message-body">{item.content}</pre>
            </details>
          );
        if (item.kind === "message")
          return (
            <Fragment key={item.id}>
              {headers[index] && <StageHeader stage={headers[index]} />}
              <article className={`message message-${item.role}`}>
                {item.role === "user" && <div className="message-header">你</div>}
                {item.reasoning && (
                  <Reasoning text={item.reasoning} truncated={Boolean(item.reasoningTruncated)} />
                )}
                {item.content && <div className="message-body"><Markdown source={item.content} /></div>}
              </article>
            </Fragment>
          );
        if (item.kind === "error")
          return (
            <ErrorState
              key={item.id}
              title="执行错误（历史记录）"
              error={{
                code: "internal",
                message: item.message,
                retryable: false,
              }}
              impact={`历史事件时间：${new Date(item.timestamp).toLocaleString()}。此错误不会覆盖当前会话状态。`}
            />
          );
        if (item.status === "unexecuted")
          return (
            <section
              key={item.id}
              className="wb-stack tool-unexecuted message-evidence"
            >
              <strong>{item.call.function.name} · 无匹配执行记录</strong>
              <p className="wb-muted">
                已保存调用意图，但没有可可靠关联的执行或结果记录。
              </p>
              <code>{item.call.function.arguments.slice(0, 12000)}</code>
            </section>
          );
        const argvActivity =
          item.call.function.name === "run_command"
            ? commandActivity(item.call)
            : undefined;
        return (
          <Fragment key={item.id}>
          {headers[index] && <StageHeader stage={headers[index]} />}
          <ToolDisclosure
            toolName={item.call.function.name}
            target={toolActivity(item.call).target || undefined}
            command={argvActivity?.command || undefined}
            cwd={argvActivity?.cwd || undefined}
            parameters={item.call.function.arguments.slice(0, 12000)}
            output={item.output.slice(0, 24000)}
            truncated={
              item.output.length > 24000 ||
              item.call.function.arguments.length > 12000
            }
            status={item.status}
            changes={item.changes}
            autoCollapsed={foldedTool(index, phases)}
          />
          </Fragment>
        );
      })}
    </>
  );
});
// In-line approval keeps the decision inside the reading flow: the same facts
// and the same single-use command rule as the Inspector panel, rendered at the
// live tail instead of requiring a trip to the right-hand drawer. It is a thin
// wrapper on purpose, so the primitive stays the one authoritative surface.
export const InlineApproval = memo(function InlineApproval({
  request,
  sessionId,
  isSubmitting,
  hasQueued,
  onDecide,
}: {
  readonly request: ApprovalRequest;
  readonly sessionId: SessionId;
  readonly isSubmitting: boolean;
  readonly hasQueued: boolean;
  readonly onDecide: (approved: boolean) => void;
}) {
  const command = request.command
    ? // Command arrays are shown verbatim; a plain description is the fallback
      // for approvals whose risk is not a literal argv.
      JSON.stringify(request.command)
    : request.description;
  return (
    <section
      className="transcript-approval wb-stack"
      aria-label="待批准执行"
      data-session-id={sessionId}
      data-approval-id={request.id}
      style={{
        // Styling owned by this component only: the workspace CSS file is not
        // part of this change, so the card borrows contract tokens inline.
        gap: "var(--space-3)",
        padding: "var(--space-4)",
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--warning-border)",
        // The ApprovalPanel inside keeps its own warning surface; the outer
        // frame is a quiet card so the pair reads as one inline unit.
        background: "var(--surface-elevated)",
      }}
    >
      <div className="transcript-approval-head wb-stack">
        <strong style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>
          需要你的批准
        </strong>
        {request.childSessionId && (
          <span className="wb-muted">
            子代理审批 · {request.childSessionId}
          </span>
        )}
      </div>
      <ApprovalPanel
        toolName={request.toolName}
        description={request.description}
        command={command}
        isSubmitting={isSubmitting}
        riskNotice="命令不是 OS 沙箱；批准仅对本次请求有效。"
        onApprove={() => onDecide(true)}
        onReject={() => onDecide(false)}
      />
      {hasQueued && (
        <p className="wb-muted">
          还有排队的审批请求，处理完这一条后会继续显示。
        </p>
      )}
    </section>
  );
});

export function Transcript() {
  const { state, answerApproval, openNewSession } = useWorkbench();
  const snapshot = state.activeSnapshot;
  const sessionId = state.activeSessionId;
  const run = sessionId ? state.activeRuns[sessionId] : undefined;
  const pendingApproval = run?.pendingApproval;
  // The inline card is the primary path only for the selected session's live
  // run; every other run (background, child) stays in the Inspector summary.
  const showInlineApproval = Boolean(sessionId && pendingApproval);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigation = useRef(new TranscriptScrollState());
  const [hasNewContent, setHasNewContent] = useState(false);
  // Loading a snapshot for the selected session is itself arriving content,
  // and a fresh approval request is arriving content too: the card must be
  // pulled into view like any new message.
  const contentVersion = `${snapshot?.id ?? ""}:${snapshot?.messages.length ?? 0}:${snapshot?.events.length ?? 0}:${snapshot?.messages.at(-1)?.content?.length ?? 0}:${run?.pendingOutputs?.length ?? 0}:${run?.streamingText ?? ""}:${pendingApproval?.id ?? ""}`;
  const jumpToLatest = () => {
    navigation.current.reset();
    setHasNewContent(false);
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  };
  useLayoutEffect(() => {
    // Each saved session starts at its own tail, even if the previous one was
    // being read off-tail. No scroll/follow state crosses session boundaries.
    if (sessionId) navigation.current.reset();
    setHasNewContent(false);
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [sessionId]);
  useLayoutEffect(() => {
    if (contentVersion && navigation.current.contentArrived()) {
      const scroll = scrollRef.current;
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
    setHasNewContent(navigation.current.hasNewContent);
  }, [contentVersion]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Also handles font/layout changes and content growing after the commit.
      // Never smooth-scroll token updates (including under reduced motion).
      if (navigation.current.following) scroll.scrollTop = scroll.scrollHeight;
    });
    observer.observe(content);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="transcript-region">
      <div
        ref={scrollRef}
        className="workbench-conversation-scroll"
        onScroll={() => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          navigation.current.readPosition(scroll);
          setHasNewContent(navigation.current.hasNewContent);
        }}
        onClickCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(".tool-disclosure-header, summary")
          ) {
            navigation.current.inspectDisclosure();
          }
        }}
      >
        <div ref={contentRef} className="conversation-inner">
          {state.isSnapshotLoading && <p className="wb-muted">正在读取会话…</p>}
          {snapshot ? (
            <StoredTranscript key={snapshot.id} snapshot={snapshot} />
          ) : (
            !state.isSnapshotLoading && (
              <EmptyState
                title="从一个任务开始"
                description="选择工作区，描述目标。Forge 会展示真实执行过程，并在需要时请求你的批准。"
                actionLabel="新建任务"
                onAction={() => openNewSession(true)}
              />
            )
          )}
          {run?.pendingOutputs?.map((output) => (
            <article className="message message-assistant" key={output.id}>
              <div className="message-header message-author">
                Forge · 待同步输出
              </div>
              <div className="message-body">
                {output.truncated && (
                  <p className="wb-muted">
                    实时预览已达显示上限，完整内容以同步后的记录为准。
                  </p>
                )}
                <Markdown source={output.text} />
              </div>
            </article>
          ))}
          {run?.streamingText && (
            <article className="message message-assistant message-streaming">
              <div className="message-header message-author">
                Forge · 实时草稿
              </div>
              <div className="message-body">
                {run.streamingTruncated && (
                  <p className="wb-muted">
                    实时草稿已达显示上限；完整已保存内容请查看会话记录。
                  </p>
                )}
                <StreamingMarkdown
                  key={`${sessionId}:${run.runId ?? "pending"}:${run.streamingTurn ?? 0}`}
                  source={run.streamingText}
                />
              </div>
            </article>
          )}
          {showInlineApproval && pendingApproval && sessionId && (
            <InlineApproval
              key={pendingApproval.id}
              request={pendingApproval}
              sessionId={sessionId}
              isSubmitting={Boolean(
                run?.isSubmittingApproval || run?.isCancelling,
              )}
              hasQueued={(run?.approvalQueue?.length ?? 0) > 1}
              onDecide={(approved) =>
                void answerApproval(sessionId, pendingApproval.id, approved)
              }
            />
          )}
        </div>
      </div>
      {hasNewContent && (
        <div className="transcript-latest" aria-live="polite">
          <Button size="sm" onClick={jumpToLatest}>
            查看最新消息
          </Button>
        </div>
      )}
    </div>
  );
}
