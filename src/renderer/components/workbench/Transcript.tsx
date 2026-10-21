import { ArrowDown, CaretDown, CaretRight, Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { Fragment, memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Collapsible } from "../primitives/Collapsible";
import { commandActivity, toolActivity } from "../../../shared/tool-activity";
import { executionLabel, executionTurns } from "../../../shared/execution";
import { webSearchStatus } from "../../../shared/web-search-display";
import type {
  ApprovalRequest,
  SessionId,
  SessionSnapshot,
} from "../../shared-types";
import { reduceTimeline, type TimelineItem } from "../../state/timeline";
import type { PendingOutput } from "../../state/transcript-sync";
import { completedTurnExecutions, type CompletedTurnExecution } from "../../state/turn-execution";
import { TranscriptScrollState } from "../../state/transcript-scroll";
import { useWorkbench } from "../../state/workbench-context";
import { ApprovalPanel } from "../primitives/ApprovalPanel";
import { Button } from "../primitives/Button";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import {
  ToolDisclosure,
  friendlyLabel,
  getToolIcon,
  PlanStepsList,
  extractPlanData,
  type PlanItemData,
} from "../primitives/ToolDisclosure";
import { Markdown } from "./Markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { Reasoning } from "./Reasoning";
import { ImageAttachments } from "./ImageAttachments";
import { PublishedFiles } from "./PublishedFiles";
import { foldedTool, transcriptStages, type TranscriptStage } from "../../state/transcript-stages";
import "./transcript.css";
import "./tool-live.css";
export { phaseMarkers, foldedTool } from "../../state/transcript-stages";
export { partitionTurns, groupTurnEntries, computeTurnSummary };

/**
 * Live argument-generation rows. They are display metadata only: no arguments,
 * no call, and explicitly not an execution (`status: generating`). A run whose
 * card already exists as a validated tool call is filtered out by previewId in
 * the reducer, so these rows never duplicate a real tool row.
 */
export function ToolPreviews({
  previews,
}: {
  readonly previews: NonNullable<
    import("../../state/workbench-reducer").ActiveRunState["toolPreviews"]
  >;
}) {
  return (
    <div className="tool-call-group tool-live-list" role="status" aria-label="工具参数生成中">
      {previews.map((preview) => {
        const toolName = preview.name || "";
        const label = friendlyLabel(toolName);
        const icon = getToolIcon(toolName);
        const isCommand = toolName === "run_command" || toolName === "command_task";
        return (
          <div
            className={`tool-disclosure tool-live-item ${isCommand ? "is-command" : ""}`}
            key={preview.previewId}
            data-status="generating"
            data-tool={toolName}
          >
            <div className="tool-disclosure-header tool-live-header">
              <div className="tool-disclosure-summary">
                <span className="tool-disclosure-icon tool-live-icon" aria-hidden="true">
                  {icon}
                </span>
                <span className="tool-disclosure-label tool-live-name">{label}</span>
                <span className="tool-disclosure-target">
                  <span className="tool-live-status">生成参数中</span>
                  <span className="tool-live-sep" aria-hidden="true"> · </span>
                  <span className="tool-live-chars">{preview.argumentsChars} 字符</span>
                </span>
              </div>
              <div className="tool-disclosure-meta">
                {preview.linesAdded !== undefined && preview.linesAdded > 0 && (
                  <span
                    className="tool-diff-stat tool-diff-added tool-live-diff"
                    title={`实时写入约 ${preview.linesAdded} 行`}
                  >
                    +{preview.linesAdded}
                  </span>
                )}
                {preview.linesRemoved !== undefined && preview.linesRemoved > 0 && (
                  <span
                    className="tool-diff-stat tool-diff-removed tool-live-diff"
                    title={`实时删除约 ${preview.linesRemoved} 行`}
                  >
                    -{preview.linesRemoved}
                  </span>
                )}
                <span className="tool-disclosure-status" data-status="running">
                  <span className="tool-live-spinner" aria-hidden="true" />
                </span>
              </div>
            </div>
            {isCommand && (
              <div className="tool-disclosure-body">
                <div className="tool-terminal-card tool-live-command-hint" aria-hidden="true">
                  <div className="tool-terminal-header">
                    <span className="tool-live-skeleton" />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Whole-answer copy. Sits in the quiet author row rather than floating over the
 * prose, so it never covers text and never shifts the message when it appears.
 * The confirmation is exposed through the button's own label, and the icon swap
 * is the only motion (reduced-motion already collapses transitions globally).
 */
function MessageCopyButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard can be unavailable (insecure origin, denied permission).
      // Leave the label unchanged rather than claiming a copy that did not
      // happen.
    }
  }, [text]);
  return (
    <button
      type="button"
      className={`message-copy${copied ? " is-copied" : ""}`}
      onClick={() => void copy()}
      aria-label={copied ? "已复制整段回答" : "复制整段回答"}
      title={copied ? "已复制" : "复制整段回答"}
    >
      {copied ? (
        <Check size={13} weight="bold" aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      <span>{copied ? "已复制" : "复制"}</span>
    </button>
  );
}

export interface PlanStageDividerProps {
  readonly title: string;
  readonly completed?: number;
  readonly total?: number;
  readonly percent?: number;
  readonly inProgress?: number;
  readonly plan?: PlanItemData | null;
}

/**
 * Unified plan stage progress divider.
 * Integrates stage title, sleek progress track and ratio count (e.g. 1/3)
 * into a single horizontal rule, replacing redundant heavy tool cards.
 */
export function PlanStageDivider({
  title,
  completed,
  total,
  percent: propPercent,
  inProgress,
  plan,
}: PlanStageDividerProps) {
  const [expanded, setExpanded] = useState(false);
  const actualTotal = total ?? plan?.steps.length ?? 0;
  const actualCompleted =
    completed ??
    (plan ? plan.steps.filter((s) => s.status === "completed").length : 0);
  const percent =
    propPercent ??
    (actualTotal > 0
      ? Math.round((actualCompleted / actualTotal) * 100)
      : 0);
  const planInProgress = plan
    ? plan.steps.filter((s) => s.status === "in_progress").length
    : undefined;
  const actualInProgress =
    inProgress ??
    (planInProgress !== undefined
      ? planInProgress > 0
        ? planInProgress
        : actualCompleted < actualTotal
          ? 1
          : 0
      : actualCompleted < actualTotal
        ? 1
        : 0);
  const activePercent =
    actualTotal > 0 && actualInProgress > 0 && percent < 100
      ? Math.min(
          100 - percent,
          Math.round((actualInProgress / actualTotal) * 100),
        )
      : 0;
  const countText =
    actualTotal > 0 ? `${actualCompleted}/${actualTotal}` : "";

  return (
    <div className="transcript-stage-divider">
      <div
        className={`transcript-stage-bar ${plan ? "is-interactive" : ""}`}
        role={plan ? "button" : undefined}
        tabIndex={plan ? 0 : undefined}
        onClick={plan ? () => setExpanded((prev) => !prev) : undefined}
        onKeyDown={
          plan
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((prev) => !prev);
                }
              }
            : undefined
        }
        aria-expanded={plan ? expanded : undefined}
        title={
          plan
            ? `${title} (点击${expanded ? "收起" : "查看"}步骤详情)`
            : title
        }
      >
        <span className="transcript-stage-title" title={title}>
          {title}
        </span>
        <div className="transcript-stage-track" aria-hidden="true">
          <div
            className="transcript-stage-fill"
            style={{ width: `${percent}%` }}
          />
          {activePercent > 0 && (
            <div
              className="transcript-stage-fill-active"
              style={{ width: `${activePercent}%` }}
            />
          )}
        </div>
        {countText && (
          <span className="transcript-stage-count" aria-hidden="true">
            {countText}
          </span>
        )}
      </div>
      {plan && (
        <Collapsible open={expanded}>
          <div className="transcript-stage-details">
            {plan.explanation && (
              <p className="transcript-stage-explanation">
                <span className="transcript-stage-explanation-label">
                  说明：
                </span>
                {plan.explanation}
              </p>
            )}
            <PlanStepsList steps={plan.steps} />
          </div>
        </Collapsible>
      )}
    </div>
  );
}

/**
 * Phase marker. Only a real AI plan step produces one, and it carries the
 * step's title with integrated progress track.
 */
function StageHeader({ stage }: { readonly stage: TranscriptStage }) {
  if (!stage.title) return null;
  return (
    <PlanStageDivider
      title={stage.title}
      completed={stage.completed}
      total={stage.total}
      percent={stage.percent}
      inProgress={stage.inProgress}
    />
  );
}
interface TurnEntry {
  readonly item: TimelineItem;
  readonly index: number;
}

interface TranscriptTurnData {
  readonly id: string;
  readonly turnNumber: number;
  readonly userEntry?: TurnEntry & {
    readonly item: TimelineItem & { readonly kind: "message"; readonly role: "user" };
  };
  readonly items: readonly TurnEntry[];
}

function partitionTurns(timeline: readonly TimelineItem[]): readonly TranscriptTurnData[] {
  const turns: TranscriptTurnData[] = [];
  let currentTurnNumber = 0;
  let currentTurn: {
    id: string;
    turnNumber: number;
    userEntry?: TurnEntry & { readonly item: TimelineItem & { readonly kind: "message"; readonly role: "user" } };
    items: TurnEntry[];
  } | null = null;

  for (const [index, item] of timeline.entries()) {
    if (item.kind === "error" && item.historical) continue;
    if (item.kind === "hook_diagnostic" && item.historical) continue;

    const isHumanUser =
      item.kind === "message" && item.role === "user" && !item.origin;

    if (isHumanUser && (item.turn === undefined || item.turn !== currentTurn?.turnNumber)) {
      currentTurnNumber = item.turn ?? currentTurnNumber + 1;
      currentTurn = {
        id: item.id || `turn-${currentTurnNumber}`,
        turnNumber: currentTurnNumber,
        userEntry: { item: { ...item, role: "user" }, index },
        items: [],
      };
      turns.push(currentTurn);
    } else {
      if (!currentTurn) {
        currentTurn = {
          id: `turn-prelude`,
          turnNumber: 0,
          items: [],
        };
        turns.push(currentTurn);
      }
      currentTurn.items.push({ item, index });
    }
  }

  return turns;
}

type TurnBlock =
  | { readonly kind: "single"; readonly entry: TurnEntry }
  | { readonly kind: "tool_group"; readonly id: string; readonly entries: readonly TurnEntry[] };

function groupTurnEntries(
  entries: readonly TurnEntry[],
  headers: readonly (TranscriptStage | null)[],
): readonly TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let currentTools: TurnEntry[] | null = null;

  for (const entry of entries) {
    // Only a stage marker that actually prints a title earns its own block: a
    // title-less phase header renders nothing (StageHeader returns null), so
    // treating it as a boundary would strand the turn's first tool row in a
    // standalone block (12px parent gap + 1px margin) instead of the 1px
    // tool-group rhythm its neighbours below share.
    const hasStageTitle = Boolean(headers[entry.index]?.title);
    const isPlan =
      entry.item.kind === "tool" &&
      ["create_plan", "update_plan"].includes(entry.item.call.function.name) &&
      entry.item.status !== "failed";
    const isTool = entry.item.kind === "tool";

    if (isPlan) {
      currentTools = null;
      blocks.push({ kind: "single", entry });
    } else if (isTool && !hasStageTitle) {
      if (!currentTools) {
        currentTools = [];
        blocks.push({
          kind: "tool_group",
          id: `tool-group-${entry.item.id}`,
          entries: currentTools,
        });
      }
      currentTools.push(entry);
    } else {
      currentTools = null;
      blocks.push({ kind: "single", entry });
    }
  }

  return blocks;
}

function computeTurnSummary(items: readonly TurnEntry[]): string {
  let toolCount = 0;
  let hasAssistant = false;
  let hasError = false;
  let hasReasoning = false;
  for (const { item } of items) {
    if (item.kind === "tool") {
      toolCount++;
      if (item.status === "failed") hasError = true;
    } else if (item.kind === "error" || item.kind === "hook_diagnostic") {
      hasError = true;
    } else if (item.kind === "message" && item.role === "assistant") {
      if (item.content) hasAssistant = true;
      if (item.reasoning) hasReasoning = true;
    }
  }
  const parts: string[] = [];
  if (toolCount > 0) parts.push(`${toolCount} 次工具调用`);
  if (hasAssistant) parts.push("已回复");
  if (hasReasoning) parts.push("含思考过程");
  if (hasError) parts.push("含异常记录");
  return parts.length > 0 ? parts.join(" · ") : "本轮已完成";
}

function findBackgroundCommand(
  taskId: string,
  timeline: readonly TimelineItem[],
): { command: string; cwd: string } | undefined {
  if (!taskId) return undefined;
  for (const item of timeline) {
    if (item.kind !== "tool" || item.call.function.name !== "run_command") continue;
    try {
      const output = JSON.parse(item.output);
      if (output && typeof output === "object" && output.id === taskId) {
        return commandActivity(item.call);
      }
    } catch {
      // Non-JSON output
    }
  }
  return undefined;
}

function renderToolCard(
  item: Extract<TimelineItem, { readonly kind: "tool" }>,
  index: number,
  phases: readonly number[],
  timeline?: readonly TimelineItem[],
) {
  let command =
    item.call.function.name === "run_command"
      ? commandActivity(item.call).command || undefined
      : undefined;
  let cwd =
    item.call.function.name === "run_command"
      ? commandActivity(item.call).cwd || undefined
      : undefined;
  let target = toolActivity(item.call).target || undefined;

  if (item.call.function.name === "command_task") {
    let taskId: string | undefined;
    let taskAction: string | undefined;
    try {
      const args = JSON.parse(item.call.function.arguments);
      if (args && typeof args === "object") {
        if (typeof args.id === "string") taskId = args.id;
        if (typeof args.action === "string") taskAction = args.action;
      }
    } catch {
      // Malformed arguments
    }

    if (taskId && timeline) {
      const bg = findBackgroundCommand(taskId, timeline);
      if (bg?.command) {
        command = bg.command;
        cwd = bg.cwd || undefined;
        const actionPrefix =
          taskAction === "wait"
            ? "等待"
            : taskAction === "read"
              ? "读取"
              : taskAction === "stop"
                ? "终止"
                : "";
        target = actionPrefix ? `${actionPrefix} · ${bg.command}` : bg.command;
      }
    }
  }

  return (
    <ToolDisclosure
      key={item.id}
      toolName={item.call.function.name}
      target={target}
      command={command}
      cwd={cwd}
      parameters={item.call.function.arguments.slice(0, 12000)}
      output={item.output.slice(0, 24000)}
      truncated={
        item.output.length > 24000 ||
        item.call.function.arguments.length > 12000
      }
      status={item.status}
      {...(item.durationMs === undefined
        ? {}
        : { durationMs: item.durationMs })}
      {...(item.startedAt === undefined ? {} : { timestamp: item.startedAt })}
      changes={item.changes}
      autoCollapsed={foldedTool(index, phases)}
    />
  );
}

function renderTimelineEntry(
  entry: TurnEntry,
  snapshot: SessionSnapshot,
  headers: readonly (TranscriptStage | null)[],
  phases: readonly number[],
  timeline?: readonly TimelineItem[],
) {
  const { item, index } = entry;
  if (item.kind === "error" && item.historical) return null;
  if (item.kind === "hook_diagnostic" && item.historical) return null;
  if (item.kind === "message" && item.origin === "agent_reconciliation")
    return (
      <details className="message message-internal" key={item.id}>
        <summary>子代理汇总 · 内部记录</summary>
        <p className="wb-muted">运行时追加的子任务汇总，不是人工输入。</p>
        <pre className="message-body">{item.content}</pre>
      </details>
    );
  if (item.kind === "hook_diagnostic") {
    const statusText =
      item.status === "denied"
        ? "拒绝执行"
        : item.status === "timed_out"
          ? "执行超时"
          : item.status === "cancelled"
            ? "已取消"
            : "执行失败";
    return (
      <div
        key={item.id}
        className="hook-diagnostic-badge"
        role="alert"
        data-status={item.status}
        data-hook={item.hook}
      >
        <WarningCircle
          size={14}
          weight="fill"
          className="hook-diagnostic-icon"
          aria-hidden="true"
        />
        <span className="hook-diagnostic-title">
          Hook {item.hookId} ({item.hook}) {statusText}
        </span>
        {item.reason && (
          <span className="hook-diagnostic-reason">：{item.reason}</span>
        )}
        {item.exitCode !== undefined && item.exitCode !== 0 && (
          <span className="hook-diagnostic-code">（退出码 {item.exitCode}）</span>
        )}
      </div>
    );
  }
  if (item.kind === "message")
    return (
      <Fragment key={item.id}>
        {headers[index] && <StageHeader stage={headers[index]} />}
        <article className={`message message-${item.role}`}>
          {item.role === "user" && <div className="message-header">你</div>}
          {item.role === "assistant" && (
            <div className="message-header message-author-row">
              <span>{item.incomplete ? "Forge · 未完成回复" : "Forge"}</span>
              {item.content && <MessageCopyButton text={item.content} />}
            </div>
          )}
          {item.role === "user" && item.images && item.images.length > 0 && (
            <ImageAttachments key={snapshot.id} images={item.images} />
          )}
          {item.reasoning && (
            <Reasoning text={item.reasoning} truncated={Boolean(item.reasoningTruncated)} />
          )}
          {item.content && <div className="message-body">
            {item.truncated && <p className="wb-muted">实时预览已达显示上限，完整内容以同步后的记录为准。</p>}
            <Markdown source={item.content} />
          </div>}
          {item.webSearchDetails && <div className="message-body"><Markdown source={item.webSearchDetails} /></div>}
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
  if (
    item.kind === "tool" &&
    ["create_plan", "update_plan"].includes(item.call.function.name) &&
    item.status !== "failed"
  ) {
    const planData =
      extractPlanData(item.output) ??
      extractPlanData(item.call.function.arguments);
    if (planData) {
      const total = planData.steps.length;
      const completed = planData.steps.filter((s) => s.status === "completed").length;
      const inProgress = planData.steps.find((s) => s.status === "in_progress");
      const title =
        inProgress?.step ??
        (completed === total
          ? (planData.title || "全部步骤已完成")
          : (planData.explanation || planData.title || "计划步骤"));
      return (
        <Fragment key={item.id}>
          {headers[index] && <StageHeader stage={headers[index]} />}
          <PlanStageDivider
            title={title}
            completed={completed}
            total={total}
            plan={planData}
          />
        </Fragment>
      );
    }
  }
  return (
    <Fragment key={item.id}>
      {headers[index] && <StageHeader stage={headers[index]} />}
      {renderToolCard(item, index, phases, timeline)}
    </Fragment>
  );
}

function ExecutionProcess({
  execution,
  counts,
  children,
}: {
  readonly execution: CompletedTurnExecution | undefined;
  readonly counts?: string | undefined;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!execution) return <>{children}</>;
  return (
    <div className="transcript-execution">
      <button
        type="button"
        className="transcript-execution-summary"
        aria-expanded={expanded}
        aria-label={expanded ? "收起本轮执行过程" : "展开本轮执行过程"}
        onClick={() => setExpanded((value) => !value)}
        title="本轮总耗时含工具执行与等待；速度 = 已计时请求的输出 token ÷ 请求总耗时（从请求发出到回复结束，含首 token 等待，不含工具执行、审批、重试间隔及子会话）"
      >
        <CaretRight
          size={13}
          weight="bold"
          className={`transcript-execution-caret ${expanded ? "is-expanded" : ""}`}
          aria-hidden="true"
        />
        <Check size={13} aria-hidden="true" />
        <span>done</span>
        {counts && (
          <>
            <span aria-hidden="true">·</span>
            <span>{counts}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>总耗时 {execution.duration}</span>
        <span aria-hidden="true">·</span>
        <span>{execution.speed}</span>
      </button>
      <Collapsible open={expanded}>
        <div className="transcript-execution-items">{children}</div>
      </Collapsible>
    </div>
  );
}

export const StoredTranscript = memo(function StoredTranscript({
  snapshot,
  pendingOutputs,
}: { readonly snapshot: SessionSnapshot; readonly pendingOutputs?: readonly PendingOutput[] | undefined }) {
  const timeline = reduceTimeline(snapshot, pendingOutputs);
  const { phases, headers } = transcriptStages(timeline);
  const [collapsedTurns, setCollapsedTurns] = useState<Record<string, boolean>>({});
  const toggleTurn = useCallback((turnId: string) => {
    setCollapsedTurns((prev) => ({ ...prev, [turnId]: !prev[turnId] }));
  }, []);

  const historicalErrors = timeline.filter(
    (item) =>
      (item.kind === "error" || item.kind === "hook_diagnostic") &&
      item.historical,
  );
  const turns = partitionTurns(timeline);
  const executions = completedTurnExecutions(snapshot);
  const executionRecords = executionTurns(snapshot);

  return (
    <>
      {historicalErrors.length > 0 && (
        <details className="message message-internal">
          <summary>历史异常记录 · {historicalErrors.length}</summary>
          {historicalErrors.map((item) =>
            item.kind === "error" ? (
              <p key={item.id}>
                {new Date(item.timestamp).toLocaleString()} · {item.message}
              </p>
            ) : item.kind === "hook_diagnostic" ? (
              <p key={item.id}>
                {new Date(item.timestamp).toLocaleString()} · Hook {item.hookId} ({item.hook}) {item.status === "denied" ? "拒绝" : item.status === "timed_out" ? "超时" : "失败"}{item.reason ? `：${item.reason}` : ""}
              </p>
            ) : null,
          )}
        </details>
      )}
      {turns.map((turn) => {
        const isCollapsed = Boolean(collapsedTurns[turn.id]);
        const userItem = turn.userEntry?.item;
        const recordIndex = executionRecords.findIndex(record => record.turn === turn.turnNumber);
        const record = executionRecords[recordIndex];
        const execution = executions[recordIndex];
        const finalEntry = execution
          ? turn.items.find(({ item }) => item.id === execution.finalMessageId)
          : undefined;
        const processItems = finalEntry
          ? turn.items.filter((entry) => entry !== finalEntry)
          : turn.items;
        const blocks = groupTurnEntries(processItems, headers);
        const counts = record ? executionLabel(record) : "";
        const hasError = turn.items.some(
          ({ item }) =>
            item.kind === "error" ||
            item.kind === "hook_diagnostic" ||
            (item.kind === "tool" && item.status === "failed"),
        );
        const summaryText = counts ? `${counts}${hasError ? " · 含异常记录" : ""}` : computeTurnSummary(turn.items);
        const files = turn.items.flatMap(({ item }) => item.kind === "tool" && item.status === "completed" && item.call.function.name === "publish_file" ? item.files ?? [] : []);

        return (
          <section className="transcript-turn" key={turn.id} data-turn={turn.turnNumber}>
            {userItem && (
              <article className="message message-user">
                <div className="message-header">你</div>
                {turn.turnNumber > 0 && (
                  <div className="transcript-turn-actions">
                    <span className="transcript-turn-badge">第 {turn.turnNumber} 轮</span>
                    <button
                      type="button"
                      className="transcript-turn-toggle"
                      onClick={() => toggleTurn(turn.id)}
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? `展开第 ${turn.turnNumber} 轮对话` : `收起第 ${turn.turnNumber} 轮对话`}
                      title={isCollapsed ? "展开此轮" : "收起此轮"}
                    >
                      {isCollapsed ? (
                        <>
                          <CaretRight size={12} weight="bold" aria-hidden="true" />
                          <span>展开本轮</span>
                        </>
                      ) : (
                        <>
                          <CaretDown size={12} weight="bold" aria-hidden="true" />
                          <span>收起本轮</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
                {userItem.images && userItem.images.length > 0 && (
                  <ImageAttachments key={snapshot.id} images={userItem.images} />
                )}
                {userItem.content && (
                  <div className="message-body">
                    <Markdown source={userItem.content} />
                  </div>
                )}
              </article>
            )}
            {turn.items.length > 0 && (
              isCollapsed ? (
                <button
                  type="button"
                  className="transcript-turn-collapsed-bar"
                  onClick={() => toggleTurn(turn.id)}
                  aria-label={`展开第 ${turn.turnNumber} 轮执行与回复`}
                >
                  <CaretRight size={13} weight="bold" className="transcript-turn-collapsed-caret" aria-hidden="true" />
                  <span className="transcript-turn-collapsed-title">本轮执行已收起</span>
                  <span className="transcript-turn-collapsed-sep" aria-hidden="true">·</span>
                  <span className="transcript-turn-collapsed-meta">{summaryText}</span>
                  <span className="transcript-turn-collapsed-action">点击展开</span>
                </button>
              ) : (
                <div className="transcript-turn-body">
                  <ExecutionProcess execution={finalEntry ? execution : undefined} counts={counts}>
                    {blocks.map((block) => {
                      if (block.kind === "single") {
                        return <Fragment key={block.entry.item.id}>{renderTimelineEntry(block.entry, snapshot, headers, phases, timeline)}</Fragment>;
                      }
                      return (
                        <div className="tool-call-group" key={block.id}>
                          {block.entries.map(({ item, index }) =>
                            item.kind === "tool"
                              ? renderToolCard(item, index, phases, timeline)
                              : null,
                          )}
                        </div>
                      );
                    })}
                  </ExecutionProcess>
                  {finalEntry && renderTimelineEntry(finalEntry, snapshot, headers, phases, timeline)}
                  <PublishedFiles sessionId={snapshot.id} files={files} />
                </div>
              )
            )}
          </section>
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

interface TranscriptHistoryAnchor {
  readonly sessionId: SessionId | null;
  readonly messageOffset: number;
  readonly element: HTMLElement | null;
  readonly turn: string | null;
  readonly viewportOffset: number;
  readonly scrollHeight: number;
  readonly following: boolean;
}

/** A wheel notch or two: enough to count, small enough not to pull the reader. */
const HISTORY_TOP_THRESHOLD = 24;
/**
 * Only an animated scroll needs a time window: it keeps emitting events after
 * the gesture that started it. Instant jumps record their own scrollTop, so the
 * single event they produce can never look like an upward gesture.
 */
const HISTORY_SMOOTH_SUPPRESS_MS = 800;

function isNearTranscriptTop(scroll: HTMLDivElement): boolean {
  return (
    scroll.scrollTop <= HISTORY_TOP_THRESHOLD ||
    scroll.scrollHeight <= scroll.clientHeight + 1
  );
}

export function Transcript() {
  const workbench = useWorkbench();
  const { answerApproval, loadOlderMessages, openNewSession } = workbench;
  const state = workbench.state;
  const snapshot = state.activeSnapshot;
  const sessionId = state.activeSessionId;
  // A session that predates windowing (or a full snapshot) has no page cursor,
  // so the reader simply shows everything it has and grows no history control.
  const history = snapshot?.transcript;
  const run = sessionId ? state.activeRuns[sessionId] : undefined;
  const pendingApproval = run?.pendingApproval;
  // The inline card is the primary path only for the selected session's live
  // run; every other run (background, child) stays in the Inspector summary.
  const showInlineApproval = Boolean(sessionId && pendingApproval);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigation = useRef(new TranscriptScrollState());
  const [hasNewContent, setHasNewContent] = useState(false);
  // Pagination state is kept per session: an old promise or its anchor must not
  // grab the next session's scroll position. The controller additionally
  // isolates stale responses; this is the second, local guard.
  const historyRequest = useRef<{
    readonly sessionId: SessionId | null;
  } | null>(null);
  const historyAnchor = useRef<TranscriptHistoryAnchor | null>(null);
  const historySuppressNewContent = useRef(false);
  const programmaticScrollUntil = useRef(0);
  const lastScrollTop = useRef(0);
  // A collapsing disclosure shrinks the content and the browser clamps
  // scrollTop upward. That is layout, not reading intent, so the shrink is
  // remembered here instead of opening a timed window that would also swallow
  // a real upward gesture.
  const lastScrollHeight = useRef(0);
  const touchStartY = useRef<number | null>(null);
  // Loading a snapshot for the selected session is itself arriving content,
  // and a fresh approval request is arriving content too: the card must be
  // pulled into view like any new message.
  // Reasoning deltas grow the live tail too, so they must count as arriving
  // content or the follow-scroll would stall while the model is still thinking.
  const contentVersion = `${snapshot?.id ?? ""}:${history?.messageOffset ?? ""}:${history?.eventOffset ?? ""}:${snapshot?.messages.length ?? 0}:${snapshot?.pendingSteering?.length ?? 0}:${snapshot?.events.length ?? 0}:${snapshot?.messages.at(-1)?.content?.length ?? 0}:${run?.pendingOutputs?.length ?? 0}:${run?.pendingReasoning?.length ?? 0}:${run?.streamingReasoning?.length ?? 0}:${run?.streamingText?.length ?? 0}:${run?.toolPreviews?.map((p) => `${p.previewId}:${p.argumentsChars}`).join(",") ?? ""}:${pendingApproval?.id ?? ""}`;
  // Has this turn produced answer prose yet? Either the live draft is still
  // streaming, or the snapshot already persisted it and the draft was cleared
  // on sync. Both mean the model has left its reasoning phase.
  const answerStarted =
    Boolean(run?.streamingText) ||
    (snapshot?.messages.at(-1)?.role === "assistant" &&
      Boolean(snapshot?.messages.at(-1)?.content));
  const suppressProgrammaticScroll = () => {
    programmaticScrollUntil.current = Math.max(
      programmaticScrollUntil.current,
      Date.now() + HISTORY_SMOOTH_SUPPRESS_MS,
    );
  };
  const captureHistoryAnchor = (): TranscriptHistoryAnchor | null => {
    const scroll = scrollRef.current;
    if (!scroll || !history) return null;
    const scrollRect = scroll.getBoundingClientRect();
    let element: HTMLElement | null = null;
    for (const candidate of scroll.querySelectorAll<HTMLElement>("[data-turn]")) {
      if (candidate.getBoundingClientRect().bottom > scrollRect.top + 1) {
        element = candidate;
        break;
      }
    }
    return {
      sessionId,
      messageOffset: history.messageOffset,
      element,
      turn: element?.dataset.turn ?? null,
      viewportOffset: element
        ? element.getBoundingClientRect().top - scrollRect.top
        : 0,
      scrollHeight: scroll.scrollHeight,
      following: navigation.current.following,
    };
  };
  const restoreHistoryAnchor = (anchor: TranscriptHistoryAnchor) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (anchor.following) {
      // A short transcript (or a reader already at the tail) keeps the tail:
      // the same visible turn remains at the bottom after the prepend.
      scroll.scrollTop = scroll.scrollHeight;
      lastScrollTop.current = scroll.scrollTop;
      lastScrollHeight.current = scroll.scrollHeight;
      navigation.current.following = true;
      navigation.current.hasNewContent = false;
      setHasNewContent(false);
      return;
    }
    const align = () => {
      const element = anchor.element?.isConnected
        ? anchor.element
        : anchor.turn === null
          ? null
          : (Array.from(
              scroll.querySelectorAll<HTMLElement>("[data-turn]"),
            ).find((candidate) => candidate.dataset.turn === anchor.turn) ?? null);
      const delta = element
        ? element.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top -
          anchor.viewportOffset
        : scroll.scrollHeight - anchor.scrollHeight;
      if (Math.abs(delta) < 0.5) return;
      scroll.scrollTop = Math.max(0, scroll.scrollTop + delta);
      lastScrollTop.current = scroll.scrollTop;
      lastScrollHeight.current = scroll.scrollHeight;
    };
    align();
    navigation.current.following = false;
    navigation.current.hasNewContent = false;
    setHasNewContent(false);
    // The loading row swapping back to its idle state, a late font or a
    // collapse above the reader can move the anchor a pixel or two after this
    // commit: re-measure once on the next frame unless the reader moved first.
    const settle = () => {
      if (!scroll.isConnected || scroll.scrollTop !== lastScrollTop.current) return;
      align();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(settle);
  };
  const requestOlderMessages = async (retry = false) => {
    if (!sessionId || !snapshot || !history?.hasMore) return;
    if (state.isHistoryLoading) return;
    if (historyRequest.current?.sessionId === sessionId) return;
    // A failure is never retried by geometry/scroll alone. The explicit retry
    // button is the one path back in, so a persistent error cannot loop.
    if (state.historyError && !retry) return;
    const request = { sessionId };
    historyRequest.current = request;
    historyAnchor.current = captureHistoryAnchor();
    try {
      await loadOlderMessages();
    } catch {
      // The controller owns the visible error and the anchor reset; the
      // content already on screen stays exactly where the reader left it.
    } finally {
      const clear = () => {
        if (historyRequest.current === request) historyRequest.current = null;
      };
      // Let the controller's loading/snapshot update commit before another
      // gesture is allowed to start a second page.
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(clear);
      } else {
        setTimeout(clear, 0);
      }
    }
  };
  const maybeRequestOlderMessages = () => {
    if (state.historyError || state.isHistoryLoading) return;
    const scroll = scrollRef.current;
    if (!scroll || !isNearTranscriptTop(scroll)) return;
    void requestOlderMessages(false);
  };
  // A wheel/touch/key gesture in a short transcript produces no scroll event at
  // all, so let the browser apply the gesture first and then inspect the top.
  const requestOlderAfterUserScroll = () => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(maybeRequestOlderMessages);
    } else {
      maybeRequestOlderMessages();
    }
  };
  const jumpToLatest = () => {
    navigation.current.reset();
    setHasNewContent(false);
    const scroll = scrollRef.current;
    if (!scroll) return;
    // User-initiated catch-up only. Token streaming below keeps the raw
    // scrollTop assignment so the follow-scroll never lags, and reduced-motion
    // users get the same instant jump instead of an animated sweep.
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      scroll.scrollTop = scroll.scrollHeight;
    } else {
      // The animation itself is the only programmatic movement that needs the
      // time window; it keeps emitting events after this handler returns.
      suppressProgrammaticScroll();
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
    }
    lastScrollTop.current = scroll.scrollTop;
    lastScrollHeight.current = scroll.scrollHeight;
  };
  useLayoutEffect(() => {
    // Each saved session starts at its own tail, even if the previous one was
    // being read off-tail. No scroll/follow state, pending page request or
    // anchor from the previous session crosses this boundary.
    if (sessionId) navigation.current.reset();
    setHasNewContent(false);
    historyRequest.current = null;
    historyAnchor.current = null;
    historySuppressNewContent.current = false;
    lastScrollTop.current = 0;
    lastScrollHeight.current = 0;
    programmaticScrollUntil.current = 0;
    touchStartY.current = null;
    const scroll = scrollRef.current;
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight;
      lastScrollTop.current = scroll.scrollTop;
      lastScrollHeight.current = scroll.scrollHeight;
    }
  }, [sessionId]);
  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    if (!anchor) return;
    if (anchor.sessionId !== sessionId) {
      historyAnchor.current = null;
      return;
    }
    // The page cursor is the only prepend signal: live output grows the tail
    // and leaves messageOffset alone. A missing cursor cannot be a prepend.
    if (!history || history.messageOffset >= anchor.messageOffset) return;
    historyAnchor.current = null;
    // Prepending history is not arriving chat output. Skip the follow-tail and
    // unread indicator for this commit, then keep the reader's DOM anchor.
    historySuppressNewContent.current = true;
    restoreHistoryAnchor(anchor);
  }, [sessionId, history?.messageOffset]);
  useLayoutEffect(() => {
    if (!state.historyError) return;
    if (historyAnchor.current?.sessionId === sessionId) {
      historyAnchor.current = null;
    }
  }, [state.historyError, sessionId]);
  useLayoutEffect(() => {
    if (historySuppressNewContent.current) {
      historySuppressNewContent.current = false;
      setHasNewContent(false);
      return;
    }
    if (contentVersion && navigation.current.contentArrived()) {
      const scroll = scrollRef.current;
      if (scroll) {
        scroll.scrollTop = scroll.scrollHeight;
        lastScrollTop.current = scroll.scrollTop;
        lastScrollHeight.current = scroll.scrollHeight;
      }
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
      if (navigation.current.following) {
        scroll.scrollTop = scroll.scrollHeight;
        lastScrollTop.current = scroll.scrollTop;
        lastScrollHeight.current = scroll.scrollHeight;
      }
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
        role={snapshot ? "region" : undefined}
        aria-label={snapshot ? "对话记录" : undefined}
        tabIndex={snapshot ? 0 : undefined}
        onScroll={() => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          const previous = lastScrollTop.current;
          lastScrollTop.current = scroll.scrollTop;
          // A collapsing disclosure (or a shrinking viewport) can clamp
          // scrollTop upward. That is layout, not reading intent.
          const heightShrank = scroll.scrollHeight < lastScrollHeight.current - 1;
          lastScrollHeight.current = scroll.scrollHeight;
          navigation.current.readPosition(scroll);
          setHasNewContent(navigation.current.hasNewContent);
          // If the reader moves while the request is pending, preserve their
          // latest position rather than pulling them back to the request origin.
          if (historyAnchor.current?.sessionId === sessionId &&
              historyAnchor.current?.messageOffset === history?.messageOffset) {
            historyAnchor.current = captureHistoryAnchor();
          }
          // Programmatic follow/restore jumps record their own scrollTop, and an
          // animated jump owns its events, so neither is reading intent.
          if (heightShrank) return;
          if (Date.now() < programmaticScrollUntil.current) return;
          // Only a real upward movement at the top asks for another page; a
          // sentinel merely being visible on a short transcript must not.
          if (scroll.scrollTop < previous && isNearTranscriptTop(scroll)) {
            maybeRequestOlderMessages();
          }
        }}
        onWheel={(event) => {
          if (event.ctrlKey || event.deltaY >= 0) return;
          requestOlderAfterUserScroll();
        }}
        onTouchStart={(event) => {
          touchStartY.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(event) => {
          const start = touchStartY.current;
          const current = event.touches[0]?.clientY;
          if (start === null || current === undefined) return;
          // Finger moving down scrolls the content up.
          if (current - start > 8) {
            touchStartY.current = current;
            requestOlderAfterUserScroll();
          }
        }}
        onTouchEnd={() => {
          touchStartY.current = null;
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.defaultPrevented) return;
          if (
            event.key === "ArrowUp" ||
            event.key === "PageUp" ||
            event.key === "Home"
          ) {
            requestOlderAfterUserScroll();
          }
        }}
        onClickCapture={(event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const trigger = target.closest<HTMLElement>(
            ".tool-disclosure-header, .reasoning-head, summary, .transcript-turn-toggle, .transcript-turn-collapsed-bar, .transcript-execution-summary",
          );
          if (!trigger) return;

          navigation.current.inspectDisclosure();

          const isExpanding =
            trigger.getAttribute("aria-expanded") === "false" ||
            trigger.classList.contains("transcript-turn-collapsed-bar") ||
            (trigger.tagName === "SUMMARY" && !trigger.parentElement?.hasAttribute("open"));

          if (isExpanding) {
            requestAnimationFrame(() => {
              const scroll = scrollRef.current;
              if (!scroll || !trigger.isConnected) return;
              const scrollRect = scroll.getBoundingClientRect();
              const triggerRect = trigger.getBoundingClientRect();
              const offsetTop = triggerRect.top - scrollRect.top + scroll.scrollTop;
              const top = Math.max(0, offsetTop - 12);
              const reduced =
                typeof window.matchMedia === "function" &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              if (reduced) {
                scroll.scrollTop = top;
              } else {
                // Expanding can scroll upward towards the top; the animation's
                // own events are interaction, not a request for a page.
                suppressProgrammaticScroll();
                scroll.scrollTo({ top, behavior: "smooth" });
              }
              lastScrollTop.current = scroll.scrollTop;
              lastScrollHeight.current = scroll.scrollHeight;
            });
          }
        }}
      >
        <div ref={contentRef} className="conversation-inner">
          {snapshot && history && (
            <div className="transcript-history" data-session-id={snapshot.id}>
              {state.isHistoryLoading ? (
                <span className="transcript-history-status" role="status">
                  <span
                    className="transcript-history-spinner"
                    aria-hidden="true"
                  />
                  正在加载历史记录…
                </span>
              ) : state.historyError ? (
                <button
                  type="button"
                  className="transcript-history-button is-error"
                  onClick={() => void requestOlderMessages(true)}
                  title={state.historyError}
                  aria-label={`历史记录加载失败：${state.historyError}。点击重试`}
                >
                  加载失败，点击重试
                </button>
              ) : history.hasMore ? (
                <button
                  type="button"
                  className="transcript-history-button"
                  onClick={() => void requestOlderMessages(false)}
                  aria-label="加载更早的对话记录"
                >
                  上滑加载更早对话
                </button>
              ) : (
                <span className="transcript-history-status is-end">
                  已加载全部记录
                </span>
              )}
            </div>
          )}
          {state.isSnapshotLoading && <p className="wb-muted">正在读取会话…</p>}
          {snapshot ? (
            <StoredTranscript key={snapshot.id} snapshot={snapshot} pendingOutputs={run?.pendingOutputs} />
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
          {snapshot?.pendingSteering?.map((message, index) => message.role === "user" && (
            <article className="message message-user" key={`steering:${snapshot.id}:${index}`}>
              <div className="message-header">你</div>
              {!!message.images?.length && <ImageAttachments images={message.images} />}
              {message.content && <div className="message-body"><Markdown source={message.content} /></div>}
            </article>
          ))}
          {/* Reasoning renders before the answer: saved-but-unsynchronized
              thoughts first, then the live block still streaming in. */}
          {run?.pendingReasoning?.map((output) => (
            <Reasoning key={output.id} text={output.text} truncated={output.truncated} />
          ))}
          {run?.streamingReasoning && (
            <Reasoning
              key={`${sessionId}:${run.runId ?? "pending"}:${run.streamingTurn ?? 0}:reasoning`}
              text={run.streamingReasoning}
              // The runtime keeps this buffer after the answer starts, so the
              // "live" state ends with the answer, not with the model's
              // reasoning phase. "Answer started" must therefore include an
              // answer that has already been persisted: clearing the live draft
              // on sync must not flip a finished thought back to 思考中.
              live={!run.streamingText && !answerStarted}
              truncated={Boolean(run.reasoningTruncated)}
            />
          )}
          {run?.streamingText && (
            <article className="message message-assistant message-streaming">
              <div className="message-header message-author message-author-row">
                <span>Forge · 实时草稿</span>
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
          {run?.webSearch && run.status === "running" && <p className="wb-muted" role="status">{webSearchStatus(run.webSearch)}</p>}
          {(run?.toolPreviews?.length ?? 0) > 0 && (
            <ToolPreviews previews={run?.toolPreviews ?? []} />
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
          <Button
            size="sm"
            className="transcript-latest-btn"
            onClick={jumpToLatest}
            icon={<ArrowDown size={13} weight="bold" aria-hidden="true" />}
          >
            查看最新消息
          </Button>
        </div>
      )}
    </div>
  );
}
