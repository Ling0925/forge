import { ArrowDown, ArrowSquareOut, CaretDown, CaretUp } from "@phosphor-icons/react";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionId, SessionSnapshot, SessionSummary } from "../../shared-types";
import { toolActivity } from "../../../shared/tool-activity";
import { mergeTranscript } from "../../state/transcript-sync";
import { TranscriptScrollState } from "../../state/transcript-scroll";
import type { TimelineItem } from "../../state/timeline";
import {
  childConversation, childFinalReport, childIsActive,
  type AgentProgress, type AgentUpdate,
} from "../../state/subagent-conversation";
import { Button } from "../primitives/Button";
import { ToolDisclosure, friendlyLabel } from "../primitives/ToolDisclosure";
import { Markdown } from "./Markdown";

function activityText(item: TimelineItem | undefined): string {
  if (!item) return "";
  if (item.kind === "message") return item.content;
  if (item.kind === "error") return item.message;
  if (item.kind === "hook_diagnostic") return item.reason ?? `${item.hook} · ${item.status}`;
  const activity = toolActivity(item.call);
  const status = { running: "正在", completed: "已完成：", failed: "失败：", unexecuted: "未执行：" }[item.status];
  return `${status}${friendlyLabel(activity.name)}${activity.target ? ` · ${activity.target}` : ""}`;
}

const ActivityEntry = memo(function ActivityEntry({ item, live }: { readonly item: TimelineItem; readonly live: boolean }) {
  if (item.kind === "tool") {
    if (item.status === "unexecuted") return <p className="wb-muted">{activityText(item)}</p>;
    return <ToolDisclosure
      toolName={item.call.function.name}
      target={toolActivity(item.call).target}
      status={item.status}
      parameters={item.call.function.arguments.slice(0, 12000)}
      output={item.output.slice(0, 24000)}
      truncated={item.output.length > 24000 || item.call.function.arguments.length > 12000}
      defaultExpanded={false}
      {...(item.durationMs === undefined ? {} : { durationMs: item.durationMs })}
      {...(item.startedAt === undefined ? {} : { timestamp: item.startedAt })}
    />;
  }
  if (item.kind !== "message") return <p className="form-error child-activity-error">{activityText(item)}</p>;
  return <div className="child-conversation-message" data-live={live || undefined}>
    <div className="child-conversation-speaker">助手{live && <span> · 正在输出</span>}</div>
    <Markdown source={item.content} highlight={!live} />
    {item.truncated && <p className="wb-muted">实时预览已截断；保存后的完整内容请打开会话查看。</p>}
  </div>;
});

