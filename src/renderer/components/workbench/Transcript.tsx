import { memo, useLayoutEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "../../shared-types";
import { reduceTimeline } from "../../state/timeline";
import { TranscriptScrollState } from "../../state/transcript-scroll";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { ToolDisclosure } from "../primitives/ToolDisclosure";
import { Markdown } from "./Markdown";
export const StoredTranscript = memo(function StoredTranscript({
  snapshot,
}: { readonly snapshot: SessionSnapshot }) {
  const timeline = reduceTimeline(snapshot);
  return (
    <>
      {timeline.map((item) => {
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
            <article className={`message message-${item.role}`} key={item.id}>
              <div className="message-header">
                {item.role === "user" ? "你" : "Forge"}
              </div>
              <div className="message-body">
                <Markdown source={item.content} />
              </div>
            </article>
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
        return (
          <ToolDisclosure
            key={item.id}
            toolName={item.call.function.name}
            parameters={item.call.function.arguments.slice(0, 12000)}
            output={item.output.slice(0, 24000)}
            truncated={
              item.output.length > 24000 ||
              item.call.function.arguments.length > 12000
            }
            status={item.status}
          />
        );
      })}
    </>
  );
});
export function Transcript() {
  const { state, openNewSession } = useWorkbench();
  const snapshot = state.activeSnapshot;
  const run = state.activeSessionId
    ? state.activeRuns[state.activeSessionId]
    : undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigation = useRef(new TranscriptScrollState());
  const [hasNewContent, setHasNewContent] = useState(false);
  const sessionId = state.activeSessionId;
  // Loading a snapshot for the selected session is itself arriving content.
  const contentVersion = `${snapshot?.id ?? ""}:${snapshot?.messages.length ?? 0}:${snapshot?.events.length ?? 0}:${snapshot?.messages.at(-1)?.content?.length ?? 0}:${run?.streamingText ?? ""}`;
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
          {run?.streamingText && (
            <article className="message message-assistant message-streaming">
              <div className="message-header message-author">
                Forge · 实时草稿
              </div>
              <div className="message-body">
                <Markdown source={run.streamingText} />
              </div>
            </article>
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