export const SubAgentActivity = memo(function SubAgentActivity({ child, cached, progress, update, onOpen }: {
  readonly child: SessionSummary;
  readonly cached?: SessionSnapshot | undefined;
  readonly progress?: AgentProgress | undefined;
  readonly update?: AgentUpdate | undefined;
  readonly onOpen: (id: SessionId) => void | Promise<void>;
}) {
  // Keep the mounted card's snapshot when the shared eight-entry navigation
  // cache evicts it. A streaming parent plus eight children must not flicker.
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(cached ?? null);
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (cached) {
      setSnapshot(previous => mergeTranscript(previous, cached, previous?.updatedAt ?? null));
      setReadError("");
    }
  }, [cached]);
  useEffect(() => {
    let alive = true;
    setReading(true);
    setReadError("");
    // One initial read (also for historical children), then normal workbench
    // agent_update refreshes feed `cached`. No token-by-token fetch or polling.
    void (async () => {
      try {
        const next = await window.forge.getSession(child.id);
        if (alive) setSnapshot(previous => mergeTranscript(previous, next, previous?.updatedAt ?? null));
      } catch {
        if (alive) setReadError("会话记录读取失败；实时预览仍会继续更新。");
      } finally {
        if (alive) setReading(false);
      }
    })();
    return () => { alive = false; };
  }, [child.id, attempt]);

  const conversation = useMemo(() => childConversation(snapshot, progress), [snapshot, progress]);
  const active = childIsActive(child.status);
  const report = child.status === "completed" ? childFinalReport(snapshot) : "";
  const last = conversation.entries.at(-1);
  const currentTool = active && update?.currentTool && (!progress?.text || update.timestamp >= progress.timestamp)
    ? `${friendlyLabel(update.currentTool.name)}${update.currentTool.target ? ` · ${update.currentTool.target}` : ""}` : "";
  const toolAlreadyShown = currentTool && conversation.entries.some(item => item.kind === "tool" && item.status === "running" &&
    toolActivity(item.call).name === update?.currentTool?.name && toolActivity(item.call).target === update?.currentTool?.target);
  const empty = active ? "已启动，等待第一条消息" : child.status === "completed"
    ? reading ? "正在同步最终报告…" : "暂无最终报告，可查看过程记录。"
    : child.status === "cancelled" ? "任务已取消，过程记录已保留。"
    : child.status === "failed" || child.status === "interrupted" ? "任务未完成，可查看过程记录与错误。" : "暂无会话内容";
  const preview = report || (currentTool ? `正在${currentTool}` : activityText(last)) || empty;
  const timestamp = [child.updatedAt, snapshot?.updatedAt, update?.timestamp, progress?.timestamp]
    .filter((value): value is string => Boolean(value)).sort().at(-1);
  const date = timestamp ? new Date(timestamp) : null;

  const [view, setView] = useState<"preview" | "conversation" | "report">("preview");
  const bodyId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(new TranscriptScrollState());
  const previousView = useRef(view);
  const [hasNew, setHasNew] = useState(false);
  const revision = `${conversation.entries.length}:${last?.id ?? ""}:${activityText(last)}:${last?.kind === "tool" ? last.output.length : 0}:${currentTool}`;
  useLayoutEffect(() => {
    if (view === "conversation" && scroller.current) {
      if (previousView.current !== view) follow.current.reset();
      if (follow.current.contentArrived()) scroller.current.scrollTop = scroller.current.scrollHeight;
      setHasNew(follow.current.hasNewContent);
    }
    previousView.current = view;
  }, [view, revision]);
  const returnToLatest = () => {
    follow.current.reset();
    setHasNew(false);
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  };

  return <section className="child-activity" aria-label="子任务动态">
    <div className="child-activity-heading">
      <strong>{view === "conversation" && !active ? "过程记录" : active ? "实时会话" : child.status === "completed" ? "最终报告" : "执行结果"}</strong>
      {date && Number.isFinite(date.getTime()) && <time dateTime={timestamp} title={date.toLocaleString()}>
        更新于 {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
      </time>}
    </div>
    {view === "preview" && <p className={`child-activity-preview${last?.kind === "error" || last?.kind === "tool" && last.status === "failed" ? " is-error" : ""}`}>{preview.slice(0, 1000)}</p>}
    {view === "conversation" && <>
      <div className="child-conversation-toolbar">
        <span>只读 · 最近记录</span>
        <Button size="sm" variant="ghost" onClick={() => void onOpen(child.id)}>
          打开完整会话 <ArrowSquareOut size={12} />
        </Button>
      </div>
      <div id={bodyId} ref={scroller} className="child-conversation-scroll" role="region" aria-label="子任务会话记录" tabIndex={0}
        onScroll={event => {
          follow.current.readPosition(event.currentTarget);
          setHasNew(follow.current.hasNewContent);
        }}
        onClickCapture={event => {
          if (event.target instanceof Element && event.target.closest("summary, button[aria-expanded]")) follow.current.inspectDisclosure();
        }}>
        {conversation.omitted > 0 && <p className="wb-muted">仅显示最近 {conversation.entries.length} 条，更早内容请打开完整会话。</p>}
        {conversation.entries.map(item => <ActivityEntry key={item.id} item={item} live={item.id === conversation.liveId && active} />)}
        {currentTool && !toolAlreadyShown && <p className="child-conversation-current">正在{currentTool}</p>}
        {!conversation.entries.length && !currentTool && <p className="wb-muted">{reading ? "正在读取会话记录…" : empty}</p>}
      </div>
      {hasNew && <Button size="sm" variant="ghost" className="child-conversation-latest" onClick={returnToLatest}>
        <ArrowDown size={12} />有新内容 · 回到最新
      </Button>}
    </>}
    {view === "report" && <div id={bodyId} className="child-conversation-scroll child-final-report" role="region" aria-label="子任务最终报告" tabIndex={0}>
      <Markdown source={report || empty} />
    </div>}
    {readError && <div className="child-activity-read-error">
      <span>{readError}</span>
      <Button size="sm" variant="ghost" disabled={reading} onClick={() => setAttempt(value => value + 1)}>重试读取</Button>
    </div>}
    <div className="child-activity-actions">
      {report && <Button size="sm" variant="ghost" aria-expanded={view === "report"} aria-controls={view === "report" ? bodyId : undefined}
        onClick={() => setView(view === "report" ? "preview" : "report")}>
        {view === "report" ? "收起报告" : "展开报告"}
      </Button>}
      <Button size="sm" variant="ghost" aria-expanded={view === "conversation"} aria-controls={view === "conversation" ? bodyId : undefined}
        onClick={() => setView(view === "conversation" ? "preview" : "conversation")}>
        {view === "conversation" ? "收起记录" : active ? "展开记录" : "查看过程记录"}
        {view === "conversation" ? <CaretUp size={12} /> : <CaretDown size={12} />}
      </Button>
    </div>
  </section>;
});
